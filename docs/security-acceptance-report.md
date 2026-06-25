# 最终安全验收报告

## 已完成项

- `/api/*` 请求统一由 `middleware.ts` 匹配并调用 `lib/api-security.ts` 的安全检查。
- 限流、失败计数与封禁状态通过 Vercel KV / Upstash Redis REST API 存储，生产环境缺少外部状态存储时 API fail closed 返回 503。
- 默认全局限流为每 IP + 路由 60 秒 60 次；登录相关接口为每 IP + 路由 60 秒 10 次。
- 登录接口记录失败计数并在达到阈值后设置 TTL 封禁；登录成功会清除对应失败计数。
- IP 获取优先使用 Vercel/CDN 转发头，不依赖 `req.ip`。
- 管理员相关 API 均在 API 层使用认证函数保护；SSE 事件接口也要求管理员认证。
- 生产 browser source map 已关闭。
- 仓库根目录 `.env.example` 已列出所有代码可配置安全参数；真实 `.env` 被 `.gitignore` 排除。
- 删除了旧的嵌套项目副本和不适配 Vercel Serverless 的旧自定义 `server.js`，避免旧代码形成绕过路径或误部署入口。

## 未完成项

- 未在代码中实现 Cloudflare WAF/Bot 配置；该能力必须由部署人员在 Cloudflare 控制台配置。
- 未在代码中验证 Vercel 项目控制台是否已配置 KV、Postgres 和环境变量；仓库权限无法读取控制台状态。
- `AUTH_SLOWDOWN_FAILURES` 当前作为策略参数暴露，现有实现以失败阈值封禁为主，尚未加入显式响应延迟。

## 无法通过仓库权限验证的部署项

- Vercel Edge Network 是否为生产流量入口。
- Vercel 环境变量真实值是否已配置且未过期。
- Vercel KV / Upstash Redis 实例是否在线、容量是否足够、访问 token 是否有效。
- Cloudflare WAF、Bot Fight Mode、速率限制和真实 IP 转发规则是否启用。
- 生产域名 DNS 是否只暴露预期入口。

## 仍存在的风险

- 若部署人员未配置 KV/Redis REST 环境变量，生产 API 会 fail closed，业务不可用但不会静默绕过限流。
- 若部署人员将 `.env.example` 示例值直接用于生产，认证与数据库安全会受影响；必须替换为强随机真实值。
- 上传接口在 Vercel 环境仍返回 data URL，适合轻量场景；大规模生产建议接入对象存储并增加内容审计。
- 轮询和 SSE 仍会消耗 Serverless 调用资源；高并发场景建议引入托管实时消息服务。
