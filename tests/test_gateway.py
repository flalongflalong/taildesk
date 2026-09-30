import asyncio
import socket
import struct
import time

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from server.app import COOKIE, create_app
from server.config import Settings
from server.targets import resolve_target
from tests.vnc_fixture import VNCFixture

ORIGIN = 'http://127.0.0.1:8787'
DEVICE = {'name': 'Test Mac', 'host': '100.64.0.10', 'port': 5900, 'platform': 'mac'}


@pytest.fixture
def gateway(tmp_path):
    app = create_app(Settings(data_dir=tmp_path, bridge_enabled=False))
    with TestClient(app, base_url=ORIGIN, headers={'origin': ORIGIN}) as client:
        yield client, app, tmp_path


def login(client, directory):
    assert client.post('/api/login', json={'key': (directory / 'access-key').read_text().strip()}).status_code == 200


def test_authentication_and_crud_persistence(gateway):
    client, app, directory = gateway
    assert client.get('/api/devices').status_code == 401
    assert client.get('/api/session').json() == {'authenticated': False}
    assert client.post('/api/login', json={'key': 'incorrect'}).status_code == 401
    login(client, directory)
    assert client.get('/api/session').json()['authenticated']
    created = client.post('/api/devices', json=DEVICE)
    assert created.status_code == 201
    device_id = created.json()['id']
    assert 'password' not in created.text
    updated = client.put(f'/api/devices/{device_id}', json={**DEVICE, 'name': 'Renamed Mac'})
    assert updated.json()['name'] == 'Renamed Mac'
    from server.store import Store
    another = Store(directory)
    assert another.get(device_id)['name'] == 'Renamed Mac'
    another.close()
    assert client.delete(f'/api/devices/{device_id}').status_code == 200
    assert client.get('/api/devices').json() == []
    assert client.post('/api/logout').status_code == 200
    assert client.get('/api/devices').status_code == 401
    assert (directory / 'access-key').stat().st_mode & 0o777 == 0o600


@pytest.mark.parametrize('host', ['192.168.1.1', '8.8.8.8', '169.254.169.254', 'localhost', 'https://100.64.0.1', '100.63.255.255', '100.128.0.1', '::ffff:127.0.0.1', 'fd00::1', 'evil.example.ts.net/path', 'a\n.example.ts.net'])
def test_forbidden_destinations(gateway, host):
    client, _, directory = gateway
    login(client, directory)
    assert client.post('/api/devices', json={**DEVICE, 'host': host}).status_code == 422


@pytest.mark.parametrize('host', ['100.64.0.0', '100.127.255.255', 'fd7a:115c:a1e0::1', '127.0.0.1', '::1', 'mac.example.ts.net'])
def test_allowed_destinations(gateway, host):
    client, _, directory = gateway
    login(client, directory)
    assert client.post('/api/devices', json={**DEVICE, 'host': host}).status_code == 201


@pytest.mark.parametrize('extra', [{'port': 22}, {'port': 6000}, {'port': '5900'}, {'password': 'must-not-store'}, {'name': '  '}])
def test_invalid_device_data(gateway, extra):
    client, _, directory = gateway
    login(client, directory)
    assert client.post('/api/devices', json={**DEVICE, **extra}).status_code == 422


def test_origin_host_session_expiry_and_rate_limit(gateway):
    client, app, directory = gateway
    assert client.post('/api/login', json={'key': 'x'}, headers={'origin': 'https://evil.test'}).status_code == 403
    assert client.get('/api/session', headers={'host': 'evil.test'}).status_code == 403
    login(client, directory)
    for token in app.state.sessions:
        app.state.sessions[token] = 0
    assert client.get('/api/devices').status_code == 401
    for _ in range(10):
        client.post('/api/login', json={'key': 'wrong'})
    assert client.post('/api/login', json={'key': 'wrong'}).status_code == 429


def test_websocket_requires_session_origin_and_registered_target(gateway):
    client, _, directory = gateway
    with pytest.raises(WebSocketDisconnect) as unauthenticated:
        with client.websocket_connect('ws://127.0.0.1:8787/ws/arbitrary', headers={'origin': ORIGIN}):
            pass
    assert unauthenticated.value.code == 4401
    login(client, directory)
    device = client.post('/api/devices', json=DEVICE).json()
    for path, origin, code in [('/ws/unknown', ORIGIN, 4404), (f'/ws/{device["id"]}', 'https://evil.test', 4401)]:
        with pytest.raises(WebSocketDisconnect) as rejected:
            with client.websocket_connect('ws://127.0.0.1:8787' + path, headers={'origin': origin}):
                pass
        assert rejected.value.code == code


