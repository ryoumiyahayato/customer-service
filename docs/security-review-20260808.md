# Security review — 2026-08-08

> **PR #44 amendment:** the device/location privacy section below documents the PR #43 state. PR #44 intentionally changes that boundary after a new production requirement: the guest session metadata now also stores the source IP address, but the full IP field is returned only to authenticated `SUPER_ADMIN` session-list requests and is not returned to ordinary `OPERATOR` accounts. Raw User-Agent is still not persisted, GPS/postal-code collection is still not introduced, and the session-scoped network metadata is removed with session purge. The current stolen-operator threat model and retention/security implications are documented in `docs/admin-risk-controls-20260808.md`.

Scope: current `customer-service` Cloudflare production path plus the user-facing changes in PR #43. This is a source-backed application security review and CI validation pass; it is not a live penetration test against the production deployment.

## Result

No confirmed Critical or High severity vulnerability was found in the reviewed Cloudflare production request path.

Two integrity / accountability gaps found during this review were corrected in PR #43:

1. **Trash restoration did not match the product lifecycle rule.** The UI could expose `restore`, and the production `SessionService` still implemented restoration. Trash is now treated as irreversible at the production Worker boundary and in `SessionService`; integration tests assert that restore remains unsupported before and after purge.
2. **Super-admin staff-chat clearing lacked a dedicated audit record.** A successful destructive clear now writes a `system_logs` event containing the actor id, deletion count, and clear timestamp. Message bodies are not copied into the audit record.

## Reviewed security boundaries

### Authentication and session handling

- Admin and visitor session cookies are `HttpOnly`, `Secure`, and `SameSite=Lax`.
- Signed cookie values use HMAC-SHA-256 and constant-time signature comparison.
- Database session rows store a hash of the session token and enforce revocation / expiry checks.
- Admin login and public registration are rate-limited by account and/or client network address.

### Authorization and object ownership

- Ordinary operators are restricted to sessions assigned to them; super-admin access is explicit.
- Session actions pass through the production `SessionService` / repository state checks.
- Attachment downloads require either authorized admin access to the conversation or the matching visitor session.
- Image-message attachment binding verifies conversation ownership before final binding.
- Destructive history clearing and all-staff-chat clearing require super-admin authorization.

### Cross-site request and WebSocket protections

- Mutating API requests enforce same-origin `Origin` / `Referer` checks outside local development.
- WebSocket upgrades enforce same-origin checks.
- Conversation WebSocket delivery re-checks the current admin or visitor authorization against D1 before delivering protected conversation events.

### Browser / content security

- User chat text is rendered through React rather than raw HTML.
- Autolinked message URLs are restricted to valid HTTPS URLs and use `noopener noreferrer nofollow` for new windows.
- Responses apply HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, a restrictive permissions policy, and CSP.
- Avatar uploads accept only JPG / PNG / WebP MIME types and enforce request/file size limits. Public avatar responses use `nosniff`.

### Invite and abuse controls

- One-time invite tokens are random 20-byte values represented as 40 hex characters; the database stores an HMAC-derived token hash rather than the raw invite token.
- Invite consumption remains single-use and is atomically claimed in the existing production logic.
- D1 rate limits use conditional updates rather than a read-then-write counter race, and expired limiter rows are removed by lifecycle cleanup.

## Device / location privacy boundary added in PR #43

The customer detail metadata intentionally does **not** implement the full fingerprinting-style data visible in the supplied reference screenshot.

Stored fields in the PR #43 state were limited to:

- a derived device/browser label such as `iPhone · 微信 8.0.75`;
- Cloudflare edge-provided city / region / country coarse location;
- capture timestamp.

In the PR #43 state, the feature did not store or expose:

- GPS coordinates;
- IP address in the customer metadata record;
- postal code;
- raw User-Agent string.

PR #44 supersedes only the IP part of that list as described in the amendment at the top of this document. GPS, postal code, and raw User-Agent remain excluded.

Metadata is available only through authorized admin session-list paths and is removed after the associated session reaches purge; PR #44 additionally filters the IP field to `SUPER_ADMIN` responses.

## Dependency and CI evidence

The repository CI performs production and development dependency audits at `high` severity, TypeScript checks, unit tests, SQLite integration tests, security/static contract checks, Cloudflare Wrangler dry-run, Docker self-host smoke, and packaging/static checks for the other deployment surfaces.

## Residual hardening items

These are not confirmed direct exploits in the reviewed Cloudflare production flow, but should remain tracked:

1. **Password KDF cost.** Existing password hashes use PBKDF2-HMAC-SHA-256 with 100,000 iterations. The format is iteration-versioned, so a future password-change/rehash policy can increase the cost without breaking old hashes. Raising it should be benchmarked against Cloudflare Worker CPU limits before rollout.
2. **Generic-server multi-instance abuse limiting.** The repository's existing security remediation notes still identify process-local abuse limiting in `server-generic` as unsuitable for unrestricted multi-instance public exposure without a shared atomic limiter.
3. **Cross-resource destructive cleanup.** Database rows and R2/file objects cannot form one native cross-resource transaction; clear-history / purge paths contain ownership checks and compensation/retry logic, but strict distributed atomicity would require an outbox or quarantine design.
4. **Volumetric DDoS.** Application rate limiting does not replace Cloudflare/upstream volumetric protection.

## Review boundary

This review does not claim production infrastructure penetration, secret rotation, live Cloudflare configuration inspection, or adversarial load/concurrency testing. Those require a separate deployment-level assessment.
