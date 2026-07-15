# 真实 VPS 自托管部署验收 Runbook

本文档用于后续在真实 Ubuntu VPS 上验收客服系统自托管部署。当前阶段只准备文档和只读 preflight 检查脚本，不在本轮执行 SSH、部署、HTTPS 申请、数据库迁移或任何远程资源操作。

## 1. 验收目标

本次真实 VPS 验收的目标是确认 `deploy/linux` 自托管路径可以在客户自有 Ubuntu VPS 上完成最小生产形态闭环：

- 使用客户自有 VPS、客户自有域名和服务器本地 `.env`。
- 使用 Docker Compose 启动 `app`、`postgres`、`caddy`。
- 使用 Caddy 为后台域名和访客根域申请 HTTPS，并反向代理到 app。
- 使用 PostgreSQL 持久化 setup、管理员、访客会话、消息和附件元数据。
- 使用本地 storage 持久化附件内容。
- 完成管理员 setup、登录、创建访客入口、访客发消息、管理员回复、访客读取回复的基本验收。
- 确认部署过程不依赖 Cloudflare、D1、R2、真实 SSH 自动化向导或 Windows 桌面打包。

本 runbook 是人工验收说明，不是自动部署器。任何真实部署动作都必须由具备 VPS 权限的部署人员在明确窗口内手动执行。

## 2. VPS 前置要求

建议使用一台干净的 Ubuntu LTS VPS。

| 项目 | 最低要求 | 推荐要求 | 说明 |
| --- | --- | --- | --- |
| OS | Ubuntu 22.04/24.04 LTS | Ubuntu 24.04 LTS | 其他发行版需要单独验证 |
| CPU | 1 vCPU | 2 vCPU+ | 首轮验收不做压测 |
| 内存 | 1 GiB | 2 GiB+ | 低于 2 GiB 可能可跑，但余量较弱 |
| 磁盘 | 10 GiB 可用 | 20 GiB+ 可用 | 包括镜像、PostgreSQL、日志、附件和备份 |
| 端口 | 80/443 可用 | 80/443 可用 | Caddy 申请 HTTPS 需要公网可达 |
| 软件 | Docker + Docker Compose plugin | 最新稳定版本 | `preflight.sh` 只检查，不安装 |
| 权限 | 可执行 Docker Compose | 独立部署用户或 sudo | 不建议用多人共享账号 |
| 备份 | 可写备份目录 | 独立备份盘或外部备份 | 首次上线前先确认恢复流程 |

VPS 上不要存放与本项目无关的生产服务，除非已经确认 80/443 反向代理和资源隔离方案。

## 3. DNS 要求

真实 VPS 验收需要两个域名或子域名：

| 变量 | 用途 | 示例 |
| --- | --- | --- |
| `APP_DOMAIN` | 管理后台域名 | `admin.example.com` |
| `VISITOR_ROOT_DOMAIN` | 访客入口根域 | `chat.example.com` |

要求：

1. 两个域名都必须解析到 VPS 公网 IP。
2. A/AAAA 记录生效后再执行真实部署。
3. 80 和 443 必须能从公网访问 VPS。
4. 不要在真实 VPS 验收中使用 `127.0.0.1`、`localhost`、`example.com` 或其他占位域名。
5. 首次 HTTPS 申请前，不要让其他服务占用 80/443。
6. 如果使用 CDN、反向代理或云安全组，先确认不会拦截 Caddy 的 HTTP-01/HTTPS 流量。

DNS 生效可以由部署人员在本地或 VPS 上用 `dig`、`nslookup`、`getent hosts` 等只读命令确认。不要把真实客户域名、源站 IP 或 DNS 控制台截图贴到公开 issue、PR 或聊天记录中。

## 4. `.env` 填写说明

在 VPS 的 `deploy/linux` 目录中复制模板：

```bash
cp .env.example .env
```

然后只在 VPS 本地编辑 `.env`。不要提交 `.env`，不要把 `.env` 内容贴到日志、PR、issue 或聊天记录中。

