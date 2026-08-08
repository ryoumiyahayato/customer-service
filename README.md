# Cloudflare Customer Support Chat

This repository contains the current customer-support system. The Cloudflare path is the authoritative production implementation; `server-generic` remains a separate self-host adapter.

## Production architecture

- **Production boundary:** every Cloudflare request enters through `src/worker-production-boundary.ts`. The remaining Worker layers are compatibility/business/presentation adapters; shared security modules own admin-session resolution, operator capabilities, request-origin validation, password hashing, and domain isolation.
- **Admin frontend:** `AdminDashboard` is the authenticated state owner. `AdminWorkspaceContext` exposes that state to desktop/mobile views. There is no second unread polling subsystem and the affected admin controls do not use full-document `MutationObserver`/Portal glue.
- **Admin styling:** admin patch CSS previously split across `mobileAdminPolish.css`, `adminShellFinal.css`, `adminRegressionFixes.css`, and `adminUnreadBadge.css` is consolidated into `src/admin/adminWorkspace.css`, preserving the established cascade while giving the workspace one structural stylesheet authority.
- **Visitor frontend:** a separate Vite visitor entry imports `src/visitor/visitorApi.ts` directly. The build no longer rewrites `GuestChat` source text to swap API imports.
- **Visitor entry:** the supported public entry is only the root of a valid 40-hex token subdomain on the configured visitor root. The legacy `/g/<token>` path model is not a valid visitor entry; the admin/public gate rejects legacy visitor paths before they can reach inner runtime code.
- **Preset messages:** welcome content is not presentation chrome. Each admin/operator owns an ordered preset message sequence. On the first successful invite consume, the server copies that sequence into the new conversation as ordinary `OPERATOR` text/image messages, with normal D1 history and R2-backed conversation attachments. The old visitor welcome overlay is removed.
- **Realtime:** Durable Objects + WebSocket in `src/durable-objects/ChatRoom.ts`; staff and conversation access is revalidated against current D1 state.
- **Attachments:** R2 bucket `customer-chat-uploads`; metadata and ownership remain in D1.
- **Sessions:** signed HttpOnly cookies backed by D1 `admin_sessions` and `visitor_sessions`.

## State ownership

`settings` is reserved for genuinely generic application configuration. Dynamic identity/security/session state must not be added back as string-prefixed JSON keys.

Migration `0013_structured_runtime_state.sql` moves the previous overloaded runtime state into typed tables:

- `operator_policies`
- `operator_presentations`
- `session_client_metadata`
- `admin_session_metadata`
- `admin_active_sessions`

Migration `0014_operator_preset_messages.sql` adds:

- `operator_preset_messages`
- `operator_preset_applications`

`0014` converts any existing configured welcome text into the first real preset text message. Runtime presentation no longer exposes or renders `welcomeText`; future preset text and images are edited through the dedicated “预设消息” chat-style editor.

Migration `0012_enforce_operator_policy_invariant.sql` first repairs the legacy policy state and makes operator identity stable; `0013` then migrates dynamic runtime state to typed authority and removes migrated `settings:*` keys; `0014` establishes the real preset-message delivery model. Missing operator policy remains fail-closed in runtime code.

## Security boundaries

Production security must remain valid even when an attacker knows the admin hostname, API paths, and implementation details. Hostname secrecy is not an authorization control.

The product therefore relies on:

- strict admin-host / visitor-token-host separation;
- same-origin validation for state-changing admin requests;
- signed, revocable sessions;
- single-active-admin-session enforcement;
- fail-closed operator capabilities;
- D1 ownership/state validation;
- visitor same-origin API allowlisting;
- explicit invite validity/consumption checks;
- deployment and migration gates.

The visitor root domain itself fails closed. Invalid token hosts, multilevel visitor hosts, legacy `/g/` paths, and admin-only APIs on the visitor surface are rejected.

## Feature inventory