def test_dns_rebinding_is_rejected(monkeypatch):
    async def run():
        loop = asyncio.get_running_loop()
        async def resolution(*args, **kwargs):
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('192.168.1.1', 5900))]
        monkeypatch.setattr(loop, 'getaddrinfo', resolution)
        with pytest.raises(ValueError):
            await resolve_target('mac.example.ts.net', 5900)
    asyncio.run(run())


@pytest.mark.parametrize('termination', ['logout', 'expiry', 'edit', 'delete'])
def test_real_websockify_transports_frame_input_and_revokes_session(tmp_path, termination):
    fixture = VNCFixture(0).start()
    port = fixture.server_address[1]
    # Test fixture uses an ephemeral port; production validation remains unchanged.
    app = create_app(Settings(data_dir=tmp_path))
    with TestClient(app, base_url=ORIGIN, headers={'origin': ORIGIN}) as client:
        login(client, tmp_path)
        device = client.post('/api/devices', json={**DEVICE, 'host': '127.0.0.1', 'port': 5909}).json()
        # Only substitute the independently allocated fixture's TCP port.
        real_issue = app.state.bridge.issue
        app.state.bridge.issue = lambda host, requested: real_issue(host, port)
        with client.websocket_connect(f'ws://127.0.0.1:8787/ws/{device["id"]}', headers={'origin': ORIGIN}) as ws:
            buffered = bytearray()
            def receive(size):
                while len(buffered) < size:
                    buffered.extend(ws.receive_bytes())
                data = bytes(buffered[:size]); del buffered[:size]
                return data
            assert receive(12) == b'RFB 003.008\n'
            ws.send_bytes(b'RFB 003.008\n')
            assert receive(2) == b'\x01\x01'
            ws.send_bytes(b'\x01')
            assert receive(4) == b'\0\0\0\0'
            ws.send_bytes(b'\x01')
            header = receive(24)
            assert struct.unpack('>HH', header[:4]) == (640, 400)
            receive(struct.unpack('>I', header[20:])[0])
            ws.send_bytes(struct.pack('>BBHHHH', 3, 0, 0, 0, 640, 400))
            frame = receive(16)
            assert frame[:4] == b'\0\0\0\x01'
            pixels = receive(640 * 400 * 4)
            assert pixels[:4] == bytes([80, 57, 48, 0])
            ws.send_bytes(struct.pack('>BBHI', 4, 1, 0, 0xff09))
            ws.send_bytes(struct.pack('>BBHH', 5, 1, 100, 120))
            deadline = time.monotonic() + 2
            while time.monotonic() < deadline and not any(e['type'] == 'pointer' for e in fixture.events):
                time.sleep(.02)
            assert {'type': 'key', 'down': True, 'keysym': 0xff09} in fixture.events
            assert {'type': 'pointer', 'buttons': 1, 'x': 100, 'y': 120} in fixture.events
            assert list((tmp_path / 'bridge-tokens').iterdir()) == []
            if termination == 'logout':
                client.post('/api/logout')
            elif termination == 'expiry':
                for token in app.state.sessions:
                    app.state.sessions[token] = 0
            elif termination == 'edit':
                client.put(f'/api/devices/{device["id"]}', json={**DEVICE, 'name': 'Changed'})
            else:
                client.delete(f'/api/devices/{device["id"]}')
            with pytest.raises(WebSocketDisconnect) as closed:
                ws.receive_bytes()
            assert closed.value.code == (4404 if termination in {'edit', 'delete'} else 4401)
    fixture.shutdown()
    fixture.server_close()


def test_token_plugin_handles_ipv6_and_path_traversal(tmp_path):
    from server.bridge import TokenPlugin
    token = 'x' * 43
    (tmp_path / token).write_text('fd7a:115c:a1e0::1:5900\n')
    plugin = TokenPlugin(tmp_path)
    assert plugin.lookup(token) == ['fd7a:115c:a1e0::1', '5900']
    assert plugin.lookup('../../access-key') is None
    assert plugin.lookup('y' * 43) is None


