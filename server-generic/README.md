# Generic Server Adapter

This directory is an experimental generic Linux server adapter for the customer chat system. It does not replace the Cloudflare Worker production runtime.

## Production status

`server-generic` is not currently approved as a production backend. The compatibility visitor bootstrap still does not provide a persistent invite lifecycle with hashed tokens, expiry, single-use consumption, and revocation. Production-mode startup with public domains is therefore blocked unless the operator explicitly sets `SELF_HOST_EXPERIMENTAL_PUBLIC_ACK=I_UNDERSTAND_SERVER_GENERIC_IS_EXPERIMENTAL` after reviewing the documented risks. That acknowledgement only unlocks testing; it is not a production-readiness statement.

The supported production path remains the Cloudflare Worker entrypoint configured in `wrangler.toml`.

## Current scope

- Starts a Node HTTP server.
- Serves `GET /healthz`.
- Serves `GET /api/setup/status`.
- Serves `POST /api/setup/initialize` for first-admin creation only when `SETUP_TOKEN` is configured.
- Serves `POST /api/admin/login`, `POST /api/admin/logout`, and `GET /api/auth/me`.
- Serves frontend-compatible `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `GET /api/sessions`, `GET /api/sessions/:id/messages`, and `POST /api/messages` for the current Vite frontend.
- Serves a minimal self-hosted visitor bootstrap at `POST /api/guest/:token`; this is not the full invite system and exists only to let the current frontend complete a text-chat self-hosted smoke path.
- Serves `POST /api/visitor/sessions`.
- Serves visitor message list/send APIs guarded by visitor token hash.
- Serves admin session list, admin message list/send, and close APIs guarded by admin session.
- Authenticates WebSocket upgrades from `/api/ws/admin`, `/api/ws/staff`, and `/api/ws/conversations/:id` before binding a fixed room.
- Rejects client-driven WebSocket subscribe or room-switch messages.
- Serves built static assets from `STATIC_DIR`.
- Provides PostgreSQL migration support for the generic server schema.
- Provides local storage and lifecycle adapter skeletons for later migration.
- Provides a basic in-memory HTTP abuse guard for selected high-risk write endpoints.

## Not implemented yet

- Persistent invite management parity with the Cloudflare Worker version.
- Full customer chat API parity.
- Current frontend image upload parity; `POST /api/upload` returns an explicit unsupported error in the generic compatibility layer.
- Read receipt migration.
- Automatic lifecycle runner writes.
- Server-generic audit log parity for high-risk admin mutations.
- Upstream DDoS protection. Large-scale volumetric attacks must be handled by the VPS provider, high-defense network, CDN, WAF, or Cloudflare-style upstream protection.

## Frontend compatibility layer

`src/frontendCompat.ts` maps the current Vite frontend API shape onto the generic server internals. The generic server can keep camelCase internal models, but compatibility responses return the snake_case fields used by the current frontend, including `session_id`, `sender_type`, `content`, `message_type`, `created_at`, `updated_at`, `unread_count`, `status`, and related nullable fields.

The minimal self-hosted visitor bootstrap accepts `/g/:token` through the current frontend's `POST /api/guest/:token` call and creates or resumes a visitor session using an HttpOnly visitor cookie. It does not persist invite records and must not be described as complete invite management.

## WebSocket security

WebSocket clients no longer send a free-form `subscribe` message. The request URL determines the room, and the server authenticates the existing admin or visitor cookie before accepting the upgrade. Conversation connections are bound to one session for their lifetime. Invalid, unauthenticated, or unauthorized upgrades are rejected before a WebSocket is created. A heartbeat closes stale connections, and incoming client data is rejected because this channel is broadcast-only.

## Basic HTTP abuse guard

`src/abuseGuard.ts` provides an in-memory application-layer rate limiter for ordinary HTTP abuse and scripted endpoint flooding. It currently protects admin login, setup initialization, guest bootstrap, text message writes, and upload attempts. Limited requests return HTTP 429 with a JSON `{ ok: false, error: "rate_limited" }` response and a `Retry-After` header.

The guard is intentionally not a DDoS solution. It can reduce the impact of low-cost HTTP abuse, but it cannot replace VPS provider protection, high-defense hosting, CDN, WAF, Cloudflare, or other upstream mitigation for L3/L4 volumetric attacks or large L7 floods.

Default thresholds can be overridden with environment variables such as `ABUSE_LOGIN_LIMIT`, `ABUSE_LOGIN_WINDOW_SECONDS`, `ABUSE_SETUP_LIMIT`, `ABUSE_SETUP_WINDOW_SECONDS`, `ABUSE_GUEST_LIMIT`, `ABUSE_GUEST_WINDOW_SECONDS`, `ABUSE_MESSAGE_LIMIT`, `ABUSE_MESSAGE_IP_LIMIT`, `ABUSE_MESSAGE_WINDOW_SECONDS`, `ABUSE_UPLOAD_LIMIT`, and `ABUSE_UPLOAD_WINDOW_SECONDS`.

## Local commands

- `npm run typecheck`
- `npm run build`
- `npm run smoke`
- `npm run check:abuse-guard`
- `npm run check:websocket-auth`
- `npm run migrate:status`
- `npm run migrate`

The migration commands read `DATABASE_URL` and must only be run by an operator in the intended server environment.

Setup is fail-closed when `SETUP_TOKEN` is missing: `/api/setup/status` reports `missing_setup_token`, and `/api/setup/initialize` rejects the request without creating an admin or setting a session cookie. First-admin setup creates a `SUPER_ADMIN` role so the current frontend's admin feature gates remain usable in self-hosted deployments.

## Safety

Do not put real secrets in this directory. Runtime values must come from the server `.env` file or future secret management. Do not describe the explicit experimental acknowledgement as a security control or commercial readiness approval.
