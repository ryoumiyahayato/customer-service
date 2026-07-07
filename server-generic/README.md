# Generic Server Adapter

This directory is the first generic Linux server adapter for the customer chat system. It does not replace the Cloudflare Worker runtime and does not modify the existing Cloudflare production path.

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
- Provides a minimal WebSocket hub for session subscription and message/close broadcasts.
- Serves built static assets from `STATIC_DIR`.
- Provides PostgreSQL migration support for the generic server schema.
- Provides local storage, lifecycle, and WebSocket adapter skeletons for later migration.

## Not implemented yet

- Full invite management parity with the Cloudflare Worker version.
- Full customer chat API parity.
- Current frontend image upload parity; `POST /api/upload` returns an explicit unsupported error in the generic compatibility layer.
- Full WebSocket room protocol parity.
- Read receipt migration.
- Automatic lifecycle runner writes.
- Server-generic audit log parity for high-risk admin mutations.

## Frontend compatibility layer

`src/frontendCompat.ts` maps the current Vite frontend API shape onto the generic server internals. The generic server can keep camelCase internal models, but compatibility responses return the snake_case fields used by the current frontend, including `session_id`, `sender_type`, `content`, `message_type`, `created_at`, `updated_at`, `unread_count`, `status`, and related nullable fields.

The minimal self-hosted visitor bootstrap accepts `/g/:token` through the current frontend's `POST /api/guest/:token` call and creates or resumes a visitor session using an HttpOnly visitor cookie. It does not persist invite records and must not be described as complete invite management.

## Local commands

- `npm run typecheck`
- `npm run build`
- `npm run smoke`
- `npm run migrate:status`
- `npm run migrate`

The migration commands read `DATABASE_URL` and must only be run by an operator in the intended server environment.

Setup is fail-closed when `SETUP_TOKEN` is missing: `/api/setup/status` reports `missing_setup_token`, and `/api/setup/initialize` rejects the request without creating an admin or setting a session cookie. First-admin setup creates a `SUPER_ADMIN` role so the current frontend's admin feature gates remain usable in self-hosted deployments.

## Safety

Do not put real secrets in this directory. Runtime values must come from the server `.env` file or future secret management.
