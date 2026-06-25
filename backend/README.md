# Backend module

Backend behavior is exposed only through Next.js API Routes under `/app/api/*`, which Vercel deploys as Serverless Functions. API security is centralized in `/middleware.ts` and `/lib/api-security.ts` so routes share external Redis/Vercel KV backed rate limiting and ban state.
