# Security Baseline

This project is being prepared as a distributable support-chat package. The
default posture must be safe for local development, Cloudflare deployment, and
future packaged releases.

## Do Not Commit

Never commit the following values or files:

- Cloudflare token, API key, account secret, or bearer credential.
- `SESSION_SECRET`.
- Administrator password or bootstrap password.
- Browser cookie or session token.
- Private key, encryption key, signing key, or certificate private material.
- `.dev.vars`.
- `.env.production`.

Local deployment helper scripts are also treated as private files. Keep
`deploy.bat`, `deploy.local.bat`, and `*.local.bat` out of Git. Use
`templates/deploy.example.bat` only as a placeholder example.

## Recommended Configuration

- Use Wrangler OAuth (`wrangler login`) for local Cloudflare deployment.
- Store Worker runtime secrets with `wrangler secret put` or the Cloudflare
  Dashboard.
- In CI/CD, inject Cloudflare credentials from the platform secret manager.
- For future self-hosted packaging, use Docker secrets or an equivalent secret
  manager instead of committing plaintext `.env` files.
- Keep `.env.example` limited to names, comments, and placeholders.

## Build Artifact Checks

- Run a dist secret scan before packaging or deployment.
- Treat every `VITE_` variable as public because Vite can inline it into client
  assets.
- Do not emit source maps that expose sensitive configuration, server-only
  code paths, or deployment details unless they are protected outside the public
  artifact.
- Do not place secrets in `dist`, static assets, HTML, generated JS, generated
  CSS, or source maps.

## Current Runtime Baseline

The current Cloudflare deployment baseline includes:

- HTTP requests redirect to HTTPS.
- HSTS is set on served responses.
- API and gated responses use `no-store`.
- Host gate fails closed for unexpected hosts.
- Invalid invite links return 404 or 410 without disclosing private state.
- WebSocket 101 responses are not rebuilt by generic header helpers.
- Server logs must not include chat message bodies.

## Handling Exposure

If a real Cloudflare token, session secret, administrator password, cookie, or
similar credential is found in the repository, treat it as exposed. Revoke or
rotate it before continuing release packaging. If the repository was public or
shared externally, evaluate Git history cleanup separately; do not force-push
history as part of routine cleanup without an explicit plan.
