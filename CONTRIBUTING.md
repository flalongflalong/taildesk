# 参与开发

先按 [README](README.md) 安装。提交改动时说明解决的具体问题、可复现步骤及验证结果；移动端变化请说明横竖屏和输入方式。提交的 Taildesk 原创代码沿用 MIT，第三方代码须保留原许可并注明来源。

## 本地检查

```bash
npm run check
npm run test:controls
npm test
npm run format:check
npm run build
npm run release:check
```

`npm test` 需要虚拟环境和本机端口权限，使用临时目录和模拟 VNC，不依赖真实电脑、Tailscale 账户或真实凭据。新增的 GitHub Actions 工作流运行同样的主要检查；托管执行结果以仓库 Actions 页面为准。

## 独立调试远控

```bash
# 终端一：仅监听回环、无密码的模拟桌面
.venv/bin/python -m tests.vnc_fixture --port 5909 --displays
# 终端二：隔离测试数据和端口，避免影响自己的正式连接
TAILDESK_DATA_DIR=.data/demo PORT=8790 npm start
```

打开 `http://127.0.0.1:8790`，使用 `.data/demo/access-key` 中新生成的密钥，添加 `127.0.0.1:5909`。这是一张程序生成的测试画面，不是实际电脑桌面。测试完成后停止两个进程。

前端开发代理默认指向 8787；需要对独立网关进行热更新调试时，另行调整 `vite.config.ts` 的代理端口。

## 修改 noVNC 集成

noVNC 固定为 1.7.0。`scripts/novnc-orientation.mjs` 会对指定 RFB 源码进行限定替换，匹配失败时中止构建；`src/remote/viewport.ts` 使用了内部视口接口。升级前需核对上游变化，并验证鼠标、滚轮、触控、横屏和多屏坐标。相关第三方代码的许可证不随 Taildesk 的 MIT 声明改变。

## 公开文件

真实配置、数据、运行日志、调试记录和截图留在本地。示例统一使用 `example` 域名与测试地址。增加公开文件时，同时核对 `scripts/release.py` 的允许范围；不要为了让检查通过而排除包含凭据的源码。

截图不是当前源码包的组成部分；如需添加产品截图，使用模拟桌面，人工检查画面及元数据后再扩展发布规则。
