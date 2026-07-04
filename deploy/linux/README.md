# 通用 Linux 云服务器部署骨架

这是客服系统通用 Linux 云服务器部署版的首版骨架，用于 v0.4-v0.5 产品化推进。

## 使用前准备

用户需要自行准备：

- Linux 云服务器或 VPS
- 域名和 DNS 解析
- SSH 访问权限
- 必要的备案或合规手续
- 可用的 80 / 443 端口

第一版不接云厂商 API，不自动购买服务器，不自动登录云账号。

## 文件说明

- `.env.example`：环境变量模板，不包含真实值。
- `docker-compose.yml`：app、postgres、caddy 三服务编排草案。
- `Dockerfile`：构建通用服务器适配层并复制前端 `dist` 产物。
- `app.env.example`：容器内应用变量示例。
- `Caddyfile`：HTTPS 和反向代理草案。
- `install.sh`：v0.5 最小部署入口，执行 compose 配置检查、构建、启动和健康检查。
- `healthcheck.sh`：部署后健康检查。
- `backup.sh`：数据库和 storage 备份骨架。
- `restore.sh`：安全恢复流程骨架。
- `upgrade.sh`：升级流程骨架。

## 安全提示

不要把真实 `.env` 提交 git。不要把 secret、密码、token、cookie、生产数据明细或附件 key 写入日志、文档或聊天记录。

## 最小执行路径

1. 在服务器安装 Docker 和 Docker Compose 插件。
2. 复制本目录到服务器部署目录。
3. 复制 `.env.example` 为 `.env`，只在服务器本地填写真实部署变量。
4. 执行 `./install.sh`。
5. 健康检查通过后打开后台地址和 `/setup`。

当前通用服务器适配层已经具备最小 setup、admin auth、admin session、访客会话、文本消息、基础 WebSocket 广播和 PostgreSQL migration 基础闭环。生命周期写入、附件上传与清理、完整 read receipt 仍会在后续包继续迁移。

## PostgreSQL migration 与 setup

1. 复制 `.env.example` 为 `.env`。
2. 在服务器本地填写 `APP_DOMAIN`、`DATABASE_URL`、PostgreSQL 变量和 `SETUP_TOKEN` 等运行变量。
3. 首次空库部署前，确认迁移窗口后把 `.env` 中的 `RUN_SERVER_MIGRATIONS` 临时设为 `1`。
4. 执行 `./install.sh`，脚本会在显式 opt-in 时运行 `server-generic` PostgreSQL migrations。
5. 健康检查会访问 `/healthz` 和 `/api/setup/status`。
6. 打开 `https://你的后台域名/setup` 创建首个 admin。
7. 已有任意 admin 后，`/setup` 会自动关闭，后续应删除或轮换 `SETUP_TOKEN`，并把 `RUN_SERVER_MIGRATIONS` 恢复为 `0`。

不要把真实 `.env`、`SETUP_TOKEN`、数据库密码、cookie 或生产数据明细写入 git、日志、文档或聊天记录。

## 客服会话 API 状态

`server-generic` 现在支持 `POST /api/visitor/sessions` 创建访客会话，访客 token 只返回一次，数据库只保存 token hash。访客可以凭 header token 查看并发送自己会话的文本消息；管理员可以凭 admin session 查看会话列表、查看消息、回复消息和关闭会话。

`healthcheck.sh` 仍只检查 `/healthz` 和 `/api/setup/status`，不会创建真实访客会话，不会发送消息，也不会写业务数据。
