# Self Hosting Architecture Plan

This document describes the long-term packaging and deployment direction. It is
an architecture plan only. It does not implement adapters, Docker, setup flows,
migrations, schema changes, or deployment automation.

## Goals

- Keep the current Cloudflare deployment path safe and reliable.
- Evolve toward a packaged system that can run on Cloudflare, Docker/VPS, and
  later multi-cloud deployments.
- Avoid a one-time rewrite. Each phase should preserve current behavior before
  adding a new runtime target.
- Keep security controls equivalent or stronger across every platform.

## Deployment Shapes

### 1. Cloudflare Edition

The Cloudflare edition is the current implemented deployment target.

- Runtime: Cloudflare Worker.
- Database: D1.
- Object storage: R2.
- Realtime: Durable Object WebSocket.
- Static assets: Cloudflare Assets.
- Tooling: Wrangler.
- Routing: routes and custom domains configured through Cloudflare.

The current commands are:

- `npm run doctor`
- `npm run doctor:online`
- `npm run bootstrap:cloudflare`
- `npm run deploy:cloudflare`

`npm run deploy:cloudflare` defaults to preflight and build dry-run. A real
deployment requires `npm run deploy:cloudflare -- --deploy`.

### 2. Docker / VPS Edition

The Docker/VPS edition is a future target and is not implemented yet.

- Runtime: Node.js server.
- Database: SQLite for single-node deployments, or Postgres when durability,
  concurrency, and operational tooling are required.
- Object storage: local filesystem for single-node deployments, or
  S3-compatible storage for externalized files.
- Realtime: Node WebSocket.
- Maintenance: cron or systemd timer.
- HTTPS: Caddy, Nginx, or Traefik terminates TLS and enforces HTTPS.

This edition should be treated as a separate runtime target, not a partial copy
of Worker-specific code.

### 3. Multi-Cloud Adapter Edition

The multi-cloud edition is the long-term abstraction target. It should be
introduced only after the Cloudflare behavior has been wrapped behind stable
interfaces.

- Database adapter.
- Object storage adapter.
- Realtime adapter.
- Scheduler adapter.
- Config adapter.
- Deployment adapter.

The purpose is to isolate platform services without weakening the security
model or changing user-visible behavior.

## Adapter Layers

### DatabaseAdapter

Targets:

- Cloudflare: D1.
- VPS: SQLite or Postgres.
- Multi-instance: Postgres.

Responsibilities:

- `admins`
- `sessions`
- `invites`
- `messages`
- `staff_messages`
- attachment metadata
- `settings`
- cleanup queries

The first implementation should only wrap existing D1 access. Postgres support
should not be added until the D1 wrapper is behavior-equivalent and covered by
checks.

### ObjectStorageAdapter

Targets:

- Cloudflare: R2.
- VPS: local filesystem.
- Multi-cloud: S3-compatible storage.

Responsibilities:

- upload
- download
- delete
- metadata
- cleanup
- size limits
- content-type checks

The adapter must not trust client-provided metadata. Server-side validation must
remain the authority for upload size, allowed content types, and storage keys.

### RealtimeAdapter

Targets:

- Cloudflare: Durable Object WebSocket.
- VPS: Node WebSocket.
- Multi-instance: Redis pub/sub.

Responsibilities:

- room ownership
- broadcast
- heartbeat
- reconnect
- fallback signal

The fallback path must not grant extra access. If WebSocket fails, the fallback
may preserve availability, but authorization must still be enforced by the
server.

### SchedulerAdapter

Targets:

- Cloudflare: Scheduled Trigger.
- VPS: cron or systemd timer.

Responsibilities:

- expired invite cleanup
- old message cleanup
- attachment cleanup

Cleanup output must report counts and status only. It must not print message
bodies, attachment contents, invite tokens, cookies, or secrets.

### ConfigAdapter

Targets:

- Cloudflare: environment bindings and Worker secrets.
- VPS: `.env` files and Docker secrets.
- Multi-cloud: provider secret manager.

Responsibilities:

- read configuration
- check missing required values
- mark secret values
- prevent secrets from entering frontend assets or `dist`

The adapter should distinguish public config from secret config. Public values
may be embedded into the frontend only when explicitly classified as public.

