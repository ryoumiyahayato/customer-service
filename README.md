<<<<<<< ours
# Cloudflare Customer Support Chat

This project is a customer support chat system using a Cloudflare-native production path, with a separate `server-generic` self-host adapter under active productization.

## Current production architecture

- Frontend: React + Vite SPA served by Cloudflare static assets.
- API backend: Cloudflare Worker in `src/worker.ts` with security hardening in `src/worker-secure.ts`.
- Realtime: Durable Objects + WebSocket in `src/durable-objects/ChatRoom.ts`.
- Database: D1 database named `customer_chat_db`.
- Attachments/images: R2 bucket named `customer-chat-uploads`.
- Sessions: HttpOnly signed cookies backed by D1 `admin_sessions` and `visitor_sessions` tables.
- Deployment: Wrangler.

## Feature inventory

- Visitor chat entry: guest, registered visitor login, and visitor registration are preserved.
- Admin login: username/password login uses HttpOnly signed cookies and D1 session lookup.
- Super admin: first super admin can be bootstrapped from Wrangler secrets when no super admin exists.
- Customer service/admin accounts: super admin can create, disable, and hard-delete operators.
- Conversation list: admin view groups PENDING, OPEN, CLOSED, ARCHIVED, and deleted conversations.
- Message history: D1-backed messages are fetched per conversation and persist across refresh.
- Realtime sending/receiving: WebSocket rooms are keyed by `conversation:<sessionId>`; no global message array is shared between conversations.
- Unread/read status: visitor messages are marked read when an admin opens a conversation; operator messages are marked read when the visitor reloads the chat session.
- Attachments/images: image upload supports JPG, PNG, and WebP up to 5 MB, stores binaries in R2, and stores metadata in D1.
- Internal contact/customer info: visitor accounts, guest visitor identity, assigned operator, last operator, and staff chat are preserved.
- Current API routes: `/api/login`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`, `/api/account/register`, `/api/account/login`, `/api/account/logout`, `/api/account/me`, `/api/visitor`, `/api/sessions`, `/api/sessions/:id/messages`, `/api/sessions/:id/assign`, `/api/sessions/:id/close`, `/api/sessions/:id/delete`, `/api/sessions/:id/restore`, `/api/messages`, `/api/messages/:id/recall`, `/api/messages/purge-images`, `/api/admins`, `/api/admins/operators`, `/api/admins/profile`, `/api/staff-chat`, `/api/upload`, `/api/attachments/:key`, `/api/ws/admin`, `/api/ws/staff`, and `/api/ws/conversations/:id`.
- Database models/tables: `admins`, `admin_sessions`, `visitor_accounts`, `visitor_sessions`, `users`, `sessions`, `conversations` view, `messages`, `attachments`, `staff_messages`, `system_logs`, `settings`, and `rate_limits`.
- Environment variables/secrets: `SESSION_SECRET`, `SUPER_ADMIN_USERNAME`, and `SUPER_ADMIN_PASSWORD`. Old Vercel/Postgres/KV environment variables are no longer required for the Cloudflare Worker path.

## Current development commands

Use npm for the current repository. The root project intentionally has no `pnpm-lock.yaml`; CI installs root dependencies with npm.

```bash
# Local Worker development
npm run dev

# Frontend SPA only
npm run dev:spa

# Typecheck
npm run typecheck

# CI-safe lifecycle audit; does not access Cloudflare or D1
npm run lifecycle:ci-check

