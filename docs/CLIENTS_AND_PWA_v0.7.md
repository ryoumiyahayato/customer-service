# 客户端与 PWA v0.7

## 当前状态

PWA 已进入 MVP：项目已具备 `manifest.webmanifest`、service worker、离线页、基础图标和生产环境 service worker 注册入口。

桌面客户端 EXE 壳已进入 scaffold：`deploy/desktop-client` 提供独立 CLI/Tauri-ready 结构，用于后续 Tauri 或 Electron 打包。

Android APK 壳已进入 scaffold：`deploy/android-shell` 提供 Gradle / Kotlin / WebView MVP 骨架，用于后续接入 Android Studio、签名和真实 APK 打包。

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

## Android APK 壳当前能力

- 独立 Gradle 工程：`deploy/android-shell`。
- Android package / App ID：`net.customerchat.app`，不包含个人姓名、邮箱、handle、项目成员标识或生产域名。
- WebView 首版入口：默认加载 `AppConfig.adminUrl`，当前只使用占位 HTTPS 域名，发布前必须替换为实际后台地址。
- URL 安全边界：只允许 `http` / `https` scheme，拦截 `file:`、`content:`、`javascript:`、`intent:` 等非页面 scheme。
- WebView 默认关闭 file / content access，不注入 JavaScript bridge。
- Android 权限保持最小化：当前只声明 `android.permission.INTERNET`。
- 支持 Android back 键返回 WebView 历史。
- 提供基础网络安全配置：生产默认禁用明文流量，仅为本地开发保留 localhost / `10.0.2.2` cleartext 例外。
- 提供后续测试清单：权限、包名、URL scheme、敏感值、JavaScript bridge、生产 HTTPS。

## 与 Windows 部署向导的区别

桌面客户端 EXE 壳只打开已经部署好的客服系统，不负责安装服务器、不执行 deploy、不打包后端、不执行 `install.sh`、不接云厂商 API。

Android APK 壳同样只作为已经部署好的客服系统入口，不负责安装服务器、不执行 deploy、不打包后端、不执行 `install.sh`、不接云厂商 API。

Windows 部署向导 EXE 面向部署流程，负责后续连接远程 Linux 服务器、上传部署目录并执行安装脚本。

## 当前未完成

- 真正 EXE 打包。
- Tauri / Electron GUI。
- 系统托盘。
- 原生通知。
- 自动更新。
- Android 真实 APK 签名、安装包发布和应用商店分发。
- Android 原生通知、文件选择器、下载管理和自动更新。
- 更完整的离线业务体验。

## 安全边界

- 不把后端打包进客户端。
- 不把 secret 写入客户端。
- 不保存 password、token、cookie 或 session。
- 不复制生产消息正文、附件 key、session 明细或生产数据到安装包。
