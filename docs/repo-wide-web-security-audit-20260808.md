# Repository-wide web security audit — 2026-08-08

## Scope and baseline

This audit is based on `main` after PR #47, fixed baseline `9bc35561cf371a107973ced24cf28e3de4518554`.

The review covers the Cloudflare production path (Worker, Durable Objects, D1, R2, admin React bundle, visitor React bundle, invite-token subdomains, WebSocket, uploads and attachments), the generic self-host adapter, deployment entry points, and the browser-facing security boundary.

The dedicated Codex Security Deep Scan service is not available in this ChatGPT runtime. This report therefore records direct repository-wide source review, attack-path reasoning, regression tests, build-time surface checks, SQLite integration coverage, Wrangler dry-run validation, and self-host local smoke coverage. It does not claim an automated Deep Security Scan.

## Non-negotiable security invariant

The admin/backend surface and the visitor surface are separate capabilities, not merely different UI routes.

Production policy:

- Admin entry is the configured admin hostname only.
- Visitor entry is a live one-time `https://<40-hex-token>.<visitor-root>/` hostname only.
- A visitor hostname must not become an alternate route to admin capabilities even if a raw HTTP client manually supplies an admin credential.
- The admin hostname must not become an alternate visitor capability by manually supplying visitor credentials.
- The visitor build must not contain admin/risk/setup/admin-account implementation markers.
- Visitor HTTP and WebSocket payloads contain only fields required by the visitor product.
- High-impact account, policy, risk and global-delete operations remain `SUPER_ADMIN` capabilities.
- Unsupported alternate production entry points fail closed rather than relying on documentation warnings.

The audit prioritizes exploitability and attack prevention over cosmetic information minimization.

## Confirmed attack paths and fixes

### 1. Cross-surface credential replay at shared API paths — fixed

Risk: several message/upload/WebSocket paths are intentionally shared by admin and visitor business logic. Browser host-only cookies normally avoid cross-host delivery, but a raw client holding a stolen credential could manually replay an admin cookie on a visitor hostname (or the reverse). Relying only on browser cookie routing would make host separation weaker than the product security invariant.

Fix:

- The outermost production worker classifies the request hostname before business routing.
- Admin-host requests retain only the admin session cookie.
- Visitor-host requests retain only the guest session cookie.
- `Authorization` is removed at the public-surface boundary.
- Unknown hosts fail closed.
- Invalid production domain configuration fails closed.
- Cloudflare `workers.dev` and preview URLs are disabled for the production Worker.

Result: possession of a credential does not make the opposite public hostname a second protocol entry point for that credential.

### 2. Cookie subdomain widening/fixation risk — fixed

Risk: ordinary cookie names can be accidentally widened with `Domain=` in future code or infrastructure changes, which is particularly dangerous when visitor sessions live on token subdomains.

Fix: browser session cookies use `__Host-` names with `Secure`, `HttpOnly`, `Path=/`, and no `Domain` attribute. Admin, visitor-account, and guest sessions therefore remain host-bound by browser enforcement.

### 3. Visitor bundle could regress toward a mixed admin/visitor frontend — fixed with a build gate

Risk: source-level route checks are insufficient if a future import accidentally puts admin/risk/setup code into the visitor JavaScript bundle.

Fix: the isolated visitor build is inspected during CI. The denylist rejects admin authentication, risk/policy, setup, staff-chat, admin-cookie, operator-management, admin-avatar and backend-storage markers. Visitor HTML must use the `/visitor/` asset namespace and must not expose the admin/PWA discovery surface.

Result: an import regression fails the build instead of silently shipping a mixed frontend.

### 4. Visitor API capability expansion — fixed with an explicit allowlist

Risk: a token hostname that forwards arbitrary `/api/*` paths can become an alternate backend/admin endpoint.

Fix: the visitor public gate accepts only the guest consume endpoint bound to that hostname token, guest avatar, the current conversation message/read endpoints, visitor message creation, visitor upload, authorized attachment download, and the authorized conversation WebSocket. Other API paths return the hardened not-found response.

