# Worker Split Plan

This document records the staged split from the current single Worker into an Admin/Core Worker plus a thin Visitor Worker. It is design-only for now: no deploy, migration, binding change, or HMAC implementation is included in phase A.

## Phase A: Current Single Worker

The current Worker remains the only deployed Worker during this phase.

- Keep `support-chat-cloudflare` as the active Worker.
- Keep existing bindings unchanged: `DB`, `UPLOADS`, `CHAT_ROOM`, and `ASSETS`.
- Harden frontend entry routing so the admin hostname root renders the admin app, not the visitor chat.
- Keep temporary visitor testing on `/g/:token`.
- Do not restore unauthenticated `/api/visitor` session creation.

## Phase B: Same Cloudflare Account Split

### Admin/Core Worker

Name:

- Keep `support-chat-cloudflare` as Admin/Core initially.
- Optionally rename later to `support-chat-admin`.

Bindings:

- `DB`
- `UPLOADS`
- `CHAT_ROOM`
- `ASSETS`

Responsibilities:

- Admin page and admin API.
- D1, R2, and Durable Object ownership.
- Conversation permission checks.
- Invite creation and invite consumption authority.
- WebSocket permission checks.
- Upload permission checks.
- Internal service boundary for the Visitor Worker.

### Visitor Worker

Name:

- `support-chat-visitor`

Bindings:

- Future visitor hostname only.
- Service Binding to the Admin/Core Worker.

Responsibilities:

- Visitor entry routing.
- Root path returns a minimal 404/410-style page.
- `/<longToken>` invite entry.
- `/r/<shortCode>` short-link entry.
- `/g/:token` compatibility entry.
- Visitor chat static frontend.
- Thin proxy layer to Core.

Restrictions:

- Do not bind D1 directly.
- Do not bind R2 directly.
- Do not bind Durable Objects directly.
- Browser requests must not receive internal credentials or signing keys.

### Service Binding Boundary

The Visitor Worker should call the Core Worker through a narrow client such as:

- `coreClient.consumeInvite(token)`
- `coreClient.getGuestSession()`
- `coreClient.sendMessage()`
- `coreClient.uploadAttachment()`
- `coreClient.getAttachment()`
- `coreClient.openConversationSocket()`

TODO: WebSocket proxying through the Visitor Worker to the Core Worker or Durable Object must be verified with a real Cloudflare Worker test before treating the design as complete.

## Phase C: Future Cross-Account HMAC

If the Visitor Worker later moves to a different Cloudflare account, Service Binding is no longer available. Use HTTPS with request signing:

`Visitor Account Worker -> HTTPS + HMAC -> Core Worker -> D1/R2/DO`

Signed request fields:

- HTTP method.
- Request path.
- Timestamp.
- Nonce.
- Body hash.
- Key ID.
- HMAC-SHA256 signature.

Rules:

- Signature validity window: 60 seconds.
- Nonce must be stored or otherwise checked to prevent replay.
- HMAC keys live only in Worker secrets.
- Browser code never receives HMAC keys.
- Rotate keys by key ID.

This is intentionally not implemented in phase A.
