# 产品化文档索引

当前 Cloudflare 版已上线，作为产品化路线的基准版本。后续按大包推进，每轮完成可运行骨架、自检、审计和提交。

## 文档入口

- [产品化路线图](./PRODUCTIZATION_ROADMAP_TO_2026-07-20.md)
- [v0.4 通用服务器部署架构](./SERVER_DEPLOYMENT_ARCHITECTURE_v0.4.md)
- [v0.6 Windows 部署向导 EXE](./WINDOWS_DEPLOY_WIZARD_v0.6.md)
- [v0.7 客户端与 PWA](./CLIENTS_AND_PWA_v0.7.md)
- [v0.8 服务端加密存储](./SERVER_SIDE_ENCRYPTION_v0.8.md)
- [产品化最终审计](./PRODUCTIZATION_FINAL_AUDIT.md)

## 部署骨架

- `deploy/linux/README.md`
- `deploy/linux/.env.example`
- `deploy/linux/docker-compose.yml`
- `deploy/linux/Caddyfile`
- `deploy/linux/install.sh`
- `deploy/linux/healthcheck.sh`
- `deploy/linux/backup.sh`
- `deploy/linux/restore.sh`
- `deploy/linux/upgrade.sh`
- `server-generic/scripts/migrate.mjs`
- `deploy/windows-wizard/README.md`
- `deploy/windows-wizard/package.json`
- `deploy/windows-wizard/examples/deploy-plan.example.json`
- `deploy/desktop-client/README.md`
- `deploy/desktop-client/package.json`
- `deploy/desktop-client/examples/client-config.example.json`
- `deploy/android-shell/README.md`
- `deploy/android-shell/app/src/test/README.md`
- `deploy/android-shell/settings.gradle`
- `deploy/android-shell/build.gradle`
- `deploy/android-shell/app/build.gradle`
- `deploy/android-shell/app/src/main/AndroidManifest.xml`
- `deploy/android-shell/app/src/main/java/net/customerchat/app/MainActivity.kt`
- `deploy/android-shell/app/src/main/java/net/customerchat/app/AppConfig.kt`
- `deploy/android-shell/app/src/main/java/net/customerchat/app/WebViewSecurity.kt`
- `server-generic/src/encryption.ts`
- `server-generic/src/encryptionConfig.ts`
- `server-generic/migrations/0004_encryption_foundation.sql`

## 推进原则

- Cloudflare 线上版保持稳定。
- 通用服务器版先做 MVP。
- Windows / PWA / 客户端 EXE / Android APK 先做入口壳。
- 服务端加密先覆盖新消息。
- 高风险操作继续单独授权。

## Windows 部署向导状态

Windows 部署向导已进入 MVP scaffold：当前是独立 CLI/Tauri-ready package，可生成脱敏部署计划并运行 smoke；已新增真实 SSH / SFTP adapter 第一包，尚未打包真实 EXE。

Windows 部署向导真实 SSH adapter 已进入 MVP：当前保留 mock / dry-run，新增 real SSH / SFTP 上传 `deploy/linux`、远程 `install.sh --self-check`、`--dry-run` 和 opt-in `--migrate` 流程；真实连接必须显式 `--real` 且计划文件 `dryRun=false`。

## PWA 与桌面客户端状态

PWA 已进入 MVP：包含 manifest、service worker、offline page、图标和生产注册入口；service worker 只缓存静态资源和离线页，不缓存 API、非 GET、WebSocket 或带敏感查询参数的 URL。桌面客户端 EXE 壳已进入可打包准备第一包：当前是独立 CLI/Tauri-ready package，可生成脱敏启动计划、运行 smoke、运行 package check，并通过示例配置说明后台地址配置方式；尚未打包真实 EXE，也未接入 Tauri/Electron GUI。

## Android APK 壳状态

Android APK 壳已进入可构建准备第一包：当前是独立 Gradle / Kotlin / WebView 工程，默认使用占位 HTTPS URL，只声明 `INTERNET` 权限，包含 URL scheme 白名单、禁用 file/content access、不注入 JavaScript bridge、生产 cleartext 默认禁用和敏感 URL 脱敏等基础安全边界；README 已说明 Gradle / Android SDK 缺失时的报告口径和 release signing 占位。尚未做真实签名打包、应用商店分发、原生通知、文件选择器、下载管理和自动更新。

## 服务端加密存储状态

服务端加密存储已进入 MVP 实现：`server-generic` 当前支持新消息正文 AES-256-GCM 加密、新附件展示文件名元数据加密、旧明文字段兼容读取、密钥版本标记和 smoke 自检。当前不迁移旧数据，不加密附件内容本体；`ENCRYPTION_KEY` 必须由服务器环境变量提供，备份恢复必须同时保护密钥管理记录。

## Linux 部署闭环状态

Linux 部署脚本已进入接近真实 VPS 可运行的最小闭环：`install.sh` 支持 self-check、dry-run 和显式 `--migrate`，`healthcheck.sh` 只读输出安全 setup 枚举，`backup.sh` 默认不备份 `.env`，`restore.sh` 强确认后才覆盖数据，`upgrade.sh` 默认不运行 migration。

