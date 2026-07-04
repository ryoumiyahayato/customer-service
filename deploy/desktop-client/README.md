# 桌面客户端 EXE 壳 MVP

这是客服系统桌面客户端 EXE 壳的 MVP scaffold。它和 Windows 部署向导 EXE 是两个不同工具。

## 定位

- 桌面客户端只打开已经部署好的客服系统。
- 桌面客户端不安装服务器。
- 桌面客户端不执行 deploy。
- 桌面客户端不打包后端，也不包含 `server-generic`。
- 桌面客户端不执行 `install.sh`。
- 桌面客户端不接云厂商 API。
- 用户需要提供后台地址。
- 第一包只做 CLI/Tauri-ready scaffold，不要求真正打包 EXE。

## 当前能力

- `npm run smoke`：本地自检，不连接真实服务器。
- `npm run build`：编译 TypeScript scaffold。
- `node dist/index.js --plan <config.json>`：输出脱敏启动计划。

## 当前未完成

- 真正 EXE 打包。
- Tauri/Electron GUI。
- 系统托盘。
- 原生通知。
- 自动更新。
- Android APK。

## 安全边界

- 配置类型不包含 password、token、cookie、session 字段。
- 不保存敏感凭据。
- 日志和计划会脱敏 URL 查询参数中的敏感字段。
- 示例配置只能使用 `example.com` 或 `localhost` 占位。
