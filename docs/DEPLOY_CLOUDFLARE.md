# Cloudflare Deployment MVP

This is the current deployment flow for the Cloudflare package path. The
recommended wrapper runs the safety checks and build dry-run by default, and it
only performs a real deployment when `--deploy` is explicitly provided.

## Flow

1. Install dependencies:

   ```powershell
   npm install
   ```

2. Authenticate Wrangler locally with OAuth:

   ```powershell
   npx wrangler login
   ```

3. Run the local preflight and build dry-run:

   ```powershell
   npm run deploy:cloudflare
   ```

   Default mode does not deploy. It runs:

   - `npm run doctor`
   - `npm run bootstrap:cloudflare`
   - `npm run typecheck`
   - `npm run build`

4. Deploy only after reviewing the preflight result:

   ```powershell
   npm run deploy:cloudflare -- --deploy
   ```

   Deploy mode runs the same preflight, then:

   - `npx wrangler deploy`
   - `npm run doctor:online`

## Secrets

- Do not put Cloudflare tokens in `.bat` files.
- Do not commit `.dev.vars`.
- Do not commit `.env.production`.
- Store Worker secrets with `npx wrangler secret put`.
- Prefer `npx wrangler login` OAuth for local deployment.
- CI/CD should inject Cloudflare credentials from its secret manager.
- Do not design CI/CD around checked-in scripts that contain tokens; CI/CD
  should be designed separately after the local deployment path is stable.
- `templates/deploy.config.example.json` is only a placeholder template. Do not
  put real tokens, cookies, passwords, or secret values in it.

## Current Scope

`npm run bootstrap:cloudflare` is read-only. `npm run deploy:cloudflare` wraps
the deployment flow, but it does not create D1 databases, R2 buckets, routes, or
secrets, and it does not run migrations. Automatic resource creation belongs to
a later setup phase.
