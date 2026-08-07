# Admin risk controls — 2026-08-08

## Scope

This change assumes an ordinary customer-service (`OPERATOR`) account can be stolen and the attacker can inspect every browser request/response available to that operator. The goal is to keep that compromise from turning into broad administrative or database access.

This is an application-layer threat model for the Cloudflare Worker path. It does not claim that a compromised browser can be made harmless: an attacker holding a valid operator session can still perform actions that the operator is legitimately allowed to perform until the session is revoked or expires.

## Server-side boundaries added in this change

### Operator capabilities

Super administrators can independently enable or disable these capabilities for each operator:

- create one-time invite QR codes;
- use internal staff chat;
- upload images to customer conversations.

The checks are enforced by the Worker, not only by the React UI. Disabling staff chat also blocks `/api/ws/staff`, so a client cannot bypass the disabled UI by manually opening the staff WebSocket.

Existing conversation authorization remains in force: an ordinary operator only receives sessions assigned to that operator, and protected conversation WebSocket delivery re-checks current database authorization.

### Raw invite link separation

A super administrator may receive and copy the concrete one-time invite URL.

An ordinary operator creating an invite receives a QR matrix for rendering but not the raw token/URL fields in the API response. This prevents accidental exposure of the concrete link in normal operator UI/network payloads.

This is **not cryptographic secrecy**: anyone who is permitted to generate/receive a usable QR can decode the QR back to its URL. If a stolen operator must not be able to create or use invites at all, the correct control is to disable that operator's invite capability or revoke the account/session.

### Session revocation and password administration

Super administrators can:

- revoke every active backend login session for an operator immediately;
- reset an operator password;
- reset password and revoke existing sessions in the same administrative operation.

When an administrator or operator changes their own password through the profile endpoint, other active sessions for the same account are revoked, keeping the current password-changing session only.

### Visitor network context

The system stores session-scoped network context captured at guest entry:

- derived device/browser label;
- Cloudflare city/region/country approximate location;
- source IP address;
- capture timestamp.

The full IP address is returned only to `SUPER_ADMIN` requests. Ordinary operators receive device and coarse location but not the IP field. Raw User-Agent is not persisted.

This data is operational/security data and should be treated as personal data. It is stored with the existing session metadata record and removed when the associated session is purged.

### Security event logging

Admin login successes and failures are written to `system_logs` with bounded security context (username, source IP, derived device label, approximate location). Passwords, cookies, session tokens and chat message bodies are not written into these security events.

The super-admin risk center exposes a sanitized view of recent security/WARN/ERROR events. Ordinary operators cannot read the risk overview or security-log APIs.

Operator policy changes, password resets and forced session revocations are also security-audited.

## What a stolen operator can and cannot obtain

With a valid stolen operator session, the attacker can still read the conversations assigned to that operator and perform capabilities still granted to that operator. This is unavoidable without removing those permissions or invalidating the session.

The stolen operator session does not grant direct D1/R2 credentials. Database access remains behind Worker endpoints. Existing object authorization limits operators to their assigned conversations and attachments. The new controls additionally keep super-admin risk APIs, other operators' controls, full visitor IP data and raw invite-link responses outside the ordinary operator response surface.

## Incident response path

For a suspected stolen operator account:

1. Open **设置 → 风控与安全** as super administrator.
2. Use **踢出全部登录** for the affected operator.
3. Disable the operator account if the incident is not understood yet.
4. Reset the operator password before re-enabling access.
5. Review recent security logs and the affected operator's last-seen time.
6. Reduce optional capabilities (invite generation, internal staff chat, image upload) to the minimum actually needed.

## Remaining production-security work

The following items are still recommended before treating the service as high-assurance administration software:

1. **MFA / WebAuthn for super administrator.** Password + session-cookie authentication remains the main admin authentication mechanism. A stolen super-admin browser/session is much higher impact than a stolen operator session. WebAuthn/passkeys or TOTP should be the next major authentication feature.
2. **Login/session inventory UI.** The current risk center shows aggregate active sessions and provides forced operator revocation. A full per-device admin session inventory with individual revocation would improve incident response.
3. **Stronger/new-password rehash policy.** Operator password reset in this change uses PBKDF2-HMAC-SHA-256 with 210,000 iterations. Existing stored hashes remain iteration-versioned and compatible, but older create/self-change paths should be benchmarked against Worker CPU limits and moved to the same or stronger cost with login-time rehash.
4. **Security-log retention policy.** Because login security events can contain IP addresses, a documented retention period should be established rather than retaining security logs indefinitely.
5. **Upstream controls.** Cloudflare WAF/bot/rate-limit/DDoS configuration is infrastructure-level and is not replaced by application rate limiting.
6. **Generic-server parity.** `server-generic` has separate deployment/security constraints; these Cloudflare Worker controls must not be assumed to exist automatically on that backend.

## Validation expectation

The PR must pass the repository's full Productization validation, including dependency audits, security/static checks, TypeScript, unit tests, SQLite integration tests, Cloudflare dry run, generic-server checks and local Docker/PostgreSQL smoke before it is considered mergeable.
