# Taildesk

**把 Tailscale 网络里的电脑，放进手机浏览器。**

A self-hosted, mobile-friendly VNC gateway for your Tailscale network.

Taildesk 让 iPhone、iPad 或电脑浏览器通过网页查看和控制自己的电脑。它把设备列表、手机鼠标摇杆、常用键盘和多屏区域选择放在一个轻量界面里，使用 React + TypeScript、noVNC、FastAPI 和 websockify 实现。

适合已经使用 Tailscale、希望偶尔用手机处理桌面任务的人：查看运行进度、点击桌面应用、输入命令，或在几台个人电脑之间切换。网关可以运行在被控电脑上，也可以放在一台常开的电脑上。

目前是个人自托管工具，主要使用场景是 **iPhone → Mac**。iPhone 只作为控制端。其他操作系统须自行提供兼容的 VNC 服务；本项目不提供 RDP、声音传输、文件传输、远程唤醒或多人权限管理，也不适合高帧率游戏和视频剪辑。

## 能做什么

| 功能 | 使用方式 |
| --- | --- |
| 管理几台电脑 | 添加、编辑、搜索设备，检查 VNC 服务是否可达，一键连接 |
| 手机鼠标 | 大圆形摇杆、左右键、拖拽，以及页面发送位置的指针提示 |
| 常用键盘 | Enter、退格、Esc、Tab、方向键、修饰键、F1–F12 和系统快捷键 |
| 三种输入方式 | 文字输入、屏幕键盘、快捷键面板直接切换 |
| 尽量多看桌面 | 操作区默认收起；展开后悬浮，底部单行按键也可放到画面下方 |
| 横屏和多屏 | 跟随手机方向或手动旋转页面；按显示区域查看远端桌面 |
| 查看模式 | 适应屏幕、原始尺寸、平移、只读、画质设置 |
| 断线恢复 | 自动重试，返回前台时继续连接；认证失败时提示重新输入凭据 |

详细操作和平台限制见 [使用指南](docs/usage.md)。

## 工作方式

```text
iPhone / 电脑浏览器（已连接 Tailscale）
          │ HTTPS / WSS
          ▼
Tailscale Serve（仅 tailnet 内可访问）
          │ 本机回环
          ▼
Taildesk 网关：登录、设备管理、WebSocket
          │ websockify：WebSocket → TCP
          ▼
目标电脑的 Tailscale 地址 + 屏幕共享 / VNC
```

**Tailscale 负责设备互通，VNC 负责桌面画面与输入，Taildesk 提供网页入口和手机操作界面。** 浏览器不能直接连接普通 VNC 的 TCP 端口，所以需要网关；不需要额外购买公网服务器。

## 快速开始

### 1. 准备环境

- 网关电脑：建议 macOS，安装 Node.js **22.6+**、Python **3.10+**（建议 3.12）、Git 和 Tailscale。Linux 可运行同一套 POSIX 启动脚本；原生 Windows 网关暂不支持。
- 控制端：现代浏览器，手机优先使用 Safari，并连接到同一个可互通的 Tailscale 网络。
- 被控电脑：Tailscale 在线、未休眠，已经启用屏幕共享 / VNC；允许网关访问其 VNC 端口。

下载本仓库源码，或克隆你正在查看的仓库，然后在项目目录运行以下命令。仓库不附带任何预设设备、访问密钥或实际部署地址。

### 2. 安装并在本机启动

```bash
bash scripts/setup.sh
# 仅首次配置时复制；已有 .env 请直接编辑，避免覆盖。
cp .env.example .env
npm start
```

