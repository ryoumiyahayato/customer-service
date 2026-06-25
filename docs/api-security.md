# API security and Serverless deployment

- All externally callable backend endpoints are exposed as `/api/*` Next.js API Routes.
- `/middleware.ts` is the unified API ingress for rate limiting before route handlers execute.
- Rate limit and ban state is stored in Redis-compatible Vercel KV/Upstash REST storage using `KV_REST_API_URL` + `KV_REST_API_TOKEN` or `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`.
- Global API limit: 60 requests per IP, route, and 60-second window.
- Authentication/login routes: 10 requests per IP, route, and 60-second window, plus failed-login counters with TTL-backed short bans.
- Client IP extraction prefers CDN/Vercel forwarding headers (`x-forwarded-for`, `x-real-ip`, `x-vercel-forwarded-for`, `cf-connecting-ip`) instead of relying on `req.ip`.
- Production source maps are disabled in `next.config.js`.