### DeploymentAdapter

Targets:

- Cloudflare: Wrangler.
- VPS: Docker Compose or systemd.
- Multi-cloud: provider CLI.

Responsibilities:

- preflight
- build
- deploy
- doctor
- rollback metadata

Deployment adapters must be safe by default. Real deployment should require an
explicit flag or command, and preflight failures must stop the deploy path.

## Migration Order

Do not rewrite everything at once. The recommended path is incremental.

### P1: Continue Cloudflare Packaging

- Improve `doctor`.
- Improve `bootstrap:cloudflare`.
- Improve the deploy wrapper.
- Add a setup initialization guide later.
- Add cleanup tasks later.
- Keep documentation current.

### P2: Extract ConfigAdapter

- Centralize backend domain, visitor root domain, and public variables.
- Preserve current runtime behavior.
- Do not change host-gate behavior while extracting configuration.

### P3: Extract DatabaseAdapter

- First wrap only D1.
- Keep Cloudflare behavior equivalent.
- Do not immediately add Postgres.

### P4: Extract ObjectStorageAdapter

- First wrap only R2.
- Add local filesystem and S3-compatible storage later.

### P5: Extract RealtimeAdapter

- First wrap Durable Object WebSocket.
- Add Node WebSocket and Redis later.

### P6: Docker/VPS Prototype

- Node server.
- SQLite.
- Local uploads.
- Node WebSocket.
- Caddy for HTTPS.

This prototype should prove the runtime shape before adding production-grade
Postgres, S3-compatible storage, or Redis.

### P7: Multi-Cloud Edition

- Postgres.
- S3-compatible storage.
- Redis.
- Provider-specific config and deployment integration.

## Target Package Structure

```text
scripts/
  doctor.mjs
  bootstrap-cloudflare.mjs
  deploy-cloudflare.mjs
  bootstrap-docker.mjs
  deploy-docker.mjs
  cleanup-expired.mjs
  check-dist-secrets.mjs

templates/
  deploy.config.example.json
  wrangler.toml.template
  .env.example
  docker-compose.yml
  Caddyfile.example
  nginx.conf.example

docs/
  DEPLOY_CLOUDFLARE.md
  DEPLOY_DOCKER.md
  SELF_HOSTING_PLAN.md
  SECURITY_BASELINE.md
  DOCTOR_PLAN.md
  DATA_RETENTION.md
  ENCRYPTION_AT_REST.md
  TROUBLESHOOTING.md
```

These files are target structure, not current implementation status. Docker and
multi-cloud files should not be presented as usable until their runtime paths
exist and pass preflight checks.

## Security Non-Regression Rules

Every deployment target must preserve these rules:

1. HTTPS is enforced by default on every platform.
2. HSTS is enabled by default on every platform.
3. Cookies default to `Secure`, `HttpOnly`, and `SameSite`.
4. Host gate must fail closed.
5. Invalid invites must return `404` or `410`.
6. Secrets must never be placed in frontend code.
7. Message bodies must not be logged.
8. `dist` must pass a secret scan before publishing.
9. Local configuration must use example templates.
10. Production secrets must be injected through a secret manager, Docker
    secrets, or Worker secrets.
11. WebSocket failures must have a fallback, but fallback must not bypass
    authorization.
12. Data cleanup tasks must output counts only, not message bodies.

## Anti-Unpacking Boundary

Self-hosting can raise misuse cost, but it cannot provide absolute protection
against a server owner.

1. Frontend JavaScript cannot truly prevent unpacking. It can only be minified,
   obfuscated, shipped without source maps, and watermarked.
2. Self-hosting and strong anti-unpacking are naturally in tension.
3. The server owner can theoretically inspect deployed files.
4. Docker images can also be reverse engineered.
5. Strong protection requires a SaaS control plane or a licensing service.
6. The current target is to increase copying and misuse cost, not to promise
   absolute crack resistance.
7. Core security logic must live on the backend.
8. Secrets must never enter the frontend.

## Deferred Work

- Docker implementation.
- Adapter implementation.
- Setup wizard.
- Resource auto-creation.
- Migration checks.
- CI/CD deployment flow.
- Message encryption.
- Automatic deletion policies beyond explicitly reviewed cleanup tasks.
