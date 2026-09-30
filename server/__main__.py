from dotenv import load_dotenv
import uvicorn

from .config import ROOT, Settings


def main():
    load_dotenv(ROOT / '.env')
    config = Settings()
    print(f'\nTaildesk → http://127.0.0.1:{config.port}')
    print(f'访问密钥文件：{config.data_dir / "access-key"}（首次启动时自动生成）')
    print('仅监听本机。跨设备使用请按照 README 配置 Tailscale Serve。\n')
    uvicorn.run('server.app:create_app', factory=True, host='127.0.0.1', port=config.port, proxy_headers=False, access_log=False, ws_max_size=1024 * 1024, timeout_graceful_shutdown=5)


if __name__ == '__main__':
    main()
