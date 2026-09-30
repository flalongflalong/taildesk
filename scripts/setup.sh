#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
taildesk_python="${TAILDESK_PYTHON:-python3}"
"$taildesk_python" -m venv .venv
.venv/bin/python -m pip install --index-url https://pypi.org/simple -r requirements.txt
npm ci --no-fund
npm run build
echo 'Taildesk 已安装。运行 npm start，然后打开 http://127.0.0.1:8787'