### 5. One-time invite reuse and stale public entry — fixed

Risk: an already consumed, revoked, expired, or otherwise invalid QR must not remain a usable public document entry.

Fix:

- Initial visitor HTML is served only while the hostname token maps to a live unconsumed invite.
- Consumption is single-use and atomically claimed.
- A consumed token cannot reopen the visitor document.
- The browser removes the bearer token from the visible path after successful consumption.
- Referrer policy is `no-referrer`.
- The admin QR screen receives a non-bearer invite handle for status checks. The raw invite is not persisted to localStorage/sessionStorage.
- Within the current admin SPA, an unconsumed QR remains visible when navigating away and back; it disappears automatically after server state becomes `consumed`, `revoked`, or `expired`.

### 6. Post-upgrade WebSocket authorization becoming stale — fixed

Risk: checking authorization only during WebSocket upgrade lets a disabled operator, revoked admin session, reassigned conversation, or revoked visitor session continue receiving protected broadcasts on an already-open socket.

Fix:

- Cloudflare Durable Object sockets serialize authenticated connection metadata and revalidate current D1 authorization before protected broadcasts.
- Staff-room broadcasts revalidate admin enabled/session state and operator staff-chat capability.
- Conversation broadcasts revalidate current assignment/role or current guest-session ownership.
- Unauthorized live sockets are closed.
- The generic self-host adapter also revalidates socket authorization during heartbeat/broadcast handling.

### 7. Visitor realtime and HTTP payloads carried internal principals — fixed

Risk: backend principal IDs and ownership records are not needed by the visitor product and increase the usable protocol knowledge available to an attacker.

Fix: visitor session/message/presentation JSON is explicitly whitelisted, message `senderId` is removed/null, and guest WebSocket payloads are sanitized separately from admin broadcasts.

This is defense in depth; authorization is still enforced server-side and does not depend on field secrecy.

### 8. Self-host visitor bearer exposed to page JavaScript — fixed

Risk: returning the self-host visitor bearer as `visitorId`, or accepting that browser-visible field as a credential, makes XSS/browser compromise immediately reusable as a session-token theft path.

Fix: the compatibility flow authenticates through the HttpOnly visitor cookie. `visitorId` is not accepted as a browser bearer credential and the raw visitor token is not returned to the page.

### 9. Admin login enumeration/timing differential — hardened

Risk: an unknown/disabled username can otherwise avoid the password KDF and create a measurable account-enumeration signal.

Fix:

- The generic self-host login path evaluates a public dummy scrypt hash for unknown accounts.
- The Cloudflare public gate normalizes failed admin login behavior and enforces a minimum response floor, while the existing IP/account rate limits remain active.

### 10. Cross-site GET with read-state side effects — fixed

Risk: the legacy message-list GET also marks messages read. A top-level/cross-site request could therefore mutate read state despite using GET.

Fix: on the admin public hostname, cross-site/navigation-shaped GETs to the side-effecting message-list route are blocked at the outer production boundary. Ordinary same-site application fetches remain supported.

### 11. Sensitive admin identity changes from an old hijacked session — hardened

Risk: a stolen but still-valid long-lived admin session has disproportionate impact if it can create operators or immediately change/reset credentials.

Fix: sensitive identity mutations at the production boundary require a current authenticated admin session created within the recent-authentication window in addition to the normal authorization and same-origin checks.

### 12. Upload content spoofing and high-cost upload abuse — fixed/hardened

Risk:

- trusting only multipart MIME labels permits file-type spoofing;
- repeated multi-megabyte image uploads are a storage/CPU cost-amplification path.

Fix:

- JPEG/PNG/WebP uploads are checked against file magic in the security gate;
- request and file size limits remain enforced;
- visitor `/api/upload` has an additional production-edge rate limit of 20 uploads per 10 minutes per Cloudflare client IP;
- attachment creation records creator type/id and conversation id;
- image-message creation atomically claims an unbound, unexpired attachment belonging to the same authenticated principal/conversation before binding it to the message;
- failed DB creation rolls back R2 objects and failed message/attachment binding releases the claim.