安装脚本会创建 Python 虚拟环境、安装依赖并构建网页。打开 [本机入口](http://127.0.0.1:8787)，首次启动后在网关电脑的另一个终端查看密钥：

```bash
cat .data/access-key
```

安装脚本默认使用 `python3`。装有多个版本时，首次安装可运行 `TAILDESK_PYTHON=python3.12 bash scripts/setup.sh` 来选择解释器。某些平台上的 Python 依赖需要额外编译，首次安装可能较慢。切换已有虚拟环境的 Python 版本前，请先重建该虚拟环境。

将密钥填入登录页。**网关访问密钥用于进入 Taildesk；VNC 密码用于连接电脑，两者不同。** 如果设置了 `TAILDESK_DATA_DIR`，请从该目录读取 `access-key`。

`npm start` 默认只监听 `127.0.0.1:8787`，同时提供网页、API 和内部桥接。关闭启动终端会停止服务；当前没有自动安装开机启动。

### 3. 配置手机可以打开的地址

在网关电脑检查现有 Serve 配置，再为 Taildesk 配置 HTTPS 入口：

```bash
tailscale serve status
tailscale serve --bg --https=443 http://127.0.0.1:8787
```

首次使用可能需要打开命令给出的管理台链接，启用 HTTPS。`--bg` 让 Serve 的配置持续生效；Taildesk 本身仍需保持运行。Serve 限制在 Tailscale 网络内，不需要启用 Funnel。具体行为见 [Tailscale Serve 文档](https://tailscale.com/docs/reference/tailscale-cli/serve)。

将输出的 **准确 HTTPS 源地址** 写进 `.env`，下面只是示例：

```dotenv
PRIVATE_ORIGIN=https://gateway.example.ts.net
PUBLIC_ORIGIN=
PORT=8787
DEVELOPMENT=0
```

源地址只包含协议、域名和可选端口，不包含路径。本项目不支持子路径部署。配置完成后停止并重新运行 `npm start`。

手机保持 Tailscale 已连接，用 Safari 打开 **Serve 输出的实际地址**，输入同一个网关密钥即可。手机不能使用上面的 `127.0.0.1` 地址，那会指向手机自己。也可通过 Safari「分享 → 添加到主屏幕」保存入口；应用需要联网。

如果 443 已被其他服务使用，选择空闲 HTTPS 端口，例如 `--https=8443`，并把 `:8443` 加入 `.env` 中的源地址和手机访问地址。不要覆盖其他服务的 Serve 配置。

### 4. 开启 Mac 屏幕共享并添加设备

1. Mac「系统设置 → 通用 → 共享」中开启「屏幕共享」，选择允许访问的用户。旧版 macOS 的入口可能在「系统偏好设置 → 共享」。
2. 如果使用经典 VNC 密码认证，在屏幕共享的设置中启用「VNC 查看器可以使用密码控制屏幕」，设置专用密码。不同版本也可能要求 Mac 用户名和密码；按页面认证提示填写。参见 [Apple 屏幕共享说明](https://support.apple.com/en-md/guide/mac-help/mh11848/mac)。
3. 在 Taildesk 添加设备：填写显示名称、**目标电脑**的 Tailscale IP 或完整 `.ts.net` 名称，以及 VNC 端口（通常为 `5900`）。无需添加 iPhone 的地址。
4. 先点「检查连接」，再点「连接桌面」，输入 VNC 凭据。服务可达只表示检测成功，不代表已经通过认证。

允许的目标是 Tailscale IPv4 / IPv6、解析到 Tailscale 地址的完整 `.ts.net` 名称，以及网关本机 `127.0.0.1` / `::1`；端口范围为 `5900–5999`。普通局域网地址和公网 IP 不在允许范围内。

## 配置与数据

| 配置 | 默认值 / 用途 |
| --- | --- |
| `PORT` | `8787`，网关本机端口 |
| `PRIVATE_ORIGIN` | 空；推荐填写 Tailscale Serve 的 HTTPS 源地址 |
| `PUBLIC_ORIGIN` | 空；可选的第二个 HTTPS 反向代理入口，日常使用不需要 |
| `DEVELOPMENT` | `0`；设为 `1` 才允许本机 Vite 开发入口 |
| `TAILDESK_DATA_DIR` | 项目中的 `.data/`，存放私有运行数据 |

`.data/access-key` 是网关密钥；`.data/devices.sqlite3` 保存设备名称、地址、端口和平台。VNC 密码不写入数据库或浏览器本地存储；浏览器内的会话和凭据仍须在可信设备上使用。网关会话保存在内存中，最长 12 小时，重启服务后需要重新登录。

备份时先停止服务，再复制私有数据目录。轮换密钥时，停止服务，将原 `access-key` 移到安全位置，重新启动便会生成新密钥。

前端不使用外部 CDN、分析服务或外部字体。网关会转发远程桌面流量，网关管理员属于信任范围；这不是对网关不可见的端到端加密系统。推荐只通过 Tailscale Serve 使用。完整边界见 [安全说明](SECURITY.md)。

## 常见问题

| 现象 | 先检查 |
| --- | --- |
| 手机打不开页面 | Tailscale 是否已连接、网关是否醒着、`npm start` 是否在运行、Serve 是否仍有对应入口 |
| 提示访问地址未配置 | `.env` 的源地址是否与浏览器的协议、域名、端口完全一致；修改后是否重启 |
| 页面能开但电脑不可达 | 目标电脑在线且未休眠、VNC 已开启、Tailscale 访问规则允许网关连接目标端口 |
| VNC 验证失败 | 应输入的是 VNC 专用密码还是 Mac 账户凭据；不要填网关访问密钥 |
| 有鼠标响应但画面很慢 | 优先使用内网 Serve 入口，尝试「流畅」画质，检查网络中继与远端桌面分辨率 |
| 多屏切换后仍然卡顿 | 区域选择只是裁剪显示，完整桌面仍在传输，不会直接降低带宽需求 |
| 手机横屏，系统键盘仍竖着 | 关闭 iPhone 竖屏锁定后横拿手机；网页旋转不能强制旋转系统输入法 |
| 锁屏或切换应用后断线 | 返回前台等待重连；会话过期或网关重启时重新登录 |

连接质量取决于网络路径、VNC 编码和桌面分辨率。Tailscale Serve 不保证设备间一定直连；可参考 [Tailscale 连接类型](https://tailscale.com/docs/reference/connection-types)。

## 开发与验证

```bash
# 终端一：启动开发用网关
DEVELOPMENT=1 npm start
# 终端二：启动前端
npm run dev
```

开发页面为 `http://127.0.0.1:5173`，默认代理到 `8787`；自定义后端端口时也需修改 `vite.config.ts` 的开发代理。生产模式修改前端后需要重新构建并刷新。

```bash
npm run check
npm run test:controls
npm test
npm run format:check
npm run build
npm run release:check
```

后端测试包含真实 websockify 桥接到模拟 VNC 服务的握手、画面、输入、权限撤销及慢连接回归，需要允许本机监听端口，不连接个人电脑。详细说明见 [贡献指南](CONTRIBUTING.md)。

```text
src/          网页界面、触控、键盘和多屏控制
server/       网关、设备存储、访问校验、websockify 进程
tests/        控制测试、网关测试和模拟 VNC 服务
scripts/      安装、noVNC 构建适配、发布前检查与源码导出
docs/         操作说明与发布步骤
licenses/     第三方许可证与署名
```

## 发布与许可证

Taildesk 自有代码使用 [MIT License](LICENSE)，允许使用、修改及商用，须保留版权和许可声明。noVNC、websockify 等第三方组件各自的许可仍然适用，详见 [第三方说明](THIRD_PARTY_NOTICES.md)。Taildesk 与 Tailscale、Screens、ToDesk 没有官方关联。

准备公开自己的副本时，先运行 `npm run release:check`，再运行 `npm run release:source` 生成 `release/taildesk-source.zip`。它只导出审查范围内的源码和文档，排除运行数据、密钥、开发记录及截图；不执行 Git 提交或上传。首次发布和后续修改的核对步骤见 [发布指南](docs/publishing.md)。
