# Shared module

Shared types and cross-cutting helpers live in `/lib`. Code placed here must be safe for the runtime that imports it; server-only helpers may only be imported by API routes or middleware.
