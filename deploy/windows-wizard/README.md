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
- `npm run plan -- --plan examples/deploy-plan.example.json`：输出脱敏部署计划。
- `npm run deploy -- --plan examples/deploy-plan.example.json --dry-run`：只列出上传文件和远程命令，不连接真实服务器。
- `npm run deploy -- --plan path\to\deploy-plan.json --real`：仅当配置中 `mode=real` 且 `dryRun=false` 时才允许真实 SSH。
- 真实 SSH adapter 已接入 `ssh2`，支持 private key / password 环境变量认证。
- 上传流程会扫描并上传 `deploy/linux`，排除 `.env`、logs、storage、backup、node_modules、`.git` 和 dist 临时产物。
- 远程执行流程为 `chmod +x`、`./install.sh --self-check`，然后按计划执行 `./install.sh --dry-run`、`./install.sh` 或 `./install.sh --migrate`。

## 当前未完成

- 真实 GUI。
- 真正 EXE 打包。
- 真实 VPS 端到端验证。
- 云厂商 API 集成。

## 安全边界

- 不保存明文 SSH 密码。
- 不输出私钥内容。
- `privateKeyPath` 日志只显示 basename。
- 不输出 `setupToken`、`sessionSecret`、cookie、token 或数据库连接明文。
- 部署计划和日志只输出脱敏内容。
- 本包不执行 Cloudflare deploy、D1 写入、R2 删除或生产 migration。
- 默认不真实 SSH；必须显式 `--real` 且计划文件 `mode=real`、`dryRun=false`。
- 第一包不自动写远程 `.env`，只上传 `.env.example` 并提示用户在服务器侧填写 secret。

## 示例配置字段

`config.json` 应由用户本地创建，不要提交 git。字段包括：

- `mode`
- `dryRun`
- `runMigrations`
- `host`
- `port`
- `username`
- `authMethod`
- `passwordEnv` 或 `privateKeyPath`
- `appDomain`
- `visitorRootDomain`
- `remoteBaseDir`

示例配置见 `examples/deploy-plan.example.json`。示例只使用占位主机名和占位私钥路径，不包含真实密码、私钥、token 或 secret。
