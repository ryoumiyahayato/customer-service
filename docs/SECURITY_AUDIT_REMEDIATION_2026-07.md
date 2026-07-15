# Security audit remediation status

This change set addresses the reviewed high-risk business closure gaps without performing deployment or remote data operations.

## Addressed

- `server-generic` WebSocket upgrades are authenticated and URL-bound; client-driven room subscription is removed.
- Public production-mode `server-generic` startup is blocked by default while its invite flow remains experimental.
- Cloudflare lifecycle cutoff comparisons normalize stored timestamps with SQLite `datetime()`.
- Lifecycle purge atomically claims an eligible trash session, deletes R2 objects and related attachment/message rows, and retries claimed sessions until history is marked cleared.
- Operator disabling revokes login sessions and unassigns active ownership without deleting customer sessions or historical operator records.
- Physical operator deletion is rejected to preserve foreign-key and audit history.
- Image-message attachment binding reserves an unbound attachment for the authenticated uploader and compensates if final binding fails.
- The unused legacy `lib/types.ts` file is removed.
- CI checks the corrected lifecycle semantics and the new business-hardening invariants.
- `server-generic` now has persistent single-use invites, per-session operator authorization, same-origin HTTP/WebSocket checks, and anonymous bootstrap limiting.
- Backup manifests are HMAC-authenticated and restore validates archives before stopping writes, with database/storage rollback on downstream failure.
- Cloudflare D1 rate limits use conditional updates so concurrent requests cannot all pass a stale counter read.

## Remaining limitations

- `server-generic` still uses a process-local abuse guard and needs a shared atomic limiter before multi-instance public deployment.
- Generic clear-history file deletion and PostgreSQL deletion still need an outbox/quarantine design for strict cross-resource atomicity.
- The new checks include static regression checks and existing integration smoke tests; they are not a substitute for real VPS, failure-injection, and adversarial concurrency tests.
- Volumetric DDoS protection remains an upstream infrastructure responsibility.

## Operational boundary

This change set does not deploy Cloudflare, apply D1 migrations, access R2, modify secrets, connect to a VPS, initialize production setup, or run lifecycle writes against a remote environment.