def test_slow_browser_does_not_kill_private_bridge_while_frames_are_in_flight(tmp_path, monkeypatch):
    """A full frame must survive a slow consumer and accept the next key.

    Shrink heartbeat timings only for this test so 40 seconds of backpressure
    is exercised in under two seconds. Keep an explicitly disabled timeout.
    """
    from websockets.asyncio.client import connect as real_connect
    from starlette.websockets import WebSocket
    import server.app as gateway_module

    def fast_heartbeat(*args, **kwargs):
        kwargs['ping_interval'] = 0.02
        if kwargs.get('ping_timeout', 'default') is not None:
            kwargs['ping_timeout'] = 0.03
        kwargs['close_timeout'] = 0.2
        kwargs['max_queue'] = 1
        return real_connect(*args, **kwargs)

    original_send = WebSocket.send_bytes
    async def slow_send(ws, data):
        if len(data) > 1024:
            await asyncio.sleep(0.08)
        await original_send(ws, data)

    monkeypatch.setattr(gateway_module, 'connect', fast_heartbeat)
    monkeypatch.setattr(WebSocket, 'send_bytes', slow_send)
    fixture = VNCFixture(0).start()
    try:
        app = create_app(Settings(data_dir=tmp_path))
        with TestClient(app, base_url=ORIGIN, headers={'origin': ORIGIN}) as client:
            login(client, tmp_path)
            device = client.post('/api/devices', json={**DEVICE, 'host': '127.0.0.1', 'port': 5909}).json()
            issue = app.state.bridge.issue
            app.state.bridge.issue = lambda host, _: issue(host, fixture.server_address[1])
            with client.websocket_connect(f'ws://127.0.0.1:8787/ws/{device["id"]}', headers={'origin': ORIGIN}) as ws:
                buffered = bytearray()
                def receive(size):
                    while len(buffered) < size:
                        buffered.extend(ws.receive_bytes())
                    data = bytes(buffered[:size]); del buffered[:size]
                    return data
                assert receive(12) == b'RFB 003.008\n'
                ws.send_bytes(b'RFB 003.008\n')
                receive(2)
                ws.send_bytes(b'\x01')
                receive(4)
                ws.send_bytes(b'\x01')
                header = receive(24)
                receive(struct.unpack('>I', header[20:])[0])
                ws.send_bytes(struct.pack('>BBHHHH', 3, 0, 0, 0, 640, 400))
                assert receive(16)[:4] == b'\0\0\0\x01'
                pixels = receive(640 * 400 * 4)
                assert pixels[:4] == bytes([80, 57, 48, 0])
                ws.send_bytes(struct.pack('>BBHI', 4, 1, 0, 0xff0d))
                deadline = time.monotonic() + 1
                while time.monotonic() < deadline and not any(e['type'] == 'key' for e in fixture.events):
                    time.sleep(.01)
                assert {'type': 'key', 'down': True, 'keysym': 0xff0d} in fixture.events
    finally:
        fixture.shutdown()
        fixture.server_close()


def test_private_and_public_origins_both_require_auth_and_reject_unlisted_sites(tmp_path):
    private = 'https://test-mac.example.ts.net'
    public = 'https://test-public.example.com'
    app = create_app(Settings(data_dir=tmp_path, bridge_enabled=False,
                              public_origin=public, private_origin=private))
    with TestClient(app, base_url=private, headers={'origin': private}) as client:
        assert client.get('/api/devices').status_code == 401
        assert client.get('/api/session', headers={'host': 'unlisted.example.com'}).status_code == 403
        login(client, tmp_path)
        assert client.get('/api/devices').status_code == 200
        assert client.post('/api/devices', json=DEVICE, headers={'origin': 'https://unlisted.example.com'}).status_code == 403
    with TestClient(app, base_url=public, headers={'origin': public}) as client:
        assert client.get('/api/devices').status_code == 401
        login(client, tmp_path)
        assert client.get('/api/devices').status_code == 200


@pytest.mark.parametrize('origin', ['http://test.example.com', 'https://test.example.com/path',
                                  'https://user:test@test.example.com', 'https://test.example.com?q=1'])
def test_private_origin_requires_exact_https_origin(origin):
    with pytest.raises(ValueError, match='PRIVATE_ORIGIN'):
        Settings(private_origin=origin)
