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
- Customer service/admin accounts: super admin can create and disable operators. Physical deletion is intentionally rejected to preserve historical references.
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
