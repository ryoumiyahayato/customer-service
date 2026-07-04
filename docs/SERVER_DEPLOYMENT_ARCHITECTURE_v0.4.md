# 通用服务器部署架构 v0.4

## 目标形态

用户电脑运行部署向导或脚本，连接远程 Linux 云服务器，自动安装运行环境，自动部署客服系统，自动配置 HTTPS、数据库、文件存储和定时任务，最后打开 `/setup` 完成初始化。

## 第一版目标平台

第一版面向普通 Linux VPS / 云服务器，优先适配阿里云、腾讯云、百度云、华为云、AWS、Oracle 和普通 VPS。目标是假设用户已经拥有服务器、域名、DNS 和 SSH 访问权限。

## 第一版不做

- 不接云厂商原生 API。
- 不自动购买服务器。
- 不自动登录云账号。
- 不自动修改云厂商安全组。
- 不迁移生产 Cloudflare 数据。

## 推荐技术方案

- Docker Compose：编排 app、postgres、caddy。
- Caddy：自动 HTTPS 和反向代理。
- PostgreSQL：替代 D1。
- 本地文件存储：替代 R2，后续扩展 S3 兼容存储。
- cron / systemd timer / 应用内调度：替代 Cloudflare Scheduled Trigger。
- systemd：管理服务开机自启。
- `.env`：管理部署变量，文件权限限制为仅部署用户可读。
- backup：数据库和 storage 目录备份。
- logs：统一收集部署脚本和容器日志。

## Cloudflare 组件迁移映射

| Cloudflare 组件 | 通用服务器映射 |
| --- | --- |
| Workers | Node/Bun HTTP 服务 |
| D1 | PostgreSQL |
| R2 | 本地文件存储，后续 S3 兼容 |
| Assets | Caddy 或 Node 静态文件 |
| Scheduled Trigger | cron / systemd timer / 应用内调度 |
| WebSocket | Node/Bun WebSocket |
| Wrangler secrets | `.env` + 文件权限 + 后续密钥管理 |

## 数据迁移风险

- D1 到 PostgreSQL 的 SQL 方言、索引、时间字段和约束需要逐项映射。
- R2 附件迁移到本地文件时必须保留引用关系，不能丢失路径映射。
- 生命周期字段、清空历史字段和附件清理状态必须保持一致。
- 首版不直接自动迁移生产数据，先做空库部署和新环境初始化。

## 安全边界

- 不把真实 secret 写入 git、文档、日志或聊天记录。
- `.env` 必须只在服务器本地存在，并限制文件权限。
- `/api/setup/*` 仍必须只允许后台域名和本地开发 host。
- 已有任意 admin 后 `/setup` 必须关闭。
- 备份文件必须纳入权限控制，不能暴露在 Web 根目录。
- R2 / 本地文件删除失败时不得标记历史清空成功。

## v0.5 下一步实现顺序

1. 固化 `deploy/linux/.env.example`。
2. 让 `docker-compose.yml` 首版可启动。
3. 实现 app 镜像构建策略。
4. 完成 Caddy 反向代理和 HTTPS 骨架。
5. 补齐 `install.sh`、`healthcheck.sh`、`backup.sh`、`restore.sh`、`upgrade.sh` 最小可运行链路。
6. 做空库 `/setup` 初始化演示。

## v0.5 第一包落地状态

- `deploy/linux/docker-compose.yml` 已形成 app / postgres / caddy 三服务闭环。
- `deploy/linux/Dockerfile` 已指向隔离的 `server-generic` 适配层。
- `install.sh` 已执行 compose config、build、up 和 healthcheck。
- `healthcheck.sh` 已检查 compose 状态、app 容器、根路径和 setup status。
- `backup.sh` 已具备 PostgreSQL dump 和 storage 归档骨架。
- `restore.sh` 默认拒绝覆盖数据，要求显式确认参数。
- `upgrade.sh` 已包含 pull/build/up/healthcheck 和 rollback TODO。
- `server-generic` 目前只提供普通服务器最小 HTTP 入口，不替代 Cloudflare Worker。

## server-generic 业务迁移第一包状态

- `server-generic/migrations/0001_initial.sql` 已提供 PostgreSQL 首版空库 schema。
- 首版 schema 覆盖 `admins`、`admin_sessions`、`setup_state`、`chat_sessions`、`messages`、`attachments`、`customer_remarks` 和 `schema_migrations`。
- migration runner 只读取 `DATABASE_URL`，不会在服务启动时自动执行，运行时不应输出数据库连接明文。
- `GET /healthz`、`GET /api/setup/status`、`POST /api/setup/initialize`、`POST /api/admin/login`、`POST /api/admin/logout`、`GET /api/auth/me` 已形成最小后端闭环。
- setup initialize 只允许空 admin 状态创建首个 admin；成功后不自动登录、不创建 session、不设置 cookie。
- admin login 使用密码 hash 校验，创建 admin session，并只在 cookie 中设置随机 session token。
- 数据库只保存 session token hash，不保存明文 session token。
- Linux `install.sh` 默认不运行 migration，仅在显式设置 `RUN_SERVER_MIGRATIONS=1` 后执行 server-generic migration。
- `healthcheck.sh` 已覆盖 `/healthz` 和 `/api/setup/status`。

该迁移包仍不包含完整访客聊天 API、WebSocket 房间协议、生命周期写入和附件清理迁移；这些能力继续保持 Cloudflare 线上版为基准，后续分包推进。
