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

## Linux 实机部署闭环强化第一包状态

- `docker-compose.yml` 已强化 app / postgres / caddy 三服务依赖、healthcheck、named volume、storage/logs 挂载和 restart policy。
- `Dockerfile` 明确构建 `server-generic`、复制 migrations/scripts 和前端 `dist`，运行时不复制宿主 `node_modules`。
- `Caddyfile` 使用 `APP_DOMAIN` 与 `VISITOR_ROOT_DOMAIN` 占位变量，不写真实域名。
- `install.sh` 已支持 `--self-check`、`--dry-run` 和 `--migrate`；migration 默认不执行，必须显式 `--migrate`。
- `healthcheck.sh` 只读检查 compose 服务、`/healthz` 和 `/api/setup/status`，只输出 setup 安全枚举字段。
- `backup.sh` 默认不备份 `.env`，只备份 PostgreSQL dump 与 storage，并提示单独保护 secret。
- `restore.sh` 默认拒绝执行，必须带强确认参数才恢复数据库和 storage。
- `upgrade.sh` 默认不运行 migration，只有显式 `--migrate` 才运行 server-generic PostgreSQL migration。
- 当前 Windows LTSC 开发机不代表 Linux VPS 实机验收；真实 VPS 部署验证留到后续远程服务器环境执行。

## Windows 部署向导真实 SSH 第一包状态

- Windows 部署向导已从 mock 流程推进到真实 SSH adapter MVP，mock adapter 仍保留。
- 当前 CLI 支持读取部署计划、校验配置、生成脱敏计划、dry-run 上传预览和 real SSH adapter。
- 上传目标为远程 `remoteBaseDir/customer-chat/deploy/linux`，上传内容限定为 `deploy/linux` 目录并排除 `.env`、logs、storage、backup、node_modules、`.git` 和临时 dist。
- 远程执行顺序为创建目录、上传文件、`chmod +x`、`install.sh --self-check`，再按计划执行 `install.sh --dry-run`、`install.sh` 或 `install.sh --migrate`。
- migration 仍为 opt-in；Windows 向导只有在计划 `runMigrations=true` 且真实模式满足安全条件时才会调用 `--migrate`。
- 第一包不自动写远程真实 `.env`，只上传 `.env.example` 并提示服务器侧填写 secret。
- 真实 VPS 端到端验证仍需后续在远程服务器环境执行。

## server-generic 业务迁移第一包状态

- `server-generic/migrations/0001_initial.sql` 已提供 PostgreSQL 首版空库 schema。
- 首版 schema 覆盖 `admins`、`admin_sessions`、`setup_state`、`chat_sessions`、`messages`、`attachments`、`customer_remarks` 和 `schema_migrations`。
- migration runner 只读取 `DATABASE_URL`，不会在服务启动时自动执行，运行时不应输出数据库连接明文。
- `GET /healthz`、`GET /api/setup/status`、`POST /api/setup/initialize`、`POST /api/admin/login`、`POST /api/admin/logout`、`GET /api/auth/me` 已形成最小后端闭环。
- setup initialize 只允许空 admin 状态创建首个 admin；成功后不自动登录、不创建 session、不设置 cookie。
- admin login 使用密码 hash 校验，创建 admin session，并只在 cookie 中设置随机 session token。
- 数据库只保存 session token hash，不保存明文 session token。
- Linux `install.sh` 默认不运行 migration，仅在显式传入 `--migrate` 后执行 server-generic PostgreSQL migration。
- `healthcheck.sh` 已覆盖 `/healthz` 和 `/api/setup/status`。

该迁移包仍不包含完整访客聊天 API、WebSocket 房间协议、生命周期写入和附件清理迁移；这些能力继续保持 Cloudflare 线上版为基准，后续分包推进。

## server-generic 客服会话第一包状态

- `server-generic` 已新增基础访客会话和文本消息 API。
- 访客创建会话时返回一次性 `visitorToken`，数据库仅保存 visitor token hash。
- 访客消息 API 需要 header token，只允许访问自己的 session。
- admin chat API 复用上一包 admin session，可查看会话列表、查看消息、回复消息和关闭会话。
- WebSocket hub 已支持按 session id 订阅，并在消息创建和会话关闭时广播 `message_created`、`session_closed`。
- 新增 `server-generic/migrations/0002_chat_foundation.sql`，补齐 `chat_sessions.visitor_token_hash`、`chat_sessions.closed_at`、`messages.admin_id` 及相关索引。
- 当前仍不实现附件真实上传、read receipt 完整迁移、归档/回收站/清空历史写入和生产数据迁移。

## server-generic 附件与 lifecycle 第一包状态

- 本地文件存储使用 `STORAGE_PATH` 作为根目录，并通过统一 helper 防止路径穿越。
- 附件上传使用服务端生成 storage key，用户文件名只保存为展示名。
- 附件 API 当前支持访客上传、访客下载自己会话附件、管理员下载附件。
- 消息列表返回安全附件元数据：id、filename、mime type、size、created at，不返回内部 storage key 或真实路径。
- 新增 `server-generic/migrations/0003_attachments_and_lifecycle.sql`，补齐附件展示名、附件删除标记、history_cleared_by 和相关索引。
- lifecycle 骨架支持 admin 手动 archive、recycle、clear-history；clear-history 复用统一附件删除 helper，附件删除成功后才写 history_cleared_at。
- 自动 lifecycle runner 当前提供 dry-run 统计，输出候选数量，不输出 session 明细。

## server-generic 服务端加密存储第一包状态

- 通用服务器版已新增服务端加密存储 MVP 基础：`ENCRYPTION_ENABLED=1` 时，新文本消息正文使用 AES-256-GCM 写入密文字段。
- 新上传附件的展示文件名会写入加密元数据字段，附件内容本体当前不加密。
- 新增 `server-generic/migrations/0004_encryption_foundation.sql`，补齐 messages 与 attachments 的 ciphertext、iv、tag、algorithm、key version 等字段。
- 读取路径优先解密密文字段；旧数据仍兼容明文字段，不做本轮旧数据迁移。
- `ENCRYPTION_KEY` 从服务器环境变量读取，不写入 git、文档、日志或前端代码；丢失 key 会影响已加密数据解密。
- 备份恢复必须同时保护数据库、storage 目录和密钥管理记录；搜索能力会受消息正文加密影响。
