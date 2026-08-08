export { ChatRoom } from './worker-public-gate';
import worker from './worker-public-gate';
import type { Env } from './worker';
import { COOKIE_NAMES, readCookie } from './security/cookies';
import { consumeRateLimit } from './security/rateLimit';
import { readJsonObjectWithinLimit } from './security/requestLimits';
import { hmacHex, verifySignedValue } from './security/signing';
import { hashSessionToken } from './security/sessionTokens';
import {
  DEFAULT_ADMIN_PUBLIC_HOST,
  DEFAULT_VISITOR_ROOT_DOMAIN,
  extractVisitorSubdomainToken,
  isLocalDevelopmentHost,
  normalizePublicHost,
} from './domainIsolation';

type WorkerModule = {
  fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
  scheduled?(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void>;
};

type ProductionEnv = Env & {
  VISITOR_ROOT_DOMAIN?: string;
  VISITOR_PUBLIC_HOSTS?: string;
  ADMIN_PUBLIC_HOST?: string;
};

type InviteEntryRow = {
  expires_at: string;
  revoked_at: string | null;
  consumed_at: string | null;
};

const inner = worker as WorkerModule;
const ADMIN_MESSAGE_READ = /^\/api\/sessions\/[^/]+\/messages$/;
const INVITE_CONSUME = /^\/api\/guest\/[a-f0-9]{40}$/i;
const OPERATOR_PASSWORD_RESET = /^\/api\/admin\/operators\/[^/]+\/reset-password$/;
const SENSITIVE_PROFILE_MAX_BYTES = 16 * 1024;

function hardenedPlain(status: number, body: string, extraHeaders: Record<string, string> = {}) {
  return new Response(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
      ...extraHeaders,
    },
  });
}

function hardenedJson(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
    },
  });
}

