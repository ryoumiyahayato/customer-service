export { ChatRoom } from './worker-public-gate';
import worker from './worker-public-gate';
import type { Env } from './worker';
import { COOKIE_NAMES, readCookie } from './security/cookies';
import { consumeRateLimit } from './security/rateLimit';
import { jsonResponse } from './security/responseHeaders';
import {
  DEFAULT_ADMIN_PUBLIC_HOST,
  DEFAULT_VISITOR_ROOT_DOMAIN,
  extractVisitorSubdomainToken,
  isAdminSurfaceHost,
  isLocalDevelopmentHost,
  normalizePublicHost,
} from './domainIsolation';

type WorkerModule = {
  fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
  scheduled?(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void>;
};

type SurfaceEnv = Env & {
  ADMIN_PUBLIC_HOST?: string;
  VISITOR_ROOT_DOMAIN?: string;
  VISITOR_PUBLIC_HOSTS?: string;
};

const inner = worker as WorkerModule;
const INVITE_CONSUME = /^\/api\/guest\/([a-f0-9]{40})$/i;

function adminHost(env: Env) {
  return normalizePublicHost((env as SurfaceEnv).ADMIN_PUBLIC_HOST || DEFAULT_ADMIN_PUBLIC_HOST) || DEFAULT_ADMIN_PUBLIC_HOST;
}

function visitorRoots(env: Env) {
  const configured = String(
    (env as SurfaceEnv).VISITOR_PUBLIC_HOSTS
      || (env as SurfaceEnv).VISITOR_ROOT_DOMAIN
      || DEFAULT_VISITOR_ROOT_DOMAIN,
  );
  return [...new Set(configured.split(',').map(normalizePublicHost).filter(Boolean))];
}

function isVisitorTokenHost(host: string, env: Env) {
  return visitorRoots(env).some(root => Boolean(extractVisitorSubdomainToken(host, root)));
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

async function visitorEntryLimit(req: Request, env: Env) {
  const url = new URL(req.url);
  const method = req.method.toUpperCase();
  if (!((method === 'GET' || method === 'HEAD') && url.pathname === '/')
    && !(method === 'POST' && INVITE_CONSUME.test(url.pathname))) return null;
  const retryAfter = await consumeRateLimit(
    env.DB,
    `surface:visitor-entry:${clientIp(req)}`.slice(0, 240),
    60,
    5 * 60 * 1000,
  );
  return retryAfter === null
    ? null
    : jsonResponse({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(retryAfter) } });
}

export default {
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    await inner.scheduled?.(controller, env, ctx);
  },

  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const host = normalizePublicHost(new URL(req.url).hostname);
    if (isLocalDevelopmentHost(host)) return inner.fetch(req, env, ctx);

    if (isVisitorTokenHost(host, env)) {
      const limited = await visitorEntryLimit(req, env);
      if (limited) return limited;
      // A visitor hostname can authenticate only as the guest session created by its
      // one-time invite. Manually replaying a stolen admin cookie on this host cannot
      // activate any admin branch in shared inner handlers.
      return inner.fetch(requestWithOnlyCookie(req, COOKIE_NAMES.guest), env, ctx);
    }

    if (isAdminSurfaceHost(host, adminHost(env))) {
      // The inverse boundary matters too: a manually supplied guest/visitor cookie
      // must not turn shared API paths on the admin hostname into a visitor surface.
      return inner.fetch(requestWithOnlyCookie(req, COOKIE_NAMES.admin), env, ctx);
    }

    return inner.fetch(req, env, ctx);
  },
};
