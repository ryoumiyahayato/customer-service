# 小白部署说明：这不是一个单独 HTML，也不建议做成 exe

这个项目是“在线客服系统”，不是静态网页。它需要：

- 一个网页前端：访客聊天窗口、客服后台。
- 一个后端服务：登录、上传图片、保存聊天记录。
- 一个实时连接服务：Socket.io，用来实时收发消息。
- 一个数据库文件：SQLite，用来保存用户、会话、消息和管理员。

所以它不能只打包成一个 `index.html` 后直接双击运行；如果做成 Windows `exe`，也只适合本地电脑运行，不适合云服务器长期部署。

## 推荐交付形态

最终给服务器部署时，把它当作一个“完整项目文件夹”部署：

```text
support-system/
├── app/
├── lib/
├── public/uploads/
├── scripts/
├── server.js
├── package.json
├── next.config.js
├── tsconfig.json
└── README.md
```

本地开发和发布使用当前 Wrangler 流程，见下方命令清单。

然后访问：

- 访客端：`http://服务器IP:3000/`
- 客服后台：`http://服务器IP:3000/admin`

如果你需要更详细的“说明书式教程”，请看：`docs/DEPLOYMENT_MANUAL_ZH.md`。

## 最简单的云端部署流程

1. 买一台 Ubuntu VPS。
2. 安装 Node.js 20 或更高版本。
3. 上传整个项目文件夹。
4. 进入项目目录。
5. Configure production secrets through Wrangler or Cloudflare Dashboard. Do not commit `.dev.vars`, `.env.production`, secrets, cookies, or Cloudflare tokens.
7. 安装依赖并构建：

```bash
npm install
npm run build
```

8. 本地 Worker 开发运行 `npm.cmd run dev`。管理员创建和密码修改通过后台功能或受控 D1/Worker 运维流程处理。

## Current Production Admin And Database Operations

The current production system uses Cloudflare Worker + Vite + D1. Do not use legacy Postgres initialization or admin-creation scripts for production accounts.

Administrator creation and password changes should be handled through the admin UI or a controlled D1/Worker operations process. Do not document or store real usernames, passwords, session secrets, tokens, or cookies in this repository.


## Current Development And Deployment Commands

Use the current Cloudflare Worker + Vite + D1 + Wrangler flow:

```powershell
# Local Worker development
npm.cmd run dev

# Frontend SPA only
npm.cmd run dev:spa

# Typecheck
npm.cmd run typecheck

# CI-safe lifecycle audit; does not access Cloudflare or D1
npm.cmd run lifecycle:ci-check

# Build and Wrangler dry-run
npm.cmd run build

# Production deploy, only after review
npx.cmd wrangler deploy
```

Do not use `npm.cmd run lifecycle:dry-run` for routine local audit or CI. It performs a Wrangler remote read-only D1 dry-run and requires explicit Cloudflare/D1 authorization.

Do not commit or document `.dev.vars`, `.env.production`, secrets, cookies, or Cloudflare tokens.

## Safe Cloudflare Deployment

Use the safe deploy tool for routine Cloudflare test environment deployment:

```powershell
npm.cmd run deploy:safe
```

This command automatically:
- Checks that the current branch is `main` and working tree is clean
- Syncs with `origin/main`
- Runs obvious code issue scan (conflict markers, debugger, dangerous HTML injection, hardcoded secrets, forbidden commands)
- Runs `check-chat-message-text`, `check-session-lifecycle`, `typecheck`, `doctor`, and `lifecycle:ci-check`
- Checks for pending D1 remote migrations
- Builds and deploys if no pending migrations
- Cleans up `dist` after deployment

**No pending migration:** Deployment proceeds automatically without manual confirmation.

**Pending migration detected:** The tool blocks deployment. To allow migration and deploy:

```powershell
npm.cmd run deploy:safe -- --apply-migrations
```

Then type exactly:

```
APPLY REMOTE D1 MIGRATIONS
```

**Important:**
- `deploy:safe` does NOT run `lifecycle:dry-run`
- `deploy:safe` does NOT auto commit, push, or tag
- `deploy:safe` does NOT modify Wrangler secrets
- `deploy:safe` does NOT delete R2 objects
- D1 migrations must be applied before deploy
- This workflow is for the Cloudflare test environment only; customer self-deployments use a different process
