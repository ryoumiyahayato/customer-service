# 通用 Linux 云服务器部署

这是客服系统通用 Linux 云服务器部署版的最小运行闭环，用于把已部署前端和 `server-generic` 后端运行在普通 VPS / 云服务器上。Windows 部署向导后续会复用本目录的 `.env`、Docker Compose 和脚本。

## 使用前准备

用户需要自行准备：

- Linux 云服务器或 VPS
- 域名和 DNS 解析
- SSH 访问权限
- 必要的备案或合规手续
- 可用的 80 / 443 端口

第一版不接云厂商 API，不自动购买服务器，不自动登录云账号。

## 文件说明

- `.env.example`：环境变量模板，只包含占位值，不包含真实值。
- `docker-compose.yml`：app、postgres、caddy 三服务编排。
- `docker-compose.local.yml`：本地 HTTP smoke 覆盖文件，只给 app 暴露 localhost 端口，不启动真实 HTTPS。
- `Dockerfile`：构建通用服务器适配层并复制前端 `dist` 产物。
- `app.env.example`：容器内应用变量示例。
- `Caddyfile`：使用 `APP_DOMAIN` / `VISITOR_ROOT_DOMAIN` 的 HTTPS 自动证书和反向代理配置。
- `preflight.sh`：真实 VPS 部署前只读预检查，不安装、不改配置、不启动服务、不跑迁移、不打印 secret。
- `VPS_ACCEPTANCE.md`：真实 Ubuntu VPS 自托管部署验收 runbook。
- `install.sh`：部署入口，执行 preflight、compose 配置检查、构建、启动和健康检查。
- `healthcheck.sh`：只读部署后健康检查。
- `backup.sh`：数据库和 storage 备份。
- `restore.sh`：带强确认的数据库和 storage 恢复。
- `upgrade.sh`：构建、启动和健康检查升级流程。

## 安全提示

不要把真实 `.env` 提交 git。不要把 secret、密码、token、cookie、生产数据明细或附件 key 写入日志、文档或聊天记录。

## CI 与真实 VPS 验收入口

Productization validation 已覆盖 local Docker self-host smoke：CI 会在 GitHub Actions ubuntu runner 中使用本地 Docker Compose 构建 app 镜像、启动 PostgreSQL、运行 server-generic PostgreSQL migrations、启动 app、等待 `/healthz`，并执行 `npm --prefix server-generic run e2e:local-smoke`。该 smoke 只使用 `127.0.0.1` 和 HTTP，不访问 Cloudflare、D1/R2 或真实域名。

真实 Ubuntu VPS 自托管部署验收请看 `VPS_ACCEPTANCE.md`。在真实部署前，先进入本目录运行只读预检查：

```bash
./preflight.sh
```

`preflight.sh` 只检查环境和配置，不安装依赖，不修改系统配置，不启动服务，不执行 migration，不访问 Cloudflare/D1/R2，也不会打印 `.env` 中的 secret 值。不要提交 `.env`。

## 最小执行路径

1. 准备 Linux VPS / 云服务器，开放 80 / 443 端口。
2. 安装 Docker 和 Docker Compose 插件。
3. 准备后台域名和访客根域 DNS，解析到服务器。
4. 复制本目录到服务器部署目录。
5. 复制 `.env.example` 为 `.env`，只在服务器本地填写真实部署变量。
6. 先执行 `./preflight.sh` 做只读 VPS 部署前检查。
7. 可再执行 `./install.sh --self-check` 做非破坏性配置检查。
8. 首次空库需要初始化 schema 时，执行 `./install.sh --migrate`。
9. 已完成 schema 初始化时，执行 `./install.sh`。
10. 健康检查通过后打开 `https://你的后台域名/setup`。

当前通用服务器适配层已经具备 setup、admin auth、admin session、访客会话、文本消息、附件上传、基础 WebSocket 广播、基础 read receipt、lifecycle 骨架、服务端加密存储和 PostgreSQL migration 基础闭环。消息分页、delivery acknowledgement、自动 runner 调度接线和生产数据迁移工具仍会在后续包继续推进。

## 本地 Docker self-host smoke

本地 smoke 只使用 `127.0.0.1` 和 HTTP，不申请真实 HTTPS，不访问 Cloudflare，不访问 D1/R2，不需要真实域名。它用于验证 `server-generic`、PostgreSQL、前端 `dist` 和 frontend compatibility API 的最小文本聊天闭环。

在仓库根目录先生成前端产物：

```bash
npm ci --no-audit --no-fund
npm run build
```

然后准备本地 `.env`。复制 `.env.example`，只在本机文件里填入本地 smoke 值，并确保这些值彼此一致：`APP_DOMAIN` 使用 `127.0.0.1`，`VISITOR_ROOT_DOMAIN` 使用 `127.0.0.1`，`LOCAL_APP_PORT` 使用 `8788`，`DATABASE_URL` 指向 compose 内的 `postgres` 服务，`SESSION_SECRET` 和 `SETUP_TOKEN` 使用本地临时强随机值。

```bash
cd deploy/linux
cp .env.example .env
# Edit .env locally. Do not commit it.
```

