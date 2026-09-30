import os
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent


@dataclass
class Settings:
    data_dir: Path = field(default_factory=lambda: Path(os.getenv('TAILDESK_DATA_DIR', ROOT / '.data')))
    port: int = field(default_factory=lambda: int(os.getenv('PORT', '8787')))
    public_origin: str = field(default_factory=lambda: os.getenv('PUBLIC_ORIGIN', '').rstrip('/'))
    private_origin: str = field(default_factory=lambda: os.getenv('PRIVATE_ORIGIN', '').rstrip('/'))
    development: bool = field(default_factory=lambda: os.getenv('DEVELOPMENT') == '1')
    session_seconds: int = 12 * 60 * 60
    bridge_enabled: bool = True

    def __post_init__(self):
        for name, origin in [('PUBLIC_ORIGIN', self.public_origin), ('PRIVATE_ORIGIN', self.private_origin)]:
            if origin:
                parsed = urlparse(origin)
                if parsed.scheme != 'https' or not parsed.hostname or parsed.path or parsed.query or parsed.fragment or parsed.username:
                    raise ValueError(f'{name} 必须是 HTTPS 源地址，例如 https://gateway.example.ts.net（不含路径）')

    @property
    def origins(self):
        values = {f'http://127.0.0.1:{self.port}', f'http://localhost:{self.port}'}
        if self.public_origin:
            values.add(self.public_origin)
        if self.private_origin:
            values.add(self.private_origin)
        if self.development:
            values.update({'http://127.0.0.1:5173', 'http://localhost:5173'})
        return values

    @property
    def hosts(self):
        return {urlparse(origin).netloc for origin in self.origins}
