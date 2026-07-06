# Security hardening wrapper

This deployment now routes Cloudflare Worker traffic through `src/worker-secure.ts` before delegating to the existing application worker.

The wrapper is intentionally small and focused on request-level controls that do not require changing the large legacy router immediately:

- Same-origin write protection for non-safe `/api/*` requests, excluding WebSocket upgrade paths.
- Login throttling for admin and visitor login endpoints, keyed by IP and username.
- Public account registration throttling and input validation.
- Guest-history registration binding requires the current signed guest session to match the requested `visitorId`.
- Visitor-account logout revokes the stored session row before clearing the cookie.
- Unsafe environment bootstrap super-admin credentials are rejected before the legacy worker can auto-create the account.
- Setup mutation requests use the same JSON body-size guard as other mutation endpoints.
- Server-side validation for administrator/operator usernames and passwords on account creation/profile mutation.
- Message length limits for chat and internal staff-chat writes.
- Image message validation to ensure referenced attachments belong to the target session and are still unconsumed.
- Quote validation to ensure quoted messages belong to the same session.
- Upload request preflight checks for size, MIME type, and image magic bytes before the legacy upload handler stores the file.
- Attachment download preflight checks for method, deleted records, and expired orphan uploads.
- Invite token shape validation before guest invite consumption reaches the legacy router.
- Chat links are rendered as external links with `noopener`, `noreferrer`, and `nofollow`.
- Baseline response security headers, including CSP, `X-Content-Type-Options`, `Referrer-Policy`, and `Permissions-Policy`.

The existing application worker remains the source of business logic. The wrapper can be collapsed into `src/worker.ts` later after the router is split into smaller modules.

The lifecycle task deletes expired orphan attachment rows and their R2 objects. This only targets uploads that never became attached to a message, reducing storage abuse without deleting valid chat history images. It also removes stale `rate_limits` records, expired/revoked auth session rows, and stale invite links to limit unbounded table growth from expired throttling/session/invite keys.
