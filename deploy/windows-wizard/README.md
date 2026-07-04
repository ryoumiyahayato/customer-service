# Windows 部署向导 EXE MVP

这是客服系统 Windows 部署向导 EXE 的 MVP scaffold。第一包先提供 CLI/Tauri-ready 结构，不要求真正打包 EXE。

## 当前定位

- 部署目标是远程 Linux 云服务器，不是在本地 Windows 上运行后端。
- 第一版不自动购买服务器。
- 第一版不登录云厂商 API。
- 用户需要自行准备服务器、域名、DNS、SSH 访问权限和备份策略。
- 向导后续会调用 `deploy/linux` 的安装流程，包括上传部署目录、写入远程 `.env`、执行 `install.sh` 和 `healthcheck.sh`。

## 当前能力

- `npm run smoke`：运行本地自检，不连接真实服务器。
- `npm run build`：编译 CLI/Tauri-ready TypeScript 代码。
- `node dist/index.js --smoke`：运行 smoke。
- `node dist/index.js --plan <config.json>`：读取配置并输出脱敏部署计划。

## 当前未完成

- 真实 GUI。
- 真正 EXE 打包。
- 真实 SSH 连接。
- 真实文件上传和远程执行。
- 云厂商 API 集成。

## 安全边界

- 不保存明文 SSH 密码。
- 不输出私钥内容。
- 不输出 `setupToken`、`sessionSecret`、cookie、token 或数据库连接明文。
- 部署计划和日志只输出脱敏内容。
- 本包不执行 Cloudflare deploy、D1 写入、R2 删除或生产 migration。

## 示例配置字段

`config.json` 应由用户本地创建，不要提交 git。字段包括：

- `serverHost`
- `sshPort`
- `sshUser`
- `authMethod`
- `password` 或 `privateKeyPath`
- `appDomain`
- `visitorRootDomain`
- `email`
- `remoteDir`
- `appPort`
- `storagePath`
- `backupDir`
- `setupToken`
- `sessionSecret`