function rawHost(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function exactConfiguredHost(value: unknown) {
  const raw = rawHost(value);
  return Boolean(raw && raw === normalizePublicHost(raw));
}

function productionDomains(env: Env) {
  const source = env as ProductionEnv;
  const visitorRootRaw = rawHost(source.VISITOR_ROOT_DOMAIN);
  const adminRaw = rawHost(source.ADMIN_PUBLIC_HOST);
  if (!exactConfiguredHost(visitorRootRaw) || !exactConfiguredHost(adminRaw)) return null;
  if (visitorRootRaw === adminRaw) return null;

  const visitorRoots = rawHost(source.VISITOR_PUBLIC_HOSTS || visitorRootRaw)
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  if (!visitorRoots.length || visitorRoots.some(value => !exactConfiguredHost(value))) return null;
  if (!visitorRoots.includes(visitorRootRaw)) return null;
  if (visitorRoots.includes(adminRaw)) return null;

  return {
    admin: adminRaw || DEFAULT_ADMIN_PUBLIC_HOST,
    visitorRoot: visitorRootRaw || DEFAULT_VISITOR_ROOT_DOMAIN,
    visitorRoots: [...new Set(visitorRoots)],
  };
}

function visitorContext(host: string, roots: string[]) {
  for (const root of roots) {
    const token = extractVisitorSubdomainToken(host, root);
    if (token) return { token, root };
  }
  return null;
}

function requestWithOnlyCookie(req: Request, cookieName: string) {
  const headers = new Headers(req.headers);
  const value = readCookie(req, cookieName);
  if (value) headers.set('cookie', `${cookieName}=${value}`);
  else headers.delete('cookie');
  headers.delete('authorization');
  return new Request(req, { headers });
}

function clientIp(req: Request) {
  return String(req.headers.get('cf-connecting-ip') || 'unknown').trim().slice(0, 80);
}

async function visitorEntryLimited(req: Request, env: Env) {
  const url = new URL(req.url);
  const method = req.method.toUpperCase();
  const entry = (method === 'GET' || method === 'HEAD') && url.pathname === '/';
  const consume = method === 'POST' && INVITE_CONSUME.test(url.pathname);
  if (!entry && !consume) return null;
  const retryAfter = await consumeRateLimit(
    env.DB,
    `surface:visitor-entry:${clientIp(req)}`.slice(0, 240),
    60,
    5 * 60 * 1000,
  );
  return retryAfter === null
    ? null
    : hardenedPlain(429, 'Too many requests', { 'Retry-After': String(retryAfter) });
}

async function visitorUploadLimited(req: Request, env: Env) {
  const url = new URL(req.url);
  if (req.method.toUpperCase() !== 'POST' || url.pathname !== '/api/upload') return null;
  const retryAfter = await consumeRateLimit(
    env.DB,
    `surface:visitor-upload:${clientIp(req)}`.slice(0, 240),
    20,
    10 * 60 * 1000,
  );
  return retryAfter === null
    ? null
    : hardenedPlain(429, 'Too many requests', { 'Retry-After': String(retryAfter) });
}

async function liveInvite(env: Env, token: string) {
  const tokenHash = await hmacHex(env.SESSION_SECRET, `invite:${token.toLowerCase()}`);
  const row = await env.DB.prepare(
    `SELECT expires_at,revoked_at,consumed_at
       FROM invite_links
      WHERE token_hash=?
      LIMIT 1`,
  ).bind(tokenHash).first<InviteEntryRow>();
  if (!row || row.revoked_at || row.consumed_at) return false;
  return row.expires_at > new Date().toISOString();
}

function crossSiteReadMutation(req: Request) {
  if (req.method.toUpperCase() !== 'GET') return false;
  if (!ADMIN_MESSAGE_READ.test(new URL(req.url).pathname)) return false;
  const site = String(req.headers.get('sec-fetch-site') || '').toLowerCase();
  const mode = String(req.headers.get('sec-fetch-mode') || '').toLowerCase();
  const dest = String(req.headers.get('sec-fetch-dest') || '').toLowerCase();
  if (site && site !== 'same-origin') return true;
  if (mode === 'navigate') return true;
  if (dest && dest !== 'empty') return true;
  return false;
}

async function sensitiveIdentityMutation(req: Request) {
  const url = new URL(req.url);
  const method = req.method.toUpperCase();
  if (method === 'POST' && url.pathname === '/api/admins') return true;
  if (method === 'POST' && OPERATOR_PASSWORD_RESET.test(url.pathname)) return true;
  if (method !== 'PATCH' || url.pathname !== '/api/admins/profile') return false;

  const { body, tooLarge } = await readJsonObjectWithinLimit(req, SENSITIVE_PROFILE_MAX_BYTES);
  if (tooLarge) return false; // the inner request-size boundary returns 413 without parsing it as a profile change
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  return Boolean(username || password);
}

async function recentAdminSession(env: Env, req: Request) {
  const signed = readCookie(req, COOKIE_NAMES.admin);
  const sessionId = await verifySignedValue(env.SESSION_SECRET, signed);
  if (!sessionId) return false;
  const tokenHash = await hashSessionToken(env.SESSION_SECRET, sessionId);
  const row = await env.DB.prepare(
    `SELECT s.id
       FROM admin_sessions s
       JOIN admins a ON a.id=s.admin_id
      WHERE s.id=? AND s.token_hash=? AND s.revoked_at IS NULL
        AND datetime(s.expires_at)>datetime('now')
        AND datetime(s.created_at)>datetime('now','-10 minutes')
        AND COALESCE(a.is_disabled,0)=0
      LIMIT 1`,
  ).bind(sessionId, tokenHash).first<{ id: string }>();
  return Boolean(row?.id);
}

export default {
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    await inner.scheduled?.(controller, env, ctx);
  },

  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(req.url);
    const host = normalizePublicHost(url.hostname);
    if (isLocalDevelopmentHost(host)) return inner.fetch(req, env, ctx);

    const domains = productionDomains(env);
    if (!domains) return hardenedPlain(503, 'Service unavailable');

    if (host === domains.admin) {
      if (crossSiteReadMutation(req)) return hardenedPlain(403, 'Forbidden');
      if (await sensitiveIdentityMutation(req) && !(await recentAdminSession(env, req))) {
        return hardenedJson(403, { error: 'reauthentication_required' });
      }
      // The admin hostname accepts only the host-bound admin session. Manually replayed
      // guest/account cookies and Authorization headers cannot activate visitor branches.
      return inner.fetch(requestWithOnlyCookie(req, COOKIE_NAMES.admin), env, ctx);
    }

    const visitor = visitorContext(host, domains.visitorRoots);
    if (!visitor) return hardenedPlain(404, 'Not found');

    const entryLimit = await visitorEntryLimited(req, env);
    if (entryLimit) return entryLimit;
    const uploadLimit = await visitorUploadLimited(req, env);
    if (uploadLimit) return uploadLimit;

    const method = req.method.toUpperCase();
    const initialDocument = (method === 'GET' || method === 'HEAD') && url.pathname === '/';
    const visitorAsset = method === 'GET' && url.pathname.startsWith('/visitor/assets/');
    if ((initialDocument || visitorAsset) && !(await liveInvite(env, visitor.token))) {
      return hardenedPlain(404, 'Not found');
    }

    // The visitor hostname can authenticate only as its guest session. A stolen admin
    // cookie or Authorization credential replayed by a raw HTTP client is discarded.
    return inner.fetch(requestWithOnlyCookie(req, COOKIE_NAMES.guest), env, ctx);
  },
};
