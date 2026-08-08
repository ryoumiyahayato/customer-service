# Doctor plan

`doctor` is a read-only repository/deployment diagnostic. It must not print
secret values, cookies, administrator passwords, Cloudflare tokens, invite bearer
tokens, or chat-message bodies.

## Implemented commands

`npm run doctor`

- local repository/configuration checks only;
- does not deploy;
- does not require a valid production invite.

`npm run doctor:online`

- runs the local checks plus public online smoke tests;
- does not authenticate as a real administrator;
- does not consume a valid invite;
- does not read real messages or print cookies.

Current online checks cover HTTPS/HSTS, visitor-root fail-closed behavior,
invalid visitor-token host rejection, unauthenticated `/api/auth/me`, and
unauthenticated admin-WebSocket rejection. Authenticated WebSocket and D1/R2
write-path smoke tests remain separate integration concerns.

`npm run bootstrap:cloudflare`

- read-only Cloudflare configuration/bootstrap preflight;
- checks tools, scripts, documentation, and expected bindings/routes;
- does not create D1/R2 resources, routes, or secrets;
- does not deploy.

## Relationship to deployment

`npm run deploy:cloudflare` without arguments remains preflight-only. It runs
local diagnostics/type/build checks and exits without production deployment.

A real deployment is explicit:

```bash
npm run deploy:cloudflare -- --deploy
```

That compatibility wrapper delegates immediately to the authoritative guarded
implementation before running a local build, so tracked `dist/` output cannot
make the clean-tree guard fail accidentally.

The direct authoritative command is:

```bash
npm run deploy:safe
```

The guarded deploy validates clean/current `main`, remote D1 migration state,
repository checks, build/deploy success, restores generated `dist` changes, and
then runs `npm run doctor:online`. A deployment is not reported successful when
the post-deploy online smoke check fails.

If migrations are pending, normal deployment stops. After reviewing them, use:

```bash
npm run deploy:safe -- --apply-migrations
```

Migration application is interactive and is re-verified before build/deploy.
Failure to query remote migration state is also blocking rather than a warning.

A non-`main` PR is intentionally not a production deployment target. A red
Cloudflare production-build status for a PR can therefore represent the
production branch guard doing its job; GitHub Productization validation is the
PR build/test signal. A live preview must use separately isolated staging state.

## Local repository checks

1. `git.status.clean`
   - working tree is clean for operations that require it.
2. `git.env.tracked`
   - `.dev.vars`, `.env`, and `.env.production` are not tracked.
3. `dist.secret_scan`
   - built assets contain no known secret/token patterns.
4. `local_scripts.tracked`
   - high-risk local credential/deploy helper files are not tracked.
5. `wrangler.secret_scan`
   - `wrangler.toml` does not contain real secret values.
6. `package.scripts.safe`
   - package scripts do not embed plaintext deployment credentials or bypass the guarded production authority.
7. `dist.sourcemaps`
   - public deployment output does not unintentionally publish source maps.

## Online transport checks

1. HTTP redirects to HTTPS as expected.
2. HTTPS includes HSTS.
3. Admin HTTPS entry returns only the expected login/application surface.
4. Visitor root returns 404.
5. Invalid token subdomains return 404/410.
6. Unauthenticated `/api/auth/me` returns a safe unauthenticated response.
7. Unauthenticated `/api/ws/admin` is rejected.
8. Authorized conversation WebSocket behavior is covered separately by integration tests.

## Resource checks

- D1 `DB` binding exists.
- R2 `UPLOADS` binding exists.
- Durable Object `CHAT_ROOM` binding exists.
- `VISITOR_ROOT_DOMAIN` and admin-host configuration are present.
- `SESSION_SECRET` exists without its value being printed.

## Output contract

Each doctor check should return a structured result such as:

```json
{
  "code": "dist.secret_scan",
  "status": "pass",
  "severity": "high",
  "message": "No secret-like patterns were found in dist.",
  "suggestion": "Run this check before publishing deployment artifacts."
}
```

Allowed statuses: `pass`, `warn`, `fail`.

Severity levels: `info`, `low`, `medium`, `high`, `critical`.

`doctor` exits non-zero for high/critical failures. Lower severities may remain
warnings where explicitly designed that way.
