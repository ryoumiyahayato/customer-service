# 客户端与 PWA v0.7

## 当前状态

PWA 已进入 MVP：项目已具备 `manifest.webmanifest`、service worker、离线页、基础图标和生产环境 service worker 注册入口。

桌面客户端 EXE 壳已进入 scaffold：`deploy/desktop-client` 提供独立 CLI/Tauri-ready 结构，用于后续 Tauri 或 Electron 打包。

Android APK 壳已进入 scaffold：`deploy/android-shell` 提供 Gradle / Kotlin / WebView MVP 骨架，用于后续接入 Android Studio、签名和真实 APK 打包。

## PWA 当前能力

- `public/manifest.webmanifest`：提供应用名称、启动范围、standalone 显示模式、主题色和图标。
- `public/service-worker.js`：缓存基础静态资源和离线页。
- `public/offline.html`：在导航请求离线失败时作为 fallback。
- `public/icons/`：提供本地 SVG 图标，不引用外部资源。
- `src/pwa.ts`：在生产环境且浏览器支持时注册 service worker。

service worker 明确不缓存 `/api/*`，不缓存非 GET 请求，不处理 WebSocket，不缓存带 token、session、cookie、password、secret 或 key 查询参数的 URL，不输出 token、cookie 或其他敏感值。

验证方式：

- 构建后检查 `manifest.webmanifest` 是否能被浏览器识别，图标是否来自 `public/icons/`。
- 在生产构建中确认 service worker 注册成功；开发环境可跳过注册。
- 离线导航时应显示 `offline.html`。
- 需要重新验证缓存时，可在浏览器 DevTools 的 Application 面板中 unregister service worker 并清理 Cache Storage。
- 当前不支持原生推送，后续再接浏览器推送和移动端原生通知。

## 桌面客户端 EXE 壳当前能力

- 独立 package：`deploy/desktop-client`。
- CLI 支持 `--smoke`、`--plan <config.json>` 和 `--package-check`。
- npm scripts 支持 `npm run smoke`、`npm run plan`、`npm run package:check`。
- 配置字段只包含非敏感入口配置：应用名、窗口标题、后台 URL、访客根 URL、启动入口和窗口偏好。
- URL 校验禁止 `file://`、`javascript:`、`data:`。
- 启动计划会脱敏 URL 查询参数中的 `token`、`code`、`session`、`cookie`、`password`、`secret`、`key`、`SETUP_TOKEN`、`ENCRYPTION_KEY` 等字段。
- 当前 launcher 是 mock 接口，不真正打开浏览器或 WebView。
- 本地配置存储只保留非敏感配置，不包含 password、token、cookie 或 session。
- 示例配置位于 `deploy/desktop-client/examples/client-config.example.json`，只使用 `example.com` 占位。
- 当前 package check 只确认打包前 scaffold、示例配置和可选 Tauri 工程状态，不声称已生成真实 EXE。

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
- 如果 Windows LTSC 开发机缺少 Android SDK、Gradle 或 wrapper，应报告 Gradle 检查未执行；真实 APK 构建需要 Android Studio、CI 或实机环境。
- release signing 只保留占位说明，keystore 和签名密码不得写入 git。

## Windows LTSC 可执行检查

- 主仓库：`npm.cmd run typecheck`、`npm.cmd run doctor`、`npm.cmd run lifecycle:ci-check`、`npm.cmd run build`。
- `lifecycle:ci-check` 不访问 Cloudflare/D1，适合普通 CI/audit；`lifecycle:dry-run` 会访问 Wrangler remote read-only D1，必须在明确授权的 Cloudflare/D1 环境中运行，普通 CI/audit 不应运行。
- 桌面客户端：`npm.cmd install`、`npm.cmd run smoke`、`npm.cmd run plan`、`npm.cmd run package:check`。
- PWA：通过根构建产物检查 manifest、service worker 和 offline page。
- Android：可做静态审计；只有在具备 Android SDK / Gradle / wrapper 时才执行 `gradle tasks` 和 `gradle assembleDebug`。
- GitHub Actions Linux CI 已补足本机缺口：在 `ubuntu-latest` 上运行 root 检查、桌面客户端 smoke/plan/package-check，并对 Android shell 做 `settings.gradle`、根 `build.gradle`、app `build.gradle` 和 `AndroidManifest.xml` 文件存在性检查。

必须留给 Android SDK、Tauri、CI 或实机环境的检查：

- 真实 EXE 打包、签名、安装和启动。
- Android APK assemble、签名、安装和 WebView 实机加载。
- 桌面自动更新、系统托盘、原生通知。
- Android 原生通知、文件选择器、下载管理和应用商店发布。

当前 CI 不下载 Android SDK，不执行 `assembleDebug`，不生成 APK，也不声称 APK 构建通过；真实移动端验证仍需 Android Studio、CI 专用 Android 环境或实机环境。

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
