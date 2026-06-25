# 轻量级在线客服系统（Vercel / Next.js）

本项目是基于 Next.js App Router、TypeScript、Postgres 的轻量级在线客服系统。当前部署目标为 Vercel Serverless：前端页面只负责渲染与交互，后端能力统一通过 `/api/*` Next.js API Routes 暴露。

## 安全与架构边界

- **统一 API 入口**：所有 `/api/*` 请求都会经过 `middleware.ts`，再进入对应 API Route。
- **Serverless 兼容**：限流、失败计数与封禁状态使用 Redis 兼容的 Vercel KV / Upstash REST 存储，不依赖单实例内存状态。
- **限流策略**：默认每个 IP + 路由 60 秒最多 60 次请求；登录相关接口默认每个 IP + 路由 60 秒最多 10 次请求。
- **登录风控**：登录失败会写入带 TTL 的外部失败计数，达到阈值后写入短期 TTL 封禁。
- **真实 IP 获取**：优先读取 `x-forwarded-for`、`x-real-ip`、`x-vercel-forwarded-for`、`cf-connecting-ip`，不依赖 `req.ip`。
- **管理接口鉴权**：管理员会话、会话管理、客服管理、内部聊天、图片清理等接口均应在 API 层完成鉴权。
- **生产 source map**：`next.config.js` 已关闭 `productionBrowserSourceMaps`。

## 目录结构

```text
app/                 Next.js 页面与 API Routes
app/page.tsx         访客聊天页面
app/admin/page.tsx   客服后台页面
app/api/             登录、上传、会话、消息等 API Routes
lib/                 数据库、认证与 API 安全工具
frontend/            前端职责边界说明
backend/             后端/API 职责边界说明
shared/              共享代码职责边界说明
scripts/             数据库、账号、打包脚本
docs/                部署与安全文档
public/uploads/      本地开发上传占位目录
.env.example         环境变量模板
```

## 快速启动

```bash
npm install
npm run build
npm run start
```

生产部署建议使用 Vercel 标准构建流程，并在 Vercel 控制台配置环境变量。

## 环境变量

`.env.example` 包含仓库内可配置的安全参数。生产环境不要提交真实 `.env` 文件；请在 Vercel 项目设置中配置真实值。

| 名称 | 默认/示例 | 说明 |
| --- | --- | --- |
| `NODE_ENV` | `production` | 生产运行环境。 |
| `AUTH_SECRET` | `replace-with-a-long-random-cookie-signing-secret` | Cookie 签名密钥，生产必须使用高强度随机值。 |
| `POSTGRES_URL` | `postgres://USER:PASSWORD@HOST:5432/DATABASE?sslmode=require` | Postgres 连接串。 |
| `DATABASE_URL` | 可选 | 可替代 `POSTGRES_URL` 的平台连接串变量。 |
| `DEFAULT_ADMIN_USERNAME` | `owner-root` | 首个超级管理员用户名；已有超级管理员后不再创建。 |
| `DEFAULT_ADMIN_PASSWORD` | `replace-with-a-strong-private-password` | 首个超级管理员密码；必须使用强密码，不得提交真实值。 |
| `RESET_SUPER_ADMIN_ON_BOOTSTRAP` | `0` | 仅应在一次性恢复时临时设为 `1`，完成后立即恢复为 `0` 或删除。 |
| `KV_REST_API_URL` | `https://example.upstash.io` | Vercel KV / Upstash REST URL。生产 API 限流必需。 |
| `KV_REST_API_TOKEN` | `replace-with-kv-rest-token` | Vercel KV / Upstash REST Token。生产 API 限流必需。 |
| `UPSTASH_REDIS_REST_URL` | 可选 | `KV_REST_API_URL` 的兼容替代变量。 |
| `UPSTASH_REDIS_REST_TOKEN` | 可选 | `KV_REST_API_TOKEN` 的兼容替代变量。 |
| `API_RATE_LIMIT_WINDOW_SECONDS` | `60` | API 限流窗口秒数。 |
| `API_RATE_LIMIT_GLOBAL_MAX` | `60` | 普通 API 每 IP + 路由每窗口最大请求数。 |
| `API_RATE_LIMIT_AUTH_MAX` | `10` | 登录相关 API 每 IP + 路由每窗口最大请求数。 |
| `AUTH_FAILURE_LIMIT` | `5` | 登录失败计数阈值，达到后触发短期封禁。 |
| `AUTH_SLOWDOWN_FAILURES` | `3` | 预留的登录降速阈值配置，供后续更细粒度策略使用。 |
| `AUTH_BAN_SECONDS` | `600` | 登录失败封禁 TTL 秒数。 |

## Vercel 与 Cloudflare 配置说明

代码仓库只能实现应用层安全控制，不能自动读取或验证 Vercel / Cloudflare 控制台配置。部署人员需要在控制台手动完成以下事项：

1. 在 Vercel 项目中配置所有生产环境变量，尤其是 `AUTH_SECRET`、数据库连接串、KV/Redis REST URL 与 Token。
2. 确认 Vercel Edge Network 正常承载生产流量，并保留转发 IP 相关请求头。
3. 如接入 Cloudflare，请在 Cloudflare 控制台配置 WAF、Bot 防护、速率限制与真实 IP 转发策略。
4. 不要把关键安全逻辑只依赖 CDN；本仓库已在 API 层实现限流与封禁闭环。

## 数据库初始化与管理员

首次访问需要初始化 Postgres 表结构。也可手动运行：

```bash
npm run init-db
```

首次超级管理员依赖 `DEFAULT_ADMIN_USERNAME` 与 `DEFAULT_ADMIN_PASSWORD`。生产环境必须使用强密码，并在创建后妥善轮换。

## 更多文档

- 安全与 Serverless 说明：[`docs/api-security.md`](./docs/api-security.md)
- 部署手册：[`docs/DEPLOYMENT_MANUAL_ZH.md`](./docs/DEPLOYMENT_MANUAL_ZH.md)
