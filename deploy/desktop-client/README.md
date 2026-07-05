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
- `npm run plan`：使用示例配置输出脱敏启动计划。
- `npm run package:check`：检查打包前的必要 scaffold 和示例配置。
- `node dist/index.js --plan <config.json>`：输出指定配置的脱敏启动计划。

## 配置说明

示例配置位于：

`examples/client-config.example.json`

当前支持字段：

- `adminUrl`：后台入口 URL，只允许 `http` / `https`。
- `visitorRootUrl`：访客根入口 URL，只允许 `http` / `https`。
- `appName`：应用名称。
- `windowTitle`：窗口标题，可选。
- `startMode`：启动入口，可选值为 `admin` 或 `visitor`。
- `mode`：当前客户端模式，占位给后续 GUI / Tauri 集成使用。

示例配置只能使用 `example.com` 或 `localhost` 占位。不要把真实 token、cookie、password、secret、SETUP_TOKEN、SESSION_SECRET、ENCRYPTION_KEY 或 DATABASE_URL 写入配置、日志或 git。

## EXE 打包准备

第一包不强行引入 Tauri / Electron 大依赖，也不生成真实 EXE。打包前先运行：

```powershell
npm.cmd install
npm.cmd run smoke
npm.cmd run plan
npm.cmd run package:check
```

如果后续接入 Tauri，应在独立 `src-tauri` 工程中完成窗口、托盘、自动更新、签名和安装包流程；本目录当前只提供可验证的配置、脱敏和启动计划闭环。

## 当前未完成

- 真正 EXE 打包。
- Tauri/Electron GUI。
- 系统托盘。
- 原生通知。
- 自动更新。
- 漂亮 GUI。

## 安全边界

- 配置类型不包含 password、token、cookie、session 字段。
- 不保存敏感凭据。
- 日志和计划会脱敏 URL 查询参数中的 token、session、cookie、password、secret、key、SETUP_TOKEN、ENCRYPTION_KEY 等敏感字段。
- URL 校验只允许 `http` / `https`，阻止 `javascript:`、`file:`、`data:` 等危险 scheme。
- 加载失败或计划失败只输出低信息量错误和脱敏 URL。
- 示例配置只能使用 `example.com` 或 `localhost` 占位。
