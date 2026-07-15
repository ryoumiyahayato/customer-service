# Generic Server Adapter

This directory is an experimental generic Linux server adapter for the customer chat system. It does not replace the Cloudflare Worker production runtime.

## Production status

`server-generic` is not currently approved as a production backend. It now has a persistent invite lifecycle, authenticated URL-bound WebSockets, text-message idempotency, and basic read receipts, but it still lacks frontend-compatible image upload/display, complete lifecycle write automation, production audit parity, and full restore/failure-recovery validation.

Production-mode startup with public domains remains blocked unless the operator explicitly sets `SELF_HOST_EXPERIMENTAL_PUBLIC_ACK=I_UNDERSTAND_SERVER_GENERIC_IS_EXPERIMENTAL` after reviewing the documented risks. That acknowledgement only unlocks testing; it is not a production-readiness statement.

The supported production path remains the Cloudflare Worker entrypoint configured in `wrangler.toml`.

## Current scope

- Starts a Node HTTP server.
- Serves `GET /healthz`.
- Serves `GET /api/setup/status`.
- Serves `POST /api/setup/initialize` for first-admin creation only when `SETUP_TOKEN` is configured.
- Serves `POST /api/admin/login`, `POST /api/admin/logout`, and `GET /api/auth/me`.
- Serves frontend-compatible auth, session, message, invite, and read-receipt routes for the current Vite frontend.
- Stores invite token hashes only; raw invite tokens are returned once at creation.
- Supports invite expiry, revocation, single-use consumption, concurrent-consumption locking, and same-browser recovery through the visitor cookie.
- Supports text-message `clientMessageId` idempotency using the tuple `session + sender type + sender identity + client message id`.
- Orders message history by `(created_at, id)` and rejects writes to closed, archived, deleted, purged, or history-cleared sessions.
- Marks visitor messages read when an administrator opens a session and marks administrator messages read when the visitor loads or explicitly acknowledges the conversation.
- Serves `POST /api/visitor/sessions` for the lower-level generic API, though the frontend-compatible path should use persistent invites.
- Serves visitor message list/send APIs guarded by visitor token hash.
- Serves admin session list, admin message list/send, attachment download, close, and lifecycle APIs with per-session operator authorization; super admins retain global access.
- Authenticates WebSocket upgrades from `/api/ws/admin`, `/api/ws/staff`, and `/api/ws/conversations/:id` before binding a fixed room.
- Rejects client-driven WebSocket subscribe or room-switch messages.
- Broadcasts `message_created`, `messages_read`, and `session_closed` events.
- Serves built static assets from `STATIC_DIR`.
- Provides PostgreSQL migration support for the generic server schema.
- Provides local storage and lifecycle adapter skeletons for later migration.
- Provides a basic in-memory HTTP abuse guard for selected high-risk write endpoints.
- Applies same-origin checks to cookie-authenticated API reads/writes and WebSocket upgrades, plus application and Caddy security headers.

## Frontend compatibility routes

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/sessions`
- `GET /api/sessions/:id/messages`
- `POST /api/sessions/:id/customer-read`
- `POST /api/messages`
- `POST /api/guest/:token`
- `GET /api/invites`
- `POST /api/invites`
- `POST /api/invites/:id/revoke`
- `POST /api/upload` currently returns an explicit unsupported response

## Persistent invite lifecycle

`migrations/0005_v1_architecture_foundation.sql` creates `invite_links`. The database stores only `token_hash`; it also stores the creating administrator, optional source administrator, expiry, revocation, consumption time, and the created session.

Consumption uses a PostgreSQL transaction and `SELECT ... FOR UPDATE`. Only one concurrent request can consume an unused invite. A consumed invite can be resumed only when the request presents the visitor token that owns the previously created session. A different browser receives `invite_already_consumed`.

Invite tokens are not logged and are not returned by invite-list responses. The raw token is returned only by the creation response so it can be placed in the visitor URL.

## Message idempotency and read receipts

`clientMessageId` is optional but, when provided, is unique for the same session, sender type, sender identity, and client message id. Retrying the same body returns the existing message with `deduped: true`; reusing the id with different content returns `client_message_id_conflict`.

Read receipts update the same set of message IDs that is included in the `messages_read` WebSocket event. The current implementation provides basic conversation-level read acknowledgement; pagination and delivery acknowledgements remain future work.

## Not implemented yet

- Current frontend image upload and display parity; `POST /api/upload` remains unsupported in the compatibility layer.
- Complete self-host lifecycle write runner with automatic archive, trash, purge, retry, and aggregated alerting.
- Server-generic audit log parity for high-risk admin mutations.
- Full operator assignment and private-session parity with the Cloudflare runtime.
- Backup/restore failure-injection validation for PostgreSQL, storage, and encryption keys.
- Upstream DDoS protection. Large-scale volumetric attacks must be handled by the VPS provider, high-defense network, CDN, WAF, or Cloudflare-style upstream protection.

## WebSocket security

WebSocket clients do not send a free-form `subscribe` message. The request URL determines the room, and the server authenticates the existing admin or visitor cookie before accepting the upgrade. Conversation connections are bound to one session for their lifetime. Invalid, unauthenticated, or unauthorized upgrades are rejected before a WebSocket is created. A heartbeat closes stale connections, and incoming client data is rejected because this channel is broadcast-only.

## Basic HTTP abuse guard

`src/abuseGuard.ts` provides an in-memory application-layer rate limiter for ordinary HTTP abuse and scripted endpoint flooding. It protects admin login, setup initialization, guest bootstrap, text message writes, and upload attempts. Limited requests return HTTP 429 with `{ ok: false, error: "rate_limited" }` and a `Retry-After` header.

The guard is intentionally not a DDoS solution. It cannot replace VPS provider protection, high-defense hosting, CDN, WAF, Cloudflare, or other upstream mitigation for L3/L4 volumetric attacks or large L7 floods.

## Local commands

- `npm run typecheck`
- `npm run build`
- `npm run smoke`
- `npm run check:abuse-guard`
- `npm run check:admin-authorization`
- `npm run check:http-security`
- `npm run check:websocket-auth`
- `npm run check:v1-foundation`
- `npm run migrate:status`
- `npm run migrate`
- `npm run e2e:local-smoke`

The migration commands read `DATABASE_URL` and must only be run by an operator in the intended local/test server environment. CI applies migrations only to an ephemeral PostgreSQL container.

Setup is fail-closed when `SETUP_TOKEN` is missing: `/api/setup/status` reports `missing_setup_token`, and `/api/setup/initialize` rejects the request without creating an admin or setting a session cookie. First-admin setup creates a `SUPER_ADMIN` role so the current frontend's admin feature gates remain usable in self-hosted deployments.

## Safety

Do not put real secrets in this directory. Runtime values must come from the server `.env` file or secret management. Do not describe the explicit experimental acknowledgement as a security control or commercial readiness approval.
