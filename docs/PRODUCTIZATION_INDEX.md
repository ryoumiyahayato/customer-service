# 产品化文档索引

当前 Cloudflare 版已上线，作为产品化路线的基准版本。后续按大包推进，每轮完成可运行骨架、自检、审计和提交。

## 文档入口

- [产品化路线图](./PRODUCTIZATION_ROADMAP_TO_2026-07-20.md)
- [v0.4 通用服务器部署架构](./SERVER_DEPLOYMENT_ARCHITECTURE_v0.4.md)
- [v0.6 Windows 部署向导 EXE](./WINDOWS_DEPLOY_WIZARD_v0.6.md)
- [v0.7 客户端与 PWA](./CLIENTS_AND_PWA_v0.7.md)
- [v0.8 服务端加密存储](./SERVER_SIDE_ENCRYPTION_v0.8.md)

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
- `deploy/windows-wizard/README.md`
- `deploy/windows-wizard/package.json`
- `deploy/desktop-client/README.md`
- `deploy/desktop-client/package.json`
- `deploy/android-shell/README.md`
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

Windows 部署向导已进入 MVP scaffold：当前是独立 CLI/Tauri-ready package，可生成脱敏部署计划并运行 smoke；SSH 与 transfer 仍为 mock / 接口层，尚未打包真实 EXE。

## PWA 与桌面客户端状态

PWA 已进入 MVP：包含 manifest、service worker、offline page 和图标。桌面客户端 EXE 壳已进入 scaffold：当前是独立 CLI/Tauri-ready package，可生成脱敏启动计划并运行 smoke；尚未打包真实 EXE，也未接入 Tauri/Electron GUI。

## Android APK 壳状态

Android APK 壳已进入 MVP scaffold：当前是独立 Gradle / Kotlin / WebView 工程，默认使用占位 HTTPS URL，只声明 `INTERNET` 权限，包含 URL scheme 白名单、禁用 file/content access、不注入 JavaScript bridge 和生产 cleartext 默认禁用等基础安全边界；尚未做真实签名打包、应用商店分发、原生通知、文件选择器、下载管理和自动更新。

## 服务端加密存储状态

服务端加密存储已进入 MVP 实现：`server-generic` 当前支持新消息正文 AES-256-GCM 加密、新附件展示文件名元数据加密、旧明文字段兼容读取、密钥版本标记和 smoke 自检。当前不迁移旧数据，不加密附件内容本体；`ENCRYPTION_KEY` 必须由服务器环境变量提供，备份恢复必须同时保护密钥管理记录。
