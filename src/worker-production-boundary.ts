export { ChatRoom } from './worker-public-gate';
import worker from './worker-public-gate';
import type { Env } from './worker';
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

function hardenedPlain(status: number, body: string) {
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
      return inner.fetch(req, env, ctx);
    }

    const visitor = visitorContext(host, domains.visitorRoots);
    if (!visitor) return hardenedPlain(404, 'Not found');

    const method = req.method.toUpperCase();
    const initialDocument = (method === 'GET' || method === 'HEAD') && url.pathname === '/';
    const visitorAsset = method === 'GET' && url.pathname.startsWith('/visitor/assets/');
    if ((initialDocument || visitorAsset) && !(await liveInvite(env, visitor.token))) {
      return hardenedPlain(404, 'Not found');
    }

    return inner.fetch(req, env, ctx);
  },
};
