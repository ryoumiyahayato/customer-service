# Doctor MVP Plan

`doctor` is a read-only preflight command for packaging and deployment. It must
not print secret values, cookies, administrator passwords, Cloudflare tokens, or
chat message bodies.

## MVP Implementation Status

The current MVP implements local repository checks in `scripts/doctor.mjs`.
`npm run doctor` runs only local checks by default.

`npm run doctor:online` runs the local checks plus public online smoke tests.
The online checks do not require login, do not use a valid invite, do not read
real chat messages, and do not store or print cookies.

Implemented online checks cover HTTP-to-HTTPS redirects, HSTS, visitor root
fail-closed behavior, invalid invite host 404/410 behavior, unauthenticated
`/api/auth/me`, and unauthenticated `/api/ws/admin` rejection.

Still deferred: valid invite smoke tests, authenticated WebSocket 101 checks,
and D1/R2 write-path checks.

`npm run bootstrap:cloudflare` runs a read-only Cloudflare deployment preflight.
It checks local tool availability, package scripts, required documentation, and
the expected Cloudflare bindings/routes in `wrangler.toml`. It does not create
D1 databases, R2 buckets, routes, or secrets, and it does not deploy.

`npm run deploy:cloudflare` wraps the Cloudflare deployment flow. Its default
mode is a dry-run preflight that runs `doctor`, `bootstrap:cloudflare`,
`typecheck`, and `build`; it does not run `wrangler deploy`. A real deployment
requires `npm run deploy:cloudflare -- --deploy`, which reruns the preflight,
executes `npx wrangler deploy`, and then runs `doctor:online`.

Future setup phases may add guided resource creation for D1, R2, routes, and
secrets, migration readiness checks, and CI/CD workflows after the read-only
preflight and local deploy wrapper are stable.

## A. Local Repository Checks

1. `git.status.clean`
   - Check whether the working tree is clean, or whether only approved local
     files are dirty for the current operation.
2. `git.env.tracked`
   - Check whether `.dev.vars`, `.env`, or `.env.production` are tracked by Git.
3. `dist.secret_scan`
   - Scan built assets for secret-like keywords and high-risk token patterns.
4. `local_scripts.tracked`
   - Check whether `deploy.bat`, `deploy.local.bat`, or `*.local.bat` are
     tracked.
5. `wrangler.secret_scan`
   - Check `wrangler.toml` for real secret-like values. Public bindings,
     database names, bucket names, and route names are allowed.
6. `package.scripts.safe`
   - Check that package scripts do not set plaintext deployment credentials.
7. `dist.sourcemaps`
   - Check whether public source maps are present in `dist`.

## B. Online Transport Checks

These checks run only when a target base URL is provided.

1. `http.redirect_https`
   - HTTP should return 308 to the matching HTTPS URL.
2. `https.hsts`
   - HTTPS responses should include HSTS.
3. `admin.https.ok`
   - The backend/admin HTTPS entry should return the expected public shell or
     login-safe response.
4. `visitor.root.not_found`
   - The visitor root domain should return 404.
5. `invite.invalid.not_found`
   - Invalid token subdomains should return 404 or 410.
6. `auth.me.unauthenticated`
   - `/api/auth/me` without a valid session should return a safe unauthenticated
     response.
7. `ws.admin.unauthenticated`
   - `/api/ws/admin` without a valid session should reject the request.
8. `ws.session.upgrade`
   - A valid authorized conversation WebSocket should return 101.

## C. Resource Checks

1. `binding.d1.exists`
   - Check that the `DB` D1 binding exists.
2. `binding.r2.exists`
   - Check that the `UPLOADS` R2 binding exists.
3. `binding.do.exists`
   - Check that the `CHAT_ROOM` Durable Object binding exists.
4. `config.visitor_root_domain.exists`
   - Check that `VISITOR_ROOT_DOMAIN` is configured.
5. `secret.session_secret.exists`
   - Check that `SESSION_SECRET` exists, without printing the value.

## D. Output Format

Each check returns one structured result:

```json
{
  "code": "dist.secret_scan",
  "status": "pass",
  "severity": "high",
  "message": "No secret-like keywords were found in dist.",
  "suggestion": "Run this check before every deployment artifact is published."
}
```

Allowed statuses:

- `pass`
- `warn`
- `fail`

Severity levels:

- `info`
- `low`
- `medium`
- `high`
- `critical`

`doctor` should exit non-zero for `fail` results at `high` or `critical`
severity. Lower severities may be configurable once the MVP is stable.
