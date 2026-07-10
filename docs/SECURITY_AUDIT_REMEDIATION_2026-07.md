# Security audit remediation status

This change set addresses the reviewed high-risk business closure gaps without performing deployment or remote data operations.

## Addressed

- `server-generic` WebSocket upgrades are authenticated and URL-bound; client-driven room subscription is removed.
- Public production-mode `server-generic` startup is blocked by default while its invite flow remains experimental.
- Cloudflare lifecycle cutoff comparisons normalize stored timestamps with SQLite `datetime()`.
- Lifecycle purge deletes R2 objects and related attachment/message rows before marking a session purged.
- Operator disabling revokes login sessions and unassigns active ownership without deleting customer sessions or historical operator records.
- Physical operator deletion is rejected to preserve foreign-key and audit history.
- Image-message attachment binding reserves an unbound attachment for the authenticated uploader and compensates if final binding fails.
- The unused legacy `lib/types.ts` file is removed.
- CI checks the corrected lifecycle semantics and the new business-hardening invariants.

## Remaining limitations

- `server-generic` invite creation and consumption are still a minimal compatibility bootstrap, not a persistent production invite lifecycle.
- The new checks include static regression checks and existing integration smoke tests; they are not a substitute for full state-machine and adversarial concurrency tests.
- Volumetric DDoS protection remains an upstream infrastructure responsibility.

## Operational boundary

This change set does not deploy Cloudflare, apply D1 migrations, access R2, modify secrets, connect to a VPS, initialize production setup, or run lifecycle writes against a remote environment.
