# Windows 部署向导 EXE v0.6

## 目标

Windows 部署向导 EXE 用于帮助非技术用户从本机连接远程 Linux 云服务器，上传部署包，执行 Linux 安装脚本，查看实时日志，并在完成后打开后台地址和 `/setup` 初始化页面。

## 输入项

- 服务器 IP 或主机名
- SSH 用户
- SSH 密码或私钥
- 后台域名
- 访客根域
- 联系邮箱
- 服务器安装目录

## 第一版流程

1. 连接测试：验证 SSH 是否可用。
2. 环境检测：识别 Linux 发行版、Docker、Docker Compose、端口占用和基础命令。
3. 上传部署包：上传通用 Linux 部署目录和应用构建包。
4. 执行 `install.sh`：由服务器侧脚本完成安装。
5. 显示日志：实时展示 stdout / stderr，但过滤敏感变量值。
6. 健康检查：调用 `healthcheck.sh`。
7. 输出后台地址和 `/setup` 地址。

## 第一版不做

- 不接云厂商 API。
- 不自动购买服务器。
- 不自动登录云账号。
- 不保存云账号凭据。

## 技术候选

- Tauri：优先候选，体积小，适合部署工具。
- Electron：兼容性强，但体积更大，作为备选。

## MVP scaffold 状态

`deploy/windows-wizard` 已进入第一包 scaffold：

- 独立 TypeScript package，不修改根 `package.json`。
- CLI/Tauri-ready 目录结构已建立。
- 支持 `--smoke` 本地自检。
- 支持 `--plan <config.json>` 生成脱敏部署计划。
- 已定义部署配置类型、输入校验、部署计划、远程命令生成、SSH client 接口、transfer 接口、日志脱敏和 smoke。
- mock adapter 已保留；real SSH adapter 已进入 MVP，使用 `ssh2` 支持 private key / password 环境变量认证。
- 默认不真实部署；只有 `deploy --real` 且计划文件 `mode=real`、`dryRun=false` 时才允许真实 SSH。
- dry-run 不连接服务器，只列出将上传的 `deploy/linux` 文件和将执行的远程命令。
- 部署计划覆盖测试 SSH、创建远程目录、上传 `deploy/linux`、执行 `install.sh --self-check`、按计划执行 `install.sh --dry-run` / `install.sh` / `install.sh --migrate`、输出后台和 `/setup` 地址。
- 第一包不自动写远程真实 `.env`，只上传 `.env.example` 并提示用户在服务器侧填写 secret。

## 安全边界

- 不保存明文密码。
- 不输出 secret。
- `privateKeyPath` 日志只显示 basename。
- 不上传聊天记录。
- 不把 `.env` 内容写入本地日志。
- 不自动覆盖生产数据。
- 不执行未授权 migration、D1 写入或 R2 删除。
- 不自动调用 setup initialize。

## 当前未完成

- 真实 GUI。
- 真正 EXE 打包。
- 真实 VPS 端到端验证。
- 云厂商 API。
- 图形化日志流和交互式错误恢复。
