import asyncio
import hashlib
import hmac
import logging
import secrets
import time
from collections import deque
from contextlib import asynccontextmanager, suppress
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, field_validator
from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed

from .bridge import Bridge
from .config import ROOT, Settings
from .store import Store
from .targets import resolve_target, validate_host

COOKIE = 'taildesk_session'
logger = logging.getLogger('uvicorn.error')


class DeviceInput(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=60)
    host: str = Field(min_length=1, max_length=253)
    port: int = Field(default=5900, ge=5900, le=5999, strict=True)
    platform: Literal['mac', 'windows', 'linux'] = 'mac'
    _host = field_validator('host')(validate_host)


class LoginInput(BaseModel):
    key: str = Field(min_length=1, max_length=256)


def create_app(settings=None):
    config = settings or Settings()

    @asynccontextmanager
    async def lifespan(app):
        config.data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        config.data_dir.chmod(0o700)
        keyfile = config.data_dir / 'access-key'
        if not keyfile.exists():
            with keyfile.open('x') as handle:
                keyfile.chmod(0o600)
                handle.write(secrets.token_urlsafe(32) + '\n')
        keyfile.chmod(0o600)
        app.state.key_hash = hashlib.sha256(keyfile.read_text().strip().encode()).digest()
        app.state.sessions = {}
        app.state.failures = deque(maxlen=20)
        app.state.sockets = {}
        app.state.store = Store(config.data_dir)
        app.state.bridge = Bridge(config.data_dir)
        try:
            if config.bridge_enabled:
                await app.state.bridge.start()
            yield
        finally:
            for ws in list(app.state.sockets):
                with suppress(Exception):
                    await ws.close(code=1001)
            await app.state.bridge.stop()
            app.state.store.close()

    app = FastAPI(title='Taildesk', lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.config = config

    def session_valid(token):
        expires = app.state.sessions.get(token, 0)
        if expires <= time.monotonic():
            app.state.sessions.pop(token, None)
            return False
        return True

    async def authenticated(request: Request):
        if not session_valid(request.cookies.get(COOKIE)):
            raise HTTPException(401, '登录已过期，请重新输入访问密钥')

    @app.middleware('http')
    async def boundary(request, call_next):
        if request.headers.get('host') not in config.hosts:
            return JSONResponse({'detail': '访问地址未配置，请检查 PUBLIC_ORIGIN'}, status_code=403)
        if request.method not in {'GET', 'HEAD', 'OPTIONS'} and request.headers.get('origin') not in config.origins:
            return JSONResponse({'detail': '不允许的请求来源'}, status_code=403)
        try:
            size = int(request.headers.get('content-length', '0'))
        except ValueError:
            return JSONResponse({'detail': '无效的请求长度'}, status_code=400)
        if size < 0 or size > 16384:
            return JSONResponse({'detail': '请求内容过大'}, status_code=413)
        if request.method in {'POST', 'PUT'} and 'content-length' not in request.headers:
            return JSONResponse({'detail': '请求需要指定长度'}, status_code=411)
        response = await call_next(request)
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'DENY'
        response.headers['Referrer-Policy'] = 'no-referrer'
        response.headers['Cache-Control'] = 'no-store'
        if not config.development:
            response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
        return response

    @app.get('/api/session')
    async def session(request: Request):
        return {'authenticated': session_valid(request.cookies.get(COOKIE))}

    @app.post('/api/login')
    async def login(body: LoginInput, request: Request):
        now = time.monotonic()
        while app.state.failures and app.state.failures[0] < now - 60:
            app.state.failures.popleft()
        if len(app.state.failures) >= 10:
            raise HTTPException(429, '尝试次数过多，请一分钟后重试')
        if not hmac.compare_digest(hashlib.sha256(body.key.encode()).digest(), app.state.key_hash):
            app.state.failures.append(now)
            raise HTTPException(401, '访问密钥不正确')
        for token, expires in list(app.state.sessions.items()):
            if expires <= now:
                del app.state.sessions[token]
        if len(app.state.sessions) >= 128:
            raise HTTPException(429, '登录会话过多，请先退出其他页面或重启网关')
        token = secrets.token_urlsafe(32)
        app.state.sessions[token] = now + config.session_seconds
        response = JSONResponse({'authenticated': True})
        response.set_cookie(COOKIE, token, httponly=True, secure=request.headers.get('origin', '').startswith('https://'), samesite='strict', max_age=config.session_seconds)
        return response

    @app.post('/api/logout', dependencies=[Depends(authenticated)])
    async def logout(request: Request):
        token = request.cookies.get(COOKIE)
        app.state.sessions.pop(token, None)
        for ws, (owner, _) in list(app.state.sockets.items()):
            if owner == token:
                with suppress(Exception):
                    await ws.close(code=4401)
        response = JSONResponse({'ok': True})
        response.delete_cookie(COOKIE)
        return response

    @app.get('/api/devices', dependencies=[Depends(authenticated)])
    async def devices():
        return app.state.store.list()

    def get_device(device_id):
        device = app.state.store.get(device_id)
        if not device:
            raise HTTPException(404, '设备不存在，可能已被删除')
        return device

    @app.post('/api/devices', status_code=201, dependencies=[Depends(authenticated)])
    async def add_device(body: DeviceInput):
        if len(app.state.store.list()) >= 50:
            raise HTTPException(400, '最多保存 50 台设备')
        return app.state.store.save(body)

    async def close_device(device_id):
        for ws, (_, target) in list(app.state.sockets.items()):
            if target == device_id:
                with suppress(Exception):
                    await ws.close(code=4404)

    @app.put('/api/devices/{device_id}', dependencies=[Depends(authenticated)])
    async def edit_device(device_id: str, body: DeviceInput):
        get_device(device_id)
        result = app.state.store.save(body, device_id)
        await close_device(device_id)
        return result

    @app.delete('/api/devices/{device_id}', dependencies=[Depends(authenticated)])
    async def delete_device(device_id: str):
        get_device(device_id)
        app.state.store.delete(device_id)
        await close_device(device_id)
        return {'ok': True}

    @app.post('/api/devices/{device_id}/probe', dependencies=[Depends(authenticated)])
    async def probe(device_id: str):
        device = get_device(device_id)
        writer = None
        try:
            host = await resolve_target(device['host'], device['port'])
            reader, writer = await asyncio.wait_for(asyncio.open_connection(host, device['port']), 4)
            greeting = await asyncio.wait_for(reader.readexactly(12), 4)
            if not greeting.startswith(b'RFB ') or not greeting.endswith(b'\n'):
                return {'reachable': False, 'message': '端口可达，但不是可识别的 VNC 服务'}
            return {'reachable': True, 'message': 'VNC 服务可达，可以连接'}
        except (OSError, ValueError, asyncio.TimeoutError, asyncio.IncompleteReadError):
            return {'reachable': False, 'message': '暂时无法访问 VNC：请检查 Tailscale、共享设置、访问规则及设备是否休眠'}
        finally:
            if writer:
                writer.close()
                with suppress(OSError):
                    await writer.wait_closed()

    @app.websocket('/ws/{device_id}')
    async def remote(ws: WebSocket, device_id: str):
        owner = ws.cookies.get(COOKIE)
        if ws.headers.get('origin') not in config.origins or ws.headers.get('host') not in config.hosts or not session_valid(owner):
            await ws.close(code=4401)
            return
        device = app.state.store.get(device_id)
        if not device or len(app.state.sockets) >= 8:
            await ws.close(code=4404 if not device else 4429)
            return
        app.state.sockets[ws] = (owner, device_id)
        token = None
        tasks = []
        started = time.monotonic()
        totals = {'to_browser': 0, 'to_vnc': 0}
        reason, close_code = 'gateway_error', 1011
        try:
            await ws.accept()
            host = await resolve_target(device['host'], device['port'])
            token = app.state.bridge.issue(host, device['port'])
            # Browser backpressure pauses this loopback reader, including Pong
            # frames. Keep pings but don't mistake queued screen data for a dead
            # local worker. The public browser connection still has its heartbeat.
            async with connect(f'ws://127.0.0.1:{app.state.bridge.port}/?token={token}', subprotocols=['binary'], max_size=8 * 1024 * 1024, open_timeout=5, ping_timeout=None, proxy=None) as upstream:
                app.state.bridge.revoke(token)
                token = None

                async def to_vnc():
                    try:
                        while True:
                            message = await ws.receive_bytes()
                            if len(message) > 1024 * 1024:
                                return 'input_too_large', 1009
                            totals['to_vnc'] += len(message)
                            await upstream.send(message)
                    except WebSocketDisconnect as exc:
                        return 'browser_closed', exc.code

                async def to_browser():
                    try:
                        async for message in upstream:
                            await ws.send_bytes(message)
                            totals['to_browser'] += len(message)
                    except WebSocketDisconnect as exc:
                        return 'browser_closed', exc.code
                    # A clean websockify close means the downstream TCP peer ended.
                    return 'target_closed', 1011

                async def watchdog():
                    while session_valid(owner):
                        await asyncio.sleep(1)
                    await ws.close(code=4401)
                    return 'session_expired', 4401

                tasks = [asyncio.create_task(to_vnc()), asyncio.create_task(to_browser()), asyncio.create_task(watchdog())]
                done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                # Retrieve the result instead of silently discarding relay errors.
                reason, close_code = next(iter(done)).result()
        except ConnectionClosed as exc:
            if exc.sent and exc.sent.reason == 'keepalive ping timeout':
                reason = 'bridge_timeout'
            elif exc.rcvd and exc.rcvd.reason == 'Target closed':
                reason = 'target_closed'
            else:
                reason = 'bridge_closed'
        except (OSError, ValueError, asyncio.TimeoutError):
            reason = 'target_unreachable'
        except WebSocketDisconnect as exc:
            reason, close_code = 'browser_closed', exc.code
        except RuntimeError:
            reason = 'gateway_error'
        finally:
            for task in tasks:
                task.cancel()
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)
            if token:
                app.state.bridge.revoke(token)
            app.state.sockets.pop(ws, None)
            # Counts and fixed reason codes only; no payloads, credentials or cookies.
            logger.info('Taildesk remote end reason=%s code=%s seconds=%.1f to_browser=%d to_vnc=%d',
                        reason, close_code, time.monotonic() - started,
                        totals['to_browser'], totals['to_vnc'])
            with suppress(Exception):
                await ws.close(code=close_code if close_code not in {1005, 1006, 1015} else 1011,
                               reason=f'Taildesk:{reason}')

    if (ROOT / 'dist').is_dir():
        app.mount('/', StaticFiles(directory=ROOT / 'dist', html=True), name='web')
    return app
