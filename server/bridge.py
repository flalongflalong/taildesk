"""Private websockify worker. Only short-lived server-issued tokens select targets."""
import asyncio
import os
import secrets
import re
import signal
import socket
import subprocess
import sys
from contextlib import suppress
from pathlib import Path


class TokenPlugin:
    """Read just the requested token; concurrent revocations cannot break other sessions."""
    def __init__(self, source):
        self.source = Path(source)

    def lookup(self, token):
        if not re.fullmatch(r'[A-Za-z0-9_-]{43}', token or ''):
            return None
        try:
            return (self.source / token).read_text().strip().rsplit(':', 1)
        except FileNotFoundError:
            return None


class Bridge:
    def __init__(self, directory: Path):
        self.tokens = directory / 'bridge-tokens'
        self.tokens.mkdir(mode=0o700, exist_ok=True)
        for old in self.tokens.iterdir():
            if old.is_file():
                old.unlink()
        self.process = None
        self.port = 0

    async def start(self):
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            self.port = sock.getsockname()[1]
        self.process = subprocess.Popen([
            sys.executable, '-m', 'server.worker',
            '--token-plugin', 'server.bridge.TokenPlugin', '--token-source', str(self.tokens),
            f'127.0.0.1:{self.port}',
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        for _ in range(100):
            if self.process.poll() is not None:
                raise RuntimeError('websockify 启动失败，请检查 Python 依赖')
            try:
                _, writer = await asyncio.open_connection('127.0.0.1', self.port)
                writer.close()
                await writer.wait_closed()
                return
            except OSError:
                await asyncio.sleep(0.05)
        await self.stop()
        raise RuntimeError('websockify 启动超时')

    def issue(self, host, port):
        if not self.process or self.process.poll() is not None:
            raise RuntimeError('连接桥接服务已停止，请重启网关')
        token = secrets.token_urlsafe(32)
        path = self.tokens / token
        # The plugin splits at the last colon so IPv6 targets remain intact.
        with path.open('x') as handle:
            path.chmod(0o600)
            handle.write(f'{host}:{port}\n')
        return token

    def revoke(self, token):
        (self.tokens / token).unlink(missing_ok=True)

    async def stop(self):
        if self.process:
            with suppress(ProcessLookupError):
                os.killpg(self.process.pid, signal.SIGTERM)
            with suppress(subprocess.TimeoutExpired):
                await asyncio.to_thread(self.process.wait, 3)
            if self.process.poll() is None:
                with suppress(ProcessLookupError):
                    os.killpg(self.process.pid, signal.SIGKILL)
                await asyncio.to_thread(self.process.wait)