# Build and Wrangler dry-run
npm run build
```

For Windows shells, use the existing `npm.cmd` / `npx.cmd` equivalents where needed.

Do not use `npm run lifecycle:dry-run` for routine local audit or CI. It performs a Wrangler remote read-only D1 dry-run and requires explicit Cloudflare/D1 authorization.

## Cloudflare resources

After Wrangler login is confirmed, create the D1 database:

```bash
npx wrangler d1 create customer_chat_db
```

Copy the returned `database_id` into `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "customer_chat_db"
database_id = "..."
migrations_dir = "migrations"
```

Create the R2 bucket:

```bash
npx wrangler r2 bucket create customer-chat-uploads
```

The bucket binding should remain:

```toml
[[r2_buckets]]
binding = "UPLOADS"
bucket_name = "customer-chat-uploads"
```

Set secrets with Wrangler. Do not print or commit secret values:

```bash
npx wrangler secret put SESSION_SECRET
npx wrangler secret put SUPER_ADMIN_USERNAME
npx wrangler secret put SUPER_ADMIN_PASSWORD
```

Generate `SESSION_SECRET` as a long random value with a password manager or cryptographically secure random generator.

## Deployment

Run checks before production deployment:

```bash
npm run typecheck
npm run build
npx wrangler deploy
```

Before remote migration/deploy, replace the placeholder D1 `database_id` in `wrangler.toml` with the real value from `npx wrangler d1 create customer_chat_db`.

For routine guarded deployment, prefer:

```bash
npm run deploy:safe
```

`deploy:safe` checks the current branch, working tree, obvious code issues, lifecycle CI-safe checks, typecheck, doctor, build, and pending migrations before deploying. It does not modify Wrangler secrets, does not delete R2 objects, and does not auto commit, push, or tag.

## Self-hosting track

Self-hosting work lives under `server-generic/` and `deploy/linux/`. It is separate from the Cloudflare Worker production path. Use the documents in `deploy/linux/` and `docs/PRODUCTIZATION_INDEX.md` for the current self-hosting status.

Do not use old SQLite, Socket.IO, PM2, `server.js`, `app/`, or `lib/` deployment instructions. Those legacy Next.js-era files have been removed.

## Regression checklist

- Admin does not become `无账号` unless the D1-backed admin session is invalid or revoked.
- No full-page refresh loop is used for realtime chat state.
- No polling flicker is used for chat updates.
- Conversation A messages never appear in Conversation B.
- Message history persists after refresh.
- WebSocket reconnect fetches or reconciles missed messages through D1 message history.
- Mobile navigation does not log out admin.
- Attachments upload to R2, are recorded in D1, and display correctly.

## Security and secrets

Do not commit or document `.dev.vars`, `.env.production`, secrets, cookies, Cloudflare tokens, real usernames, or real passwords.

Administrator creation and password changes should be handled through the admin UI or a controlled D1/Worker operations process. Do not use legacy Postgres initialization or admin-creation scripts for production Cloudflare accounts.
=======
# 轻量级在线客服系统（Web Customer Support System）

基于 Next.js、TypeScript、Socket.io、SQLite、bcrypt 的轻量级在线客服系统，适合 15~50 个同时在线用户。访客无需注册，系统会自动生成访客身份并恢复历史会话。

## 功能

- 访客发送文字和图片，自动保存历史记录。
- 访客身份保存到 LocalStorage 与 Cookie，再次访问自动恢复。
- 多客服后台 `/admin`，支持待接入、处理中、已关闭会话。
- 手动接单，优先保留 `last_operator_id` 用于后续固定客服恢复。
- Socket.io 实时消息、刷新后重新加入会话房间、断线自动重连。
- 上传限制：jpg/jpeg/png/webp，最大 5MB，保存到 `public/uploads`，数据库只保存路径。
- 管理员密码使用 bcrypt，登录使用 HttpOnly Cookie。
- 首次启动自动创建 `admin` 账号和随机密码，并输出到控制台，首次登录后应修改密码。


## 给代码小白的说明：最终交付不是单个 HTML 或 exe

本系统包含前端页面、后端 API、Socket.io 实时通信和 SQLite 数据库，因此不能像普通静态网页一样只部署一个 `index.html`。也不建议为了云端部署打包成 Windows `exe`，因为云服务器需要长期运行 Node.js 服务。

推荐方式是把整个项目作为一个完整文件夹部署到云服务器。更详细的一步一步说明见 [`START_HERE.md`](./START_HERE.md)，完整说明书式教程见 [`docs/DEPLOYMENT_MANUAL_ZH.md`](./docs/DEPLOYMENT_MANUAL_ZH.md)。

如果你想生成一个方便上传/交付的压缩包，可以运行：

```bash
npm run make-release
```

生成结果：

```text
release/support-system/
release/support-system.zip   # 如果服务器或本机安装了 zip 命令
```

## 完整部署教程

如果你是代码小白，建议按这个文档一步一步操作：[`docs/DEPLOYMENT_MANUAL_ZH.md`](./docs/DEPLOYMENT_MANUAL_ZH.md)。

## 快速部署

```bash
npm install
npm run build
npm run start
```

默认监听 `http://localhost:3000`，可通过环境变量 `PORT=8080` 修改。

## 数据库初始化

数据库会在首次启动时自动初始化，默认位置：

```text
data/support.sqlite
```

也可以指定：

```bash
DATABASE_PATH=/var/lib/support/support.sqlite npm run start
```

## 管理员创建

首次启动会自动生成超级管理员：

```text
username=admin
password=<控制台随机输出>
```

创建额外客服账号：

```bash
npm run create-admin -- operator1 StrongPassword123 OPERATOR
npm run create-admin -- boss StrongPassword123 SUPER_ADMIN
```

## 环境变量

| 名称 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | HTTP 服务端口 |
| `DATABASE_PATH` | `data/support.sqlite` | SQLite 数据库路径 |
| `DATA_DIR` | `data` | 默认数据库目录 |
| `AUTH_SECRET` | `dev-change-me` | 管理员登录 Cookie 签名密钥，生产环境必须修改 |
| `NODE_ENV` | `production` | 生产运行环境 |

环境变量模板已经放在 `.env.example`，部署时可以复制为 `.env` 后修改。

## 目录结构

```text
app/                 Next.js 页面与 API Routes
app/page.tsx         访客聊天窗口
app/admin/page.tsx   客服后台
app/api/             登录、上传、会话、消息 API
lib/                 数据库与认证工具
public/uploads/      图片上传目录
scripts/             数据库、账号、启动和打包脚本
server.js            Next.js + Socket.io 自定义服务
START_HERE.md         小白快速说明
docs/DEPLOYMENT_MANUAL_ZH.md  说明书式部署教程
.env.example          环境变量模板
```

## Ubuntu VPS 建议

1. 安装 Node.js 20+。
2. 设置 `AUTH_SECRET` 和 `DATABASE_PATH`。
3. 使用 `npm install && npm run build && npm run start` 启动。
4. 可用 systemd 或 pm2 守护 `npm run start`。
5. 使用 Nginx 反向代理到本服务端口，并确保 WebSocket 代理开启。

## Windows 本地开发

```bash
npm install
npm run dev
```

或者双击/运行：

```bat
scripts\start-windows.bat
```

如需测试 Socket.io 生产服务，请运行：

```bash
npm run build
npm run start
```
>>>>>>> theirs