| 变量 | 说明 | 注意事项 |
| --- | --- | --- |
| `APP_DOMAIN` | 后台域名 | 必须是真实域名，不要用占位值 |
| `VISITOR_ROOT_DOMAIN` | 访客根域 | 必须是真实域名，不要与后台域名混用 |
| `POSTGRES_DB` | PostgreSQL 数据库名 | 可保留模板名 |
| `POSTGRES_USER` | PostgreSQL 用户名 | 可保留模板名 |
| `POSTGRES_PASSWORD` | PostgreSQL 密码 | 必须换成强随机值 |
| `DATABASE_URL` | app 连接 PostgreSQL 的 URL | 密码要与 `POSTGRES_PASSWORD` 一致，host 使用 compose 服务名 `postgres` |
| `APP_PORT` | app 容器内监听端口 | 默认 `3000` |
| `SESSION_SECRET` | 管理员 session 签名密钥 | 必须换成强随机值 |
| `SETUP_TOKEN` | 首次 setup 初始化令牌 | 首次管理员创建后应轮换或移除 |
| `ADMIN_SESSION_TTL` | 管理员 session 有效期秒数 | 可保留默认 |
| `STORAGE_DRIVER` | 附件存储驱动 | 当前生产路径使用 `local` |
| `STORAGE_PATH` | app 容器内附件目录 | 需与 compose volume 保持一致 |
| `MAX_UPLOAD_SIZE` | 附件大小上限 | 以字节为单位 |
| `BACKUP_DIR` | 备份目录 | 确保可写并有足够空间 |
| `BACKUP_SIGNING_KEY` | 备份清单 HMAC 密钥 | 至少 32 字符，必须单独安全备份并限制访问 |
| `LOG_LEVEL` | 日志级别 | 生产建议 `info` |

加密相关：

- `ENCRYPTION_ENABLED=1` 时必须填写强随机 `ENCRYPTION_KEY`。
- `ENCRYPTION_KEY` 推荐使用 32 字节随机值的 base64 或 64 位 hex。
- 丢失 `ENCRYPTION_KEY` 会影响已加密消息正文和附件展示文件名的解密。
- 不要把真实 `ENCRYPTION_KEY` 写入 git、文档、日志、PR、issue 或聊天记录。

## 5. 部署命令

以下命令是后续真实 VPS 验收窗口内的人工 runbook。本轮不执行这些命令。

```bash
cd deploy/linux
./preflight.sh
./install.sh --self-check
```

首次空库部署，在明确迁移窗口内执行：

```bash
./install.sh --migrate
```

已有 schema 或非首次部署，执行普通启动：

```bash
./install.sh
./healthcheck.sh
docker compose ps
```

需要查看最近日志时使用：

```bash
docker compose logs --tail=120 app
docker compose logs --tail=120 postgres
docker compose logs --tail=120 caddy
```

不要运行 `cat .env`，不要把 Docker Compose 展开的 secret、cookie、session id、setup token、数据库密码、附件 key 或生产消息正文贴到任何外部位置。

## 6. 验收步骤表

| 序号 | 步骤 | 命令或操作 | 预期结果 | 是否写入业务数据 |
| --- | --- | --- | --- | --- |
| 1 | 检查文件 | `ls deploy/linux` | 存在 compose、Caddyfile、install、healthcheck、preflight | 否 |
| 2 | 填写 `.env` | 仅在 VPS 本地编辑 | 必填项完整，无占位值 | 否 |
| 3 | 运行 preflight | `./preflight.sh` | 无 `FAIL`，可以有需评估的 `WARN` | 否 |
| 4 | install 自检 | `./install.sh --self-check` | compose 配置和基础自检通过 | 否 |
| 5 | 首次迁移 | `./install.sh --migrate` | PostgreSQL schema 初始化成功 | 是，写 schema |
| 6 | 启动服务 | `./install.sh` | app、postgres、caddy 正常运行 | 否 |
| 7 | 健康检查 | `./healthcheck.sh` | `/healthz` 与 `/api/setup/status` 返回正常 | 否 |
| 8 | HTTPS 检查 | 打开后台域名 | 浏览器显示有效 HTTPS 页面 | 否 |
| 9 | 首次 setup | 打开 `https://APP_DOMAIN/setup` | 使用 `SETUP_TOKEN` 创建首个管理员 | 是 |
| 10 | setup 关闭 | 再次访问 setup | 已有管理员后 setup 不再开放 | 否 |
| 11 | 管理员登录 | 后台登录 | 能进入后台 | 否 |
| 12 | 创建访客入口 | 后台创建 invite/访客入口 | 得到访客访问方式 | 是 |
| 13 | 访客发消息 | 访客页面发送短文本 | 管理端能看到消息 | 是 |
| 14 | 管理员回复 | 管理端回复短文本 | 访客端能看到回复 | 是 |
| 15 | 日志检查 | `docker compose logs --tail=120 app` | 无崩溃、无 secret 明文 | 否 |
| 16 | 备份演练 | `./backup.sh` | 生成数据库和 storage 备份 | 读数据并写备份文件 |