### 13. Request body size guard could fail open on stream read error — fixed

Risk: an exception while reading a cloned request stream must not turn a size-control failure into an allowed request.

Fix: request-stream size checking now fails closed on read exceptions.

### 14. Generic self-host adapter lacks equivalent public host/bundle isolation — public deployment blocked

Risk: the experimental generic server is not yet an equivalent implementation of the production Cloudflare admin-host/visitor-token-host and separate-bundle security architecture.

Fix/policy: in production mode, non-local public self-host domains are rejected at startup. The old acknowledgement variable cannot bypass this. Local production-mode smoke remains supported for validation.

This surface is therefore not treated as an accepted public alternative until equivalent isolation is implemented and reviewed.

## Authorization decisions that are intentionally unchanged

The following are not UI regressions to be solved by exposing more buttons to ordinary operators:

- create/manage operator accounts;
- risk/security center;
- operator policy changes and credential reset/revoke controls;
- globally clear internal staff-chat history.

They remain `SUPER_ADMIN` only. Screenshots in this audit show the active account role as `客服` (operator), so those controls are expected to be absent for that session. If the human user intends to perform these actions, the correct fix is to sign in with the super-admin identity or correct the account role at the administrative source of truth, not to weaken authorization.

## Product regressions fixed in the same PR

These are not substitutes for the security controls above, but they were reported while validating the post-#47 product and are fixed in the same convergence branch:

- visitor optimistic text and authoritative server acknowledgement now merge by client-message identity even though the public response intentionally omits the internal sender principal; this removes the duplicate “sending/sent” message symptom;
- visitor 404/session-end rendering clears stale operator avatar/welcome presentation during the same layout phase;
- the current operator can click the displayed name and edit/confirm the display name inline without gaining role/policy mutation capability;
- active, unconsumed QR state remains visible when navigating within the current admin SPA and auto-clears after consumption/revocation/expiry without persisting the bearer token to browser storage;
- mobile QR preview contains both editable top and bottom text overlays, aligns them with exported QR coordinates, and constrains the card/actions to the viewport;
- desktop settings secondary navigation and mobile account/menu containers receive final alignment/overflow regression rules.

The internal-message global-clear control and operator/risk management are not restored to ordinary `客服` accounts because doing so would be an authorization regression.

## Validation contract

The final merge gate is the repository Productization validation workflow. Relevant gates include:

- TypeScript typecheck;
- repository unit tests, including visitor/admin host-bound credential contracts, current WebSocket ACLs, QR/mobile navigation contracts, message merge privacy, and request/security guards;
- SQLite integration tests for visitor-token host isolation and one-time invite behavior;
- high-risk business-closure checks;
- production deployment/security checks;
- npm production/full audits;
- separate Vite admin and visitor builds;
- visitor bundle isolation inspection;
- Wrangler production dry-run;
- generic self-host build and local-only smoke/E2E checks.

A PR is not ready to merge while the latest head has a failing validation run.

## Residual/operational considerations

- D1-backed application rate limiting is an application guard, not a substitute for Cloudflare WAF/rate-limiting rules at larger hostile traffic volumes. Production infrastructure should still use Cloudflare-level abuse controls where available.
- The generic self-host adapter remains intentionally blocked from public production exposure; that is a fail-closed policy, not a claim that its public isolation work is complete.
- Real-device browser testing after deployment remains useful for viewport/keyboard/vendor behavior, but a visual mobile issue must not be “fixed” by weakening host, cookie, authorization, or one-time-invite boundaries.

## Audit result

At the repository level, the reportable attack paths found in this post-#47 pass are fixed or fail closed in the PR branch. No known high/critical repository-backed attack path from the reviewed production web surfaces is intentionally left open by this audit. Final acceptance still requires a green Productization validation run on the exact merge head.
