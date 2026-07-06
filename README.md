# Cloudflare Customer Support Chat

This project is being migrated from a Next.js/Vercel-style serverless chat app to a Cloudflare-native architecture.

## Target Architecture

- Frontend: React + Vite SPA served by Cloudflare static assets.
- API backend: Cloudflare Worker in `src/worker.ts`.
- Realtime: Durable Objects + WebSocket in `src/durable-objects/ChatRoom.ts`.
- Database: D1 database named `customer_chat_db`.
- Attachments/images: R2 bucket named `customer-chat-uploads`.
- Sessions: HttpOnly signed cookies backed by D1 `admin_sessions` and `visitor_sessions` tables.
- Deployment: Wrangler.

## Feature Inventory

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

## Migration Plan

1. Keep the Vite SPA and Worker API as the primary Cloudflare deployment path.
2. Leave old Next.js API route files in place only as historical/reference code; Cloudflare runtime uses `src/worker.ts`.
3. Use D1 for accounts, sessions, conversations, messages, attachment metadata, settings, and rate limiting.
4. Use Durable Object rooms for visitor/admin/staff realtime updates. Do not reintroduce polling, `router.refresh()`, `window.location.reload()`, `location.reload()`, or full-page reload loops for realtime state.
5. Use R2 for images/files. Do not write uploads to local filesystem paths in production.
6. Store only signed session ids in HttpOnly cookies; validate sessions against D1.
7. Bootstrap the first super admin from secrets only when no super admin exists. Do not store real secrets in code.

## Cloudflare Resources

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

Generate `SESSION_SECRET` as a long random value, for example with a password manager or a cryptographically secure random generator.

## Local Development

```bash
pnpm install
pnpm run db:migrate:local
pnpm run cf:dev
```

Open the local Wrangler URL. `/` is the visitor chat and `/admin` is the admin console.

For routine audit and CI validation, use `npm.cmd run lifecycle:ci-check`; it does not access Cloudflare or D1. `npm.cmd run lifecycle:dry-run` performs a Wrangler remote read-only D1 check and should only run in an explicitly authorized Cloudflare/D1 environment.

## Deployment

```bash
pnpm run db:migrate:remote
pnpm run cf:deploy
```

Before remote migration/deploy, replace the placeholder D1 `database_id` in `wrangler.toml` with the real value from `npx wrangler d1 create customer_chat_db`.

## Custom Domain

Bind a custom domain in the Cloudflare Dashboard:

Cloudflare Dashboard -> Workers & Pages -> Worker -> Settings / Domains & Routes -> Add Custom Domain

## Regression Checklist

- Admin does not become `Œﬁ’Àªß` unless the D1-backed admin session is invalid or revoked.
- No full-page refresh loop is used for realtime chat state.
- No polling flicker is used for chat updates.
- Conversation A messages never appear in Conversation B.
- Message history persists after refresh.
- WebSocket reconnect fetches or reconciles missed messages through D1 message history.
- Mobile navigation does not log out admin.
- Attachments upload to R2, are recorded in D1, and display correctly.

## Notes

The old Next.js route files under `app/api` still exist as migration reference code, but the configured Cloudflare entrypoint is `src/worker.ts`. Avoid adding Node-only APIs such as `fs`, `net`, `child_process`, Express servers, Socket.IO servers, or Prisma to the Worker path.

## Current Production Admin And Database Operations

The current production system uses Cloudflare Worker + Vite + D1. Do not use legacy Postgres initialization or admin-creation scripts for production accounts.

Administrator creation and password changes should be handled through the admin UI or a controlled D1/Worker operations process. Do not document or store real usernames, passwords, session secrets, tokens, or cookies in this repository.
