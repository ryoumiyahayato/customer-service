# Cloudflare Migration Audit

## Existing Feature Inventory

- Public visitor chat page: login/register/guest entry, visitor identity in localStorage/cookie, message list, quote replies, image upload, responsive mobile shell.
- Admin login: username/password login through HTTP-only cookie.
- Super admin account: bootstrapped from environment when no super admin exists; can update own username/password.
- Customer service account management: super admin can create, disable, and hard-delete operator accounts.
- Visitor conversation list: grouped by PENDING, OPEN, CLOSED, ARCHIVED, and soft-deleted sessions with unread counts.
- Message sending/receiving: visitor and operator text/image messages with quote_message_id and recall support.
- Message history: persisted messages ordered by created_at.
- Read/unread status: visitor messages are marked read when admin opens a conversation; operator messages are marked read when visitor loads the session.
- Attachments/images: old app wrote uploads to local public/uploads; Cloudflare version stores images in R2 and returns /api/attachments/:key.
- Internal contact/staff chat: staff_messages table and admin staff chat view are preserved.
- Settings pages: no settings UI existed; a settings table is included for future compatibility.
- API routes preserved by path: /api/login, /api/auth/*, /api/account/*, /api/visitor, /api/sessions*, /api/messages*, /api/admins*, /api/staff-chat, /api/upload.

## Existing Database Model

- admins: id, username, password_hash, role, must_change_password, created_at, updated_at, is_disabled, disabled_at, last_seen_at.
- visitor_accounts: id, username, password_hash, display_name, last_login_at, created_at, updated_at.
- users: id, visitor_key, account_id, display_name, last_seen_at, created_at, updated_at.
- sessions: id, user_id, assigned_operator_id, last_operator_id, status, created_at, updated_at, deleted_at, deleted_by.
- messages: id, session_id, sender_type, sender_id, content, message_type, image_path, status, created_at, read_at, is_read, quote_message_id, recalled_at, image_purged_at.
- staff_messages: id, sender_admin_id, content, created_at.
- system_logs: id, level, event, actor_id, message, created_at.

## Existing Environment Variables

- POSTGRES_URL / DATABASE_URL: old Postgres connection. Replaced by D1 binding DB.
- SESSION_SECRET: retained for signed cookies/JWT-like tokens.
- DEFAULT_ADMIN_USERNAME / DEFAULT_ADMIN_PASSWORD / RESET_SUPER_ADMIN_ON_BOOTSTRAP: replaced by SUPER_ADMIN_USERNAME and SUPER_ADMIN_PASSWORD. Empty values never reset an existing admin.
- KV_REST_API_URL / KV_REST_API_TOKEN / UPSTASH_REDIS_REST_* / API_SECURITY_FAIL_CLOSED: Vercel KV rate limiting removed. A D1-backed rate_limits table is used instead.
- VERCEL: removed; uploads no longer depend on Vercel/local filesystem behavior.

## Broken Implementation Details Not Preserved

- SSE /api/events timer loop and 3-4 second polling loops caused flicker and stale state.
- Shared global message arrays could display one conversation's messages inside another conversation.
- Admin state was previously allowed to become null from frontend/transient state before a stable backend session check.
- Local filesystem uploads and Node crypto/Postgres APIs were incompatible with Cloudflare Workers.

## Target Cloudflare Architecture

- React/Vite SPA in src/ served as Cloudflare static assets.
- Worker HTTP API in worker/index.ts.
- Durable Object class ChatRoom handles WebSocket hibernation-compatible rooms.
- Conversation WebSocket room name: conversation:<sessionId>.
- Admin list feed room: admin-feed.
- Staff chat room: staff.
- D1 migration in migrations/0001_init.sql preserves the old content model and adds settings/rate_limits.
- R2 binding UPLOADS stores image files.