验收用消息应使用无敏感信息的短文本，例如“hello acceptance”。不要使用真实客户隐私、联系方式、订单、身份证件、支付信息或附件。

## 7. 日志与排错

排错优先级：

1. `./preflight.sh` 是否有 `FAIL`。
2. DNS 是否已解析到 VPS。
3. VPS 安全组或防火墙是否放行 80/443。
4. Docker 与 Docker Compose plugin 是否可用。
5. `.env` 必填字段是否存在，且没有占位值。
6. PostgreSQL 容器是否 healthy。
7. app 容器是否 healthy。
8. Caddy 是否成功启动并申请证书。
9. `/healthz` 与 `/api/setup/status` 是否正常。

常用只读命令：

```bash
docker compose ps
docker compose logs --tail=120 app
docker compose logs --tail=120 postgres
docker compose logs --tail=120 caddy
./healthcheck.sh
```

处理原则：

- 不要把 `.env`、数据库密码、`SESSION_SECRET`、`SETUP_TOKEN`、`ENCRYPTION_KEY`、`BACKUP_SIGNING_KEY`、cookie、session id、附件 key 或真实消息正文贴到日志、PR、issue 或聊天记录中。
- 不要为了排错直接关闭 setup fail-closed 逻辑。
- 不要绕过 HTTPS 或把后台临时暴露到不受控公网路径。
- 不要在不明确数据状态时运行 restore。
- 不要在没有备份和窗口确认时运行迁移或升级。
- 如果 Caddy 证书申请失败，先查 DNS、80/443、云安全组和已有占用，不要反复重启刷证书申请。

## 8. 验收通过标准

真实 VPS 自托管验收通过需要同时满足：

1. `./preflight.sh` 无 `FAIL`。
2. `./install.sh --self-check` 通过。
3. 首次空库场景下 migration 成功；非空库场景下没有误跑 migration。
4. `docker compose ps` 显示 `app`、`postgres`、`caddy` 正常运行。
5. `./healthcheck.sh` 通过。
6. 后台域名 HTTPS 可访问。
7. 访客根域 HTTPS 可访问。
8. setup 可创建首个管理员，创建后 setup 自动关闭。
9. 管理员可登录。
10. 访客可进入会话并发送文本消息。
11. 管理员可看到访客消息并回复。
12. 访客可看到管理员回复。
13. 最近 app/postgres/caddy 日志无崩溃循环。
14. 日志、文档、PR、issue 和聊天记录中没有 secret、cookie、session id、附件 key 或真实生产数据明文。
15. 可生成一次备份，且备份目录存在预期文件。

## 9. 本阶段不包括的内容

本阶段不包括：

- 不执行真实 SSH 或 VPS 部署。
- 不申请真实 HTTPS 证书。
- 不访问 Cloudflare。
- 不访问 D1/R2。
- 不运行 Cloudflare deploy。
- 不运行 `lifecycle:dry-run`。
- 不操作远程 secrets。
- 不做 Windows EXE、APK 或 IPA。
- 不做真实公网 setup initialize。
- 不做生产数据导入、迁移、恢复或压测。
- 不改 `src/worker.ts`、`src/worker-secure.ts`、`wrangler.toml`、根 migrations 或 server-generic 业务逻辑。
