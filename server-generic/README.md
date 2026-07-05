# Generic Server Adapter

This directory is the first generic Linux server adapter for the customer chat system. It does not replace the Cloudflare Worker runtime and does not modify the existing Cloudflare production path.

## Current scope

- Starts a Node HTTP server.
- Serves `GET /healthz`.
- Serves `GET /api/setup/status`.
- Serves `POST /api/setup/initialize` for first-admin creation only.
- Serves `POST /api/admin/login`, `POST /api/admin/logout`, and `GET /api/auth/me`.
- Serves `POST /api/visitor/sessions`.
- Serves visitor message list/send APIs guarded by visitor token hash.
- Serves admin session list, admin message list/send, and close APIs guarded by admin session.
- Provides a minimal WebSocket hub for session subscription and message/close broadcasts.
- Serves built static assets from `STATIC_DIR`.
- Provides PostgreSQL migration support for the generic server schema.
- Provides local storage, lifecycle, and WebSocket adapter skeletons for later migration.

## Not implemented yet

- Full customer chat API.
- WebSocket room protocol.
- Attachment upload and storage cleanup.
- Read receipt migration.
- Lifecycle writes.

## Local commands

- `npm run typecheck`
- `npm run build`
- `npm run smoke`
- `npm run migrate:status`
- `npm run migrate`

The migration commands read `DATABASE_URL` and must only be run by an operator in the intended server environment.

## Safety

Do not put real secrets in this directory. Runtime values must come from the server `.env` file or future secret management.
