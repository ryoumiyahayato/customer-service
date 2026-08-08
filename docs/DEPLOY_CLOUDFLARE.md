# Cloudflare deployment

This document describes the supported Cloudflare production deployment path.
Production deployment is fail-closed: the Worker must not be promoted unless the
source revision, remote D1 migration state, build, and post-deploy smoke checks
are all known-good.

## Local preflight

Install dependencies and authenticate Wrangler:

```powershell
npm install
npx wrangler login
```

Run the documented non-deploying preflight:

```powershell
npm run deploy:cloudflare
```

This command runs local checks (`doctor`, Cloudflare bootstrap checks,
TypeScript, and build) and exits without invoking a production deployment.

## Production deployment

The authoritative production command is:

```powershell
npm run deploy:safe
```

The compatibility form below delegates to that same guarded implementation
before any local build can dirty tracked `dist/` output:

```powershell
npm run deploy:cloudflare -- --deploy
```

The guarded implementation requires:

1. current branch is `main`;
2. working tree is clean;
3. local `main` exactly matches freshly fetched `origin/main`;
4. remote D1 migration state can be queried successfully;
5. no D1 migration is pending, unless migration application was explicitly requested;
6. repository safety/type/lifecycle checks pass;
7. build succeeds;
8. Wrangler deployment succeeds;
9. generated `dist` changes are restored/cleaned and the repository is clean again;
10. `npm run doctor:online` passes against the deployed service.

A failure in any required check prevents the command from reporting a successful
deployment.

## Pending migrations

Pending D1 migrations block production by default. Review the migration files,
then explicitly request the guarded migration-first deployment:

```powershell
npm run deploy:safe -- --apply-migrations
```

Migration application requires an interactive confirmation. After applying,
the command queries D1 again. The Worker build/deploy does not proceed while a
migration is still pending or while remote migration state cannot be verified.

For the PR #52 architecture transition, production must apply migrations `0012`,
`0013`, and `0014` in repository order if they are still pending. `0013` moves
dynamic operator/session runtime state out of overloaded `settings:*` JSON keys
into structured tables. `0014` creates the operator preset-message/application
tables and migrates any existing configured welcome text into a real first
preset chat message. The Worker that depends on these tables must not be promoted
to production before the migrations are verified as applied.

## Pull requests and non-production Worker versions

A PR/non-`main` branch must not become the production Worker, but it is allowed
to compile and upload a non-production Worker version. In Workers Builds, keep
`main` as the production branch and enable non-production branch builds. The
non-production branch deploy command should be the version-upload path
(`npx wrangler versions upload`, which is also the Cloudflare default), not
`wrangler deploy`.

The repository build guard therefore behaves differently by branch:

- `main`: remote D1 migration state is mandatory and can block production build/deploy;
- non-`main`: build/version upload is allowed, but no production promotion is authorized by the repository gate.

A version upload does not change active production traffic. This project uses a
Durable Object, so Cloudflare's ordinary version Preview URL feature is currently
not available for this Worker. If interactive PR testing is later required,
create an isolated staging design rather than pointing PR traffic at production
D1/R2 merely to obtain a preview URL.

## Secrets

- Do not put Cloudflare tokens in `.bat` files or repository scripts.
- Do not commit `.dev.vars`, `.env.production`, cookies, passwords, or API tokens.
- Store Worker secrets with `npx wrangler secret put` or an appropriate secret manager.
- Prefer Wrangler OAuth for controlled local deployment.
- `templates/deploy.config.example.json` is a placeholder only; never put real credentials in it.

## Resource creation

`npm run bootstrap:cloudflare` is read-only. It checks the expected local
configuration/bindings but does not create D1 databases, R2 buckets, routes, or
secrets. Resource provisioning is a separate operational action from the
guarded application deployment path.
