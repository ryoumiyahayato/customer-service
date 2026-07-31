import { COOKIE_NAMES, readCookie } from '../security/cookies';
import { verifySignedValue } from '../security/signing';
import { hashSessionToken } from '../security/sessionTokens';
import { jsonResponse } from '../security/responseHeaders';
import type { SqlDatabase } from '../repositories/sessionRepository';

type RequestPolicyEnv = {
  DB: SqlDatabase;
  SESSION_SECRET: string;
};

type WorkerModule<Env extends RequestPolicyEnv> = {
  fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
  scheduled?: (
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) => Promise<void> | void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

async function requestBody(req: Request) {
  return isRecord(await req.clone().json().catch(() => null))
    ? await req.clone().json().catch(() => ({})) as Record<string, unknown>
    : {};
}

function errorResponse(error: string, status: number) {
  return jsonResponse({ error }, { status });
}

function passwordPolicyFailure(path: string, method: string, body: Record<string, unknown>) {
  const createsOperator = path === '/api/admins' && method === 'POST';
  const changesAdminPassword = path === '/api/admins/profile'
    && method === 'PATCH'
    && typeof body.password === 'string'
    && body.password.length > 0;
  if (!createsOperator && !changesAdminPassword) return null;
  return typeof body.password === 'string' && body.password.length >= 12
    ? null
    : errorResponse('password_too_short', 400);
}

async function currentGuestVisitorKey(env: RequestPolicyEnv, req: Request) {
  const signed = readCookie(req, COOKIE_NAMES.guest);
  const sessionId = await verifySignedValue(env.SESSION_SECRET, signed);
  if (!sessionId) return null;
  const row = await env.DB.prepare(
    `SELECT visitor_key FROM visitor_sessions
      WHERE id=?
        AND token_hash=?
        AND revoked_at IS NULL
        AND datetime(expires_at)>datetime('now')
        AND visitor_key IS NOT NULL
      LIMIT 1`,
  ).bind(sessionId, await hashSessionToken(env.SESSION_SECRET, sessionId))
    .first<{ visitor_key: string }>();
  return row?.visitor_key || null;
}

async function visitorRegistrationFailure(
  env: RequestPolicyEnv,
  req: Request,
  path: string,
  method: string,
  body: Record<string, unknown>,
) {
  if (path !== '/api/account/register' || method !== 'POST') return null;
  const claimGuest = Boolean(body.claimGuest);
  const discardGuest = Boolean(body.discardGuest);
  if (claimGuest && discardGuest) return errorResponse('guest_action_conflict', 400);

  const visitorId = typeof body.visitorId === 'string' ? body.visitorId.trim() : '';
  if ((claimGuest || discardGuest) && !visitorId) {
    return errorResponse('guest_identity_required', 400);
  }
  if (!visitorId) return null;

  const currentVisitorKey = await currentGuestVisitorKey(env, req);
  return currentVisitorKey === visitorId
    ? null
    : errorResponse('guest_identity_mismatch', 403);
}

export function createRequestPolicyGuard<Env extends RequestPolicyEnv>(
  inner: WorkerModule<Env>,
): WorkerModule<Env> {
  return {
    scheduled(controller, env, ctx) {
      return inner.scheduled?.(controller, env, ctx);
    },
    async fetch(req, env, ctx) {
      const path = new URL(req.url).pathname;
      const requiresBodyPolicy = (
        (path === '/api/admins' && req.method === 'POST')
        || (path === '/api/admins/profile' && req.method === 'PATCH')
        || (path === '/api/account/register' && req.method === 'POST')
      );
      if (!requiresBodyPolicy) return inner.fetch(req, env, ctx);

      const body = await requestBody(req);
      const passwordFailure = passwordPolicyFailure(path, req.method, body);
      if (passwordFailure) return passwordFailure;
      const visitorFailure = await visitorRegistrationFailure(
        env,
        req,
        path,
        req.method,
        body,
      );
      return visitorFailure || inner.fetch(req, env, ctx);
    },
  };
}
