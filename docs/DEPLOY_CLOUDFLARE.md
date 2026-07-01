# Cloudflare Deployment MVP

This is the current read-only deployment flow for the Cloudflare package path.
The bootstrap command checks local prerequisites and `wrangler.toml`; it does
not create resources, write secrets, run migrations, or deploy.

## Flow

1. Install dependencies:

   ```powershell
   npm install
   ```

2. Authenticate Wrangler locally with OAuth:

   ```powershell
   npx wrangler login
   ```

3. Run local security checks:

   ```powershell
   npm run doctor
   ```

4. Run Cloudflare preflight:

   ```powershell
   npm run bootstrap:cloudflare
   ```

5. Build and dry-run package output:

   ```powershell
   npm run build
   ```

6. Run public online smoke tests after a deployment is already live:

   ```powershell
   npm run doctor:online
   ```

7. Deploy only after reviewing the previous checks:

   ```powershell
   npx wrangler deploy
   ```

## Secrets

- Do not put Cloudflare tokens in `.bat` files.
- Do not commit `.dev.vars`.
- Do not commit `.env.production`.
- Store Worker secrets with `npx wrangler secret put`.
- CI/CD should inject Cloudflare credentials from its secret manager.
- `templates/deploy.config.example.json` is only a placeholder template. Do not
  put real tokens, cookies, passwords, or secret values in it.

## Current Scope

`npm run bootstrap:cloudflare` is read-only. Automatic D1, R2, route, and secret
creation belongs to a later setup phase.