## GitHub Actions Linux CI 验证状态

已新增 `.github/workflows/productization-validation.yml`，在 `ubuntu-latest` 上补足 Windows LTSC 本机缺少 bash、Docker 和 Android SDK 时的验证缺口。当前覆盖 root、lifecycle CI-safe validation、`server-generic`、`deploy/linux` bash 语法、Docker Compose config、Windows 部署向导 dry-run、桌面客户端 package-check 和 Android shell 静态文件检查。

该 lifecycle CI-safe check 不访问 Cloudflare 或 D1，只验证安全边界和静态约束；普通 audit/CI 默认使用 `npm.cmd run lifecycle:ci-check`。本地或授权环境中的 `npm run lifecycle:dry-run` 仍用于真实 Wrangler read-only D1 dry-run，必须有明确 Cloudflare/D1 授权，普通 audit/CI 不应运行。该 CI 不是真实 VPS 或真实 Cloudflare/D1 验证，不执行 Cloudflare deploy，不跑 production migration，不真实 SSH，不生成 APK，也不验证真实 Caddy HTTPS；真实 VPS 端到端部署仍需后续单独授权执行。

## 最终封板审计状态

最终审计入口见 [产品化最终审计](./PRODUCTIZATION_FINAL_AUDIT.md)。合并 main 和创建 tag 前，必须在 GitHub Actions 页面确认最新 `productization-validation` workflow 为绿色；本机未安装 `gh`，且公开 GitHub API 无法读取该仓库 Actions 状态。

## v0.8.2-chat-link-and-copy-enhancement

本需求仅作为 v0.8.1-security-audit-fixes 封板后的后续聊天体验规划，不在本轮实现代码、不调整既有安全修复、不引入文件上传能力。

核心需求只有两个：

1. 访客端可以复制客服发来的文字。
   - 被邀请进来的访客应能复制客服发送的聊天文字，包括普通文字、说明文字和链接文本。
   - UI 不应阻止文本选择和复制。
   - 如果后续增加消息气泡菜单，可以提供“复制”按钮。
   - 复制内容必须是原始完整文本，不得使用截断后的展示文本。

2. 客服端可以发送 HTTPS 链接，访客点击后跳转。
   - 客服可以发送下载页链接、官网链接、说明页链接等通用 HTTPS URL。
   - 访客端收到后，HTTPS 链接显示为可点击超链接。
   - 访客点击后跳转到对应网页，由该网页提供下载或说明。
   - 是否能下载、打开或安装，由访客设备、浏览器、操作系统和安全策略决定。
   - 本系统不负责自动安装，也不绕过 iOS/iPadOS/Android/Windows/macOS 的安装限制。

范围收缩：

- 不做文件上传。
- 不做服务器存文件。
- 不做服务器直接发送安装包。
- 不做 `.apk`、`.exe`、`.zip`、`.pdf` 等文件附件增强。
- 不支持 `.ipa`。
- 不让服务器下载、缓存、解析、执行、扫描或转存外部文件。
- 下载文件应由外部下载页或客户自己的下载地址负责。
- 本系统只负责聊天消息、链接展示、点击跳转和复制能力。

HTTPS 与安全边界：

- 只允许 `https://` 链接渲染为可点击链接。
- `http://` 明文链接不应渲染为可点击链接；后续如做发送校验，应拒绝并提示改用 `https://`。
- 不要盲目把任意 `http://` 自动改成 `https://` 后发送，因为无法保证目标网站支持 HTTPS。
- 对本系统自己的 admin/chat 域名，应强制 HTTPS；HTTP 访问由 Caddy/部署层重定向到 HTTPS 或拒绝。
- 禁止 `javascript:`、`data:`、`file:`、`vbscript:`、`chrome:`、`about:`、`blob:` 等非 HTTPS scheme。
- 用户输入必须安全转义，不允许把聊天消息直接作为 HTML 注入。
- 链接使用 `target="_blank"` 和 `rel="noopener noreferrer"`。
- 长链接 UI 可以截断显示，但真实 `href` 和复制内容必须保留完整 URL。
- 不做链接预览，避免 SSRF、隐私泄露和外部请求风险。
- 日志不要记录完整敏感 URL query，避免 `token`、`code`、`session`、`key` 等参数泄露。

建议分期：

Phase 1:

- 访客端文字可选择、可复制。
- HTTPS URL 自动识别。
- 可点击跳转。
- 复制完整链接。
- 禁止 HTTP 明文链接可点击。
- 禁止危险 scheme。
- XSS 安全转义。
- 不做链接预览。
- 不做文件上传。

Phase 2:

- 可选：消息气泡“复制文本”按钮。
- 可选：链接旁边“复制链接”按钮。
- 可选：客服发送链接时做 HTTPS 校验提示。
- 可选：管理员配置是否允许发送外部链接。

Phase 3:

- 可选：外部下载链接风险提示。
- 可选：可配置的允许域名 allowlist。
- 可选：链接点击审计，但不得记录敏感 query。