- Single-use token-subdomain visitor invitations.
- Admin login with username/password and revocable D1-backed sessions.
- Separate administrator login name and public display name.
- Super-admin operator management, capability control, password reset, and active-login controls.
- Conversation lifecycle, history, unread/read status, remark/customer information, internal staff chat, and image attachments.
- Per-admin/operator preset message editor under “我的”, presented as a one-sided chat board and supporting ordered text plus JPG/PNG/WebP images.
- Preset content becomes real server-authored conversation history on first invite consume; repeated/consumed invite requests cannot duplicate the sequence.
- WebSocket realtime with HTTP synchronization fallback when the admin feed is unavailable.
- Operator capability refresh while logged in; revoked image/staff/invite controls are not offered as usable UI actions.

## Development commands

Use npm for the root project:

```bash
npm run dev
npm run dev:spa
npm run typecheck
npm run test:unit
npm run test:integration
npm run lifecycle:ci-check
npm run build
```

`npm run lifecycle:dry-run` performs a remote read-only D1 operation and is not the routine local/CI validation command.

## Cloudflare resources

D1 database: `customer_chat_db`

R2 bucket: `customer-chat-uploads`

Required secrets include `SESSION_SECRET`, `SUPER_ADMIN_USERNAME`, and `SUPER_ADMIN_PASSWORD`. Do not commit `.dev.vars`, `.env.production`, cookies, Cloudflare credentials, passwords, or secret values.

## Deployment

Production has one authoritative deployment implementation:

```bash
npm run deploy:safe
```

If pending D1 migrations are reported, review them and rerun explicitly:

```bash
npm run deploy:safe -- --apply-migrations
```

`npm run deploy:cloudflare` without arguments is **preflight only** and never deploys. Its explicit deploy form delegates to the same guarded authority:

```bash
npm run deploy:cloudflare -- --deploy
```

The guarded production flow requires a clean local `main` exactly matching `origin/main`, verifies remote D1 migration state, blocks on pending migrations by default, applies migrations only after explicit interactive confirmation, re-verifies migration state, builds, deploys, restores/cleans generated `dist` changes, verifies the working tree, and finally runs `doctor:online`.

Do not use direct `wrangler deploy` / `npx wrangler deploy` for production.

### Pull requests and production

A PR/non-`main` branch is deliberately forbidden from becoming the production Worker. GitHub Productization validation still performs the full build/dry-run/test suite on PR code. If the Cloudflare Git integration attempts to classify a PR commit as a production build, the repository guard rejects it; a red Cloudflare production-deploy status on a PR is therefore expected security behavior, not evidence that the code cannot build.

A live PR preview would require a separately configured staging Worker with separate staging D1/R2 and staging hostnames. Do not point PR preview traffic at production-only state merely to make the Cloudflare production check green.

After PR #52 is merged, production must apply pending migrations `0012`, `0013`, and `0014` in repository order (for whichever of them are not already applied) before the new Worker is deployed. The guarded `--apply-migrations` flow enforces that ordering.

## Self-hosting track

Self-hosting work lives under `server-generic/` and `deploy/linux/` and is separate from the Cloudflare production path. See `docs/PRODUCTIZATION_INDEX.md` for its current status.

## Regression checklist

- Replaced/revoked admin sessions leave the authenticated workspace without manual refresh.
- If `/api/ws/admin` is unavailable, the HTTP fallback continues refreshing sessions/unread state.
- Operator capability changes are refreshed while the operator remains logged in.
- Conversation A messages never appear in Conversation B.
- Customer detail controls close when switching conversation IDs.
- Image upload controls are absent when `canUploadImages` is false.
- Attachments upload to R2, bind to the correct conversation/message, and are readable by the authorized side.
- Visitor source imports only `visitorApi`; no Vite source-string rewrite is required.
- No inner Worker accepts `/g/<token>` as a visitor entry.
- Dynamic operator/session metadata is not written back to `settings:*` prefixes.
- Visitor welcome content is never rendered as a floating overlay; preset text/images are ordinary persisted `OPERATOR` messages.
- Applying a preset sequence is idempotent per conversation and a consumed invite cannot replay it.

## Security and secrets

Do not commit or document secrets, cookies, real passwords, Cloudflare tokens, `.dev.vars`, or `.env.production`.

Administrator creation and credential changes should go through the admin UI or a controlled Worker/D1 operational process. Historical/deprecated deployment paths must not be reintroduced as shortcuts.
