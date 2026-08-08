# Cloudflare Customer Support Chat

This project is a customer support chat system using a Cloudflare-native production path, with a separate `server-generic` self-host adapter under active productization.

> PR #52 is still under architecture/security convergence. Do not merge or deploy this branch until the P2 cleanup and validation described in the PR are complete.

## Current production architecture

- Frontend: React + Vite SPA served by Cloudflare static assets. `AdminDashboard` owns authenticated admin/session/capability/unread state; desktop and mobile shells consume that shared workspace state instead of maintaining parallel auth or navigation state.
- Visitor frontend: a separate Vite visitor entry and same-origin visitor API surface. Visitor code must import the visitor API directly; build-time source rewriting is not part of the security boundary.
- API backend: production requests enter through `src/worker-production-boundary.ts`; compatibility Worker layers may remain temporarily, but shared security primitives own admin-session, operator-policy, request-origin, password, and domain-isolation rules.
- Realtime: Durable Objects + WebSocket in `src/durable-objects/ChatRoom.ts`, with staff and conversation authorization revalidated against current D1 state.
- Database: D1 database named `customer_chat_db`.
- Attachments/images: R2 bucket named `customer-chat-uploads`.
- Sessions: HttpOnly signed cookies backed by D1 `admin_sessions` and `visitor_sessions` tables.
- Deployment: Wrangler through the repository guarded deployment entry point only.

## State ownership

`settings` is reserved for truly generic product configuration. Security- or identity-bound runtime state must use typed tables instead of string-prefixed JSON keys. Operator capabilities, operator presentation, visitor/session client metadata, active admin-session pointers, and admin-session metadata are migrated to dedicated tables by the current migration set.

## Feature inventory

- Visitor chat entry: single-use token subdomains on the configured visitor root domain.
- Admin login: username/password login uses HttpOnly signed cookies and D1 session lookup.
- Super admin: first super admin can be bootstrapped from Wrangler secrets when no super admin exists.
- Customer service/admin accounts: super admin can create and disable operators. Physical deletion is intentionally rejected to preserve historical references.
- Conversation list: admin view groups PENDING, OPEN, CLOSED, ARCHIVED, and deleted conversations.
- Message history: D1-backed messages are fetched per conversation and persist across refresh.
- Realtime sending/receiving: WebSocket rooms are keyed by `conversation:<sessionId>`; no global message array is shared between conversations.
- Unread/read status: visitor messages are marked read when an admin opens a conversation; operator messages are marked read when the visitor reloads the chat session.
- Attachments/images: image upload supports JPG, PNG, and WebP up to 5 MB, stores binaries in R2, and stores metadata in D1.
- Internal contact/customer info: visitor accounts, guest visitor identity, assigned operator, last operator, and staff chat are preserved.
- Current API routes: `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`, `/api/sessions`, `/api/sessions/:id/messages`, `/api/sessions/:id/assign`, `/api/sessions/:id/close`, `/api/sessions/:id/delete`, `/api/sessions/:id/restore`, `/api/messages`, `/api/messages/:id/recall`, `/api/messages/purge-images`, `/api/admins`, `/api/admins/operators`, `/api/admins/profile`, `/api/staff-chat`, `/api/upload`, `/api/attachments/:key`, `/api/ws/admin`, `/api/ws/staff`, and `/api/ws/conversations/:id`. Visitor-host API access is additionally constrained by the public-gate allowlist.
- Database models/tables: `admins`, `admin_sessions`, `visitor_accounts`, `visitor_sessions`, `users`, `sessions`, `messages`, `attachments`, `staff_messages`, `system_logs`, `rate_limits`, and dedicated typed runtime-state tables. `settings` is not the authority for operator policy/session metadata after the current migrations.
- Environment variables/secrets: `SESSION_SECRET`, `SUPER_ADMIN_USERNAME`, and `SUPER_ADMIN_PASSWORD`. Old Vercel/Postgres/KV environment variables are no longer required for the Cloudflare Worker path.

## Current development commands

