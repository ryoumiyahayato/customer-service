# Generic Server Adapter

This directory is the first generic Linux server adapter for the customer chat system. It does not replace the Cloudflare Worker runtime and does not modify the existing Cloudflare production path.

## Current scope

- Starts a Node HTTP server.
- Serves `GET /healthz`.
- Serves a minimal `GET /api/setup/status` placeholder.
- Serves built static assets from `STATIC_DIR`.
- Provides local storage, PostgreSQL, lifecycle, setup, and WebSocket adapter skeletons for later migration.

## Not implemented yet

- Full customer chat API.
- Admin auth/session implementation.
- PostgreSQL-backed data access.
- WebSocket room protocol.
- Lifecycle writes.
- Setup initialize.

## Safety

Do not put real secrets in this directory. Runtime values must come from the server `.env` file or future secret management.
