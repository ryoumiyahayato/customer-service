export { ChatRoom } from './worker-public-gate';
import worker from './worker-public-gate';
import type { Env } from './worker';
import { COOKIE_NAMES, readCookie } from './security/cookies';
import { consumeRateLimit } from './security/rateLimit';
import { hmacHex } from './security/signing';
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
  if (site === 'cross-site') return true;
  if (mode === 'navigate') return true;
  if (dest && dest !== 'empty') return true;
  return false;
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
      // The admin hostname accepts only the host-bound admin session. Manually replayed
      // guest/account cookies cannot activate visitor branches in shared inner handlers.
      return inner.fetch(requestWithOnlyCookie(req, COOKIE_NAMES.admin), env, ctx);
    }

    const visitor = visitorContext(host, domains.visitorRoots);
    if (!visitor) return hardenedPlain(404, 'Not found');

    const limited = await visitorEntryLimited(req, env);
    if (limited) return limited;

    const method = req.method.toUpperCase();
    const initialDocument = (method === 'GET' || method === 'HEAD') && url.pathname === '/';
    const visitorAsset = method === 'GET' && url.pathname.startsWith('/visitor/assets/');
    if ((initialDocument || visitorAsset) && !(await liveInvite(env, visitor.token))) {
      return hardenedPlain(404, 'Not found');
    }

    // The visitor hostname can authenticate only as its guest session. A stolen admin
    // cookie replayed by a raw HTTP client is discarded before any shared business route.
    return inner.fetch(requestWithOnlyCookie(req, COOKIE_NAMES.guest), env, ctx);
  },
};
