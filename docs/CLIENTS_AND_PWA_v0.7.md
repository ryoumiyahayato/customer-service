# 客户端与 PWA v0.7

## 当前状态

PWA 已进入 MVP：项目已具备 `manifest.webmanifest`、service worker、离线页、基础图标和生产环境 service worker 注册入口。

桌面客户端 EXE 壳已进入 scaffold：`deploy/desktop-client` 提供独立 CLI/Tauri-ready 结构，用于后续 Tauri 或 Electron 打包。

## PWA 当前能力

- `public/manifest.webmanifest`：提供应用名称、启动范围、standalone 显示模式、主题色和图标。
- `public/service-worker.js`：缓存基础静态资源。
- `public/offline.html`：在导航请求离线失败时作为 fallback。
- `public/icons/`：提供本地 SVG 图标，不引用外部资源。
- `src/pwa.ts`：在生产环境且浏览器支持时注册 service worker。

service worker 明确不缓存 `/api/*`，不缓存非 GET 请求，不处理 WebSocket，不输出 token、cookie 或其他敏感值。

## 桌面客户端 EXE 壳当前能力

- 独立 package：`deploy/desktop-client`。
- CLI 支持 `--smoke` 和 `--plan <config.json>`。
- 配置字段只包含非敏感入口配置：应用名、后台 URL、访客根 URL、模式和窗口偏好。
- URL 校验禁止 `file://`、`javascript:`、`data:`。
- 启动计划会脱敏 URL 查询参数中的 `token`、`code`、`session`、`cookie`、`password`、`secret` 等字段。
- 当前 launcher 是 mock 接口，不真正打开浏览器或 WebView。
- 本地配置存储只保留非敏感配置，不包含 password、token、cookie 或 session。

## 与 Windows 部署向导的区别

桌面客户端 EXE 壳只打开已经部署好的客服系统，不负责安装服务器、不执行 deploy、不打包后端、不执行 `install.sh`、不接云厂商 API。

Windows 部署向导 EXE 面向部署流程，负责后续连接远程 Linux 服务器、上传部署目录并执行安装脚本。

## 当前未完成

- 真正 EXE 打包。
- Tauri / Electron GUI。
- 系统托盘。
- 原生通知。
- 自动更新。
- Android APK。
- 更完整的离线业务体验。

## 安全边界

- 不把后端打包进客户端。
- 不把 secret 写入客户端。
- 不保存 password、token、cookie 或 session。
- 不复制生产消息正文、附件 key、session 明细或生产数据到安装包。