Use npm for the current repository. The root project intentionally has no `pnpm-lock.yaml`; CI installs root dependencies with npm.

```bash
npm run dev
npm run dev:spa
npm run typecheck
npm run lifecycle:ci-check
npm run build
```

For Windows shells, use the existing `npm.cmd` / `npx.cmd` equivalents where needed.

Do not use `npm run lifecycle:dry-run` for routine local audit or CI. It performs a Wrangler remote read-only D1 dry-run and requires explicit Cloudflare/D1 authorization.

## Cloudflare resources

After Wrangler login is confirmed, create the D1 database:

```bash
npx wrangler d1 create customer_chat_db
```

Copy the returned `database_id` into `wrangler.toml` and keep `migrations_dir = "migrations"`.

Create the R2 bucket:

```bash
npx wrangler r2 bucket create customer-chat-uploads
```

Set secrets with Wrangler. Do not print or commit secret values:

```bash
npx wrangler secret put SESSION_SECRET
npx wrangler secret put SUPER_ADMIN_USERNAME
npx wrangler secret put SUPER_ADMIN_PASSWORD
```

Generate `SESSION_SECRET` as a long random value with a password manager or cryptographically secure random generator.

## Deployment

Production deployment has one supported repository entry point:

```bash
npm run deploy:safe
```

If the guarded deploy reports pending D1 migrations, review them and rerun explicitly:

```bash
npm run deploy:safe -- --apply-migrations
```

Do not use direct `wrangler deploy`, `npx wrangler deploy`, or a legacy repository deploy wrapper for production. The guarded deploy requires a clean local `main` that exactly matches `origin/main`, runs repository validation, requires the remote D1 migration state to be readable, blocks on pending migrations by default, applies migrations only after an interactive yes/no confirmation, re-checks migration state, builds, deploys, and then runs the documented online smoke check.

A non-`main` branch must never promote a version to the production deployment. Cloudflare Workers Builds supports a separate non-production branch deploy command that uploads a preview version; if preview builds are enabled, they must not be wired to production-only state in a way that permits test traffic to mutate production D1/R2. The repository therefore treats the production branch and production migration gate as authoritative even when a preview build exists.

Before remote migration/deploy, ensure the D1 `database_id` in `wrangler.toml` is the intended production database.

## Self-hosting track

Self-hosting work lives under `server-generic/` and `deploy/linux/`. It is separate from the Cloudflare Worker production path. Use the documents in `deploy/linux/` and `docs/PRODUCTIZATION_INDEX.md` for the current self-hosting status.

Do not use old SQLite, Socket.IO, PM2, `server.js`, `app/`, or `lib/` deployment instructions. Those legacy Next.js-era files have been removed.

## Regression checklist

- Admin does not become `无账号` unless the D1-backed admin session is invalid or revoked.
- A replaced/revoked admin session leaves the authenticated workspace without requiring a manual refresh.
- Admin session/capability fallback refresh remains available when the admin WebSocket feed is unavailable.
- No full-page refresh loop is used for realtime chat state.
- Conversation A messages never appear in Conversation B.
- Message history persists after refresh.
- WebSocket reconnect fetches or reconciles missed messages through D1 message history.
- Mobile navigation does not log out admin.
- Attachments upload to R2, are recorded in D1, and display correctly.
- Visitor source imports only the visitor API surface; no build-time import rewriting is required.
- No legacy `/g/<token>` visitor route is accepted by an inner Worker layer.

## Security and secrets

Do not commit or document `.dev.vars`, `.env.production`, secrets, cookies, Cloudflare tokens, real usernames, or real passwords.

Security must not depend on the admin hostname being secret. Domain separation reduces accidental exposure and attack surface, but authorization, host validation, same-origin checks, signed sessions, capability checks, and database ownership rules must remain sufficient even if an attacker learns both production hostnames and API paths.

Administrator creation and password changes should be handled through the admin UI or a controlled D1/Worker operations process. Do not use legacy Postgres initialization or admin-creation scripts for production Cloudflare accounts.