启动本地 Postgres 和 app，不启动 Caddy：

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml build app
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d postgres
docker compose -f docker-compose.yml -f docker-compose.local.yml run --rm app npm run migrate
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d app
```

回到仓库根目录运行本地 e2e smoke。命令里的 `SETUP_TOKEN` 要与本地 `.env` 中的 setup token 一致；不要把真实值粘贴到 issue、PR、日志或聊天记录里：

```bash
cd ../..
SELF_HOST_BASE_URL=http://127.0.0.1:8788 \
SETUP_TOKEN=change-me \
ADMIN_USERNAME=local-smoke-admin \
ADMIN_PASSWORD=local-smoke-admin-password \
npm --prefix server-generic run e2e:local-smoke
```

该 smoke 会检查 `/healthz`、`/api/setup/status`、本地 setup 初始化、`/api/auth/login`、`/api/auth/me`、`/api/invites`、`/api/guest/:token`、访客文本发送、管理员会话列表、管理员消息读取、管理员文本回复、访客读取回复。脚本只打印步骤结果，不打印 password、token、cookie、session id、消息正文或附件 key。

清理本地 smoke 容器和匿名运行状态：

```bash
cd deploy/linux
docker compose -f docker-compose.yml -f docker-compose.local.yml down -v
```

## PostgreSQL migration 与 setup

1. 复制 `.env.example` 为 `.env`。
2. 在服务器本地填写 `APP_DOMAIN`、`DATABASE_URL`、PostgreSQL 变量和 `SETUP_TOKEN` 等运行变量。
3. 首次空库部署前，确认迁移窗口后执行 `./install.sh --migrate`。
4. 不带 `--migrate` 时，脚本不会运行 PostgreSQL migrations。
5. 健康检查会访问 `/healthz` 和 `/api/setup/status`。
6. 打开 `https://你的后台域名/setup` 创建首个 admin。
7. 已有任意 admin 后，`/setup` 会自动关闭，后续应删除或轮换 `SETUP_TOKEN`。

不要把真实 `.env`、`SETUP_TOKEN`、数据库密码、cookie 或生产数据明细写入 git、日志、文档或聊天记录。

## 客服会话 API 状态

`server-generic` 现在支持 `POST /api/visitor/sessions` 创建访客会话，访客 token 只返回一次，数据库只保存 token hash。访客可以凭 header token 查看并发送自己会话的文本消息；管理员可以凭 admin session 查看会话列表、查看消息、回复消息和关闭会话。

`healthcheck.sh` 仍只检查 `/healthz` 和 `/api/setup/status`，不会创建真实访客会话，不会发送消息，也不会写业务数据。

## 附件与本地 storage

本地附件存储使用 `STORAGE_PATH` 指定根目录，Docker Compose 默认把部署目录下的 `storage` 挂载到容器内。附件上传由服务端生成 storage key，不接受用户传入真实路径；用户提供的文件名只作为展示名保存。

当前 MVP 支持 `application/octet-stream` 上传方式，并通过 `MAX_UPLOAD_SIZE` 限制大小。`healthcheck.sh` 不上传真实附件，只做只读健康检查。

`backup.sh` 会把 PostgreSQL dump 和本地 `storage` 目录一起放入备份目录。`restore.sh` 默认拒绝自动覆盖数据，恢复 storage 前必须人工确认备份来源和当前数据快照。

## HTTPS / Caddy

Caddy 使用 `.env` 中的 `APP_DOMAIN` 和 `VISITOR_ROOT_DOMAIN` 自动申请 HTTPS 证书，并把后台域名和访客根域都反向代理到 app 服务。`/api/setup/*` 的安全边界由 app 控制，不在 Caddy 层额外放行或绕过。

## 备份、恢复和升级

- `./backup.sh`：生成时间戳备份目录，备份 PostgreSQL dump 和 storage；使用 `BACKUP_SIGNING_KEY` 为校验清单计算 HMAC，默认不复制 `.env`。
- `./restore.sh --i-understand-this-overwrites-data <backup-directory>`：强确认后才恢复数据库和 storage；停止 app 前会验证 HMAC、校验和、归档路径及文件类型，并创建恢复前数据库快照；后续步骤失败时自动回滚数据库和 storage，回滚失败则保持 app 停止。
- `./upgrade.sh`：构建 app 镜像、启动服务并运行 healthcheck。
- `./upgrade.sh --migrate`：仅在明确迁移窗口内运行 server-generic PostgreSQL migration。

不要把 `.env`、数据库密码、`SESSION_SECRET`、`SETUP_TOKEN`、`ENCRYPTION_KEY`、cookie、生产数据明细或附件 key 贴到日志、文档或聊天记录。

## 服务端加密存储

通用服务器版已提供服务端加密存储 MVP 基础能力。启用 `ENCRYPTION_ENABLED=1` 后，新写入的文本消息正文会写入 AES-256-GCM 密文字段，新上传附件的展示文件名会写入加密元数据字段；旧数据不迁移，读取时仍兼容旧明文字段。

生产环境必须使用强随机 `ENCRYPTION_KEY`，推荐生成 32 字节随机值并使用 base64 或 64 位 hex 表示。不要把真实 key 写入 git、文档、日志、聊天记录或前端代码。`ENCRYPTION_KEY_VERSION` 用于标记当前密钥版本，后续密钥轮换和旧数据迁移会依赖该标记。

丢失 `ENCRYPTION_KEY` 会影响已加密消息正文和附件展示文件名的解密。备份与恢复必须同时保护数据库、storage 目录和密钥管理记录；只恢复密文数据而没有对应 key，无法恢复明文业务内容。当前 MVP 不加密附件内容本体，附件内容加密属于后续增强。

## lifecycle 骨架

通用服务器版已提供关闭、归档、移入回收站和清空历史的最小 API 骨架。自动 lifecycle runner 当前提供 dry-run 能力，默认只读统计候选数量，不自动写入生产数据。

## Windows 部署向导衔接

Windows 部署向导后续会通过 SSH 上传本目录、生成或传递服务器本地 `.env`，并调用 `install.sh --self-check`、`install.sh --migrate` 或 `install.sh`。向导不应读取或回显服务器上的真实 secret。
