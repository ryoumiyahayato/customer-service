export { ChatRoom } from './worker';
import worker from './worker';
import type { Env } from './worker';

type WorkerModule = {
  fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
  scheduled?(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void>;
};

const inner = worker as WorkerModule;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const ADMIN_USERNAME_RE = /^[A-Za-z0-9_.@-]{3,64}$/;
const ADMIN_PASSWORD_MIN_LENGTH = 12;
const LOGIN_IP_LIMIT = 20;
const LOGIN_ACCOUNT_LIMIT = 8;
const LOGIN_WINDOW_MS = 5 * 60 * 1000;

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(init.headers || {}),
    },
  });
}

function isLocalDevHost(host: string) {
  let normalized = String(host || '').toLowerCase();
  if (normalized.startsWith('[')) normalized = normalized.slice(1).split(']')[0];
  else if (normalized.indexOf(':') === normalized.lastIndexOf(':') && normalized.includes(':')) normalized = normalized.slice(0, normalized.lastIndexOf(':'));
  return normalized === 'localhost' || normalized.endsWith('.localhost') || normalized === '127.0.0.1' || normalized === '0.0.0.0' || normalized === '::1';
}

function sameOriginUrl(value: string, expectedOrigin: string) {
  try {
    return new URL(value).origin === expectedOrigin;
  } catch {
    return false;
  }
}

function isSameOriginWrite(req: Request) {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return true;

  const url = new URL(req.url);
  const origin = req.headers.get('origin');
  if (origin) return sameOriginUrl(origin, url.origin);

  const referer = req.headers.get('referer');
  if (referer) return sameOriginUrl(referer, url.origin);

  const requestHost = req.headers.get('host') || url.host;
  return isLocalDevHost(url.hostname) || isLocalDevHost(requestHost);
}

function shouldProtectAgainstCsrf(req: Request) {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return false;
  const path = new URL(req.url).pathname;
  return path.startsWith('/api/') && !path.startsWith('/api/ws');
}

async function readJsonClone(req: Request) {
  return await req.clone().json().catch(() => ({} as any));
}

function validAdminUsername(username: string) {
  return ADMIN_USERNAME_RE.test(username);
}

function validAdminPassword(password: string) {
  return typeof password === 'string' && password.length >= ADMIN_PASSWORD_MIN_LENGTH;
}

function invalidAdminInput(message: string) {
  return json({ error: message }, { status: 400 });
}

function clientIp(req: Request) {
  return (req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown').trim().slice(0, 120);
}

function rateLimitKey(value: string) {
  return value.replace(/[^A-Za-z0-9:._-]/g, '_').slice(0, 240);
}

async function consumeLimit(env: Env, key: string, limit: number, windowMs: number) {
  const nowMs = Date.now();
  const row = await env.DB.prepare('SELECT count,reset_at FROM rate_limits WHERE key=?').bind(key).first<{ count: number; reset_at: number }>();
  if (!row || row.reset_at < nowMs) {
    await env.DB.prepare('INSERT OR REPLACE INTO rate_limits(key,count,reset_at) VALUES(?,?,?)').bind(key, 1, nowMs + windowMs).run();
    return null;
  }
  if (Number(row.count || 0) >= limit) {
    const retryAfter = Math.max(1, Math.ceil((Number(row.reset_at || nowMs) - nowMs) / 1000));
    return json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(retryAfter) } });
  }
  await env.DB.prepare('UPDATE rate_limits SET count=count+1 WHERE key=?').bind(key).run();
  return null;
}

async function protectLogin(req: Request, env: Env) {
  const path = new URL(req.url).pathname;
  if (req.method !== 'POST' || !['/api/auth/login', '/api/login', '/api/account/login'].includes(path)) return null;

  const body: any = await readJsonClone(req);
  const username = String(body.username || '').trim().toLowerCase().slice(0, 80);
  const ipLimited = await consumeLimit(env, rateLimitKey(`login:ip:${clientIp(req)}:${path}`), LOGIN_IP_LIMIT, LOGIN_WINDOW_MS);
  if (ipLimited) return ipLimited;
  if (username) {
    const accountLimited = await consumeLimit(env, rateLimitKey(`login:account:${path}:${username}`), LOGIN_ACCOUNT_LIMIT, LOGIN_WINDOW_MS);
    if (accountLimited) return accountLimited;
  }
  return null;
}

async function protectAdminMutation(req: Request) {
  const path = new URL(req.url).pathname;
  if (path === '/api/admins' && req.method === 'POST') {
    const body: any = await readJsonClone(req);
    const username = String(body.username || '').trim();
    const password = typeof body.password === 'string' ? body.password : '';
    if (!validAdminUsername(username)) return invalidAdminInput('管理员用户名必须为 3-64 位字母、数字、下划线、点、@ 或 -');
    if (!validAdminPassword(password)) return invalidAdminInput(`管理员密码至少需要 ${ADMIN_PASSWORD_MIN_LENGTH} 位`);
  }

  if (path === '/api/admins/profile' && req.method === 'PATCH') {
    const body: any = await readJsonClone(req);
    const username = String(body.username || '').trim();
    const password = typeof body.password === 'string' ? body.password : '';
    if (username && !validAdminUsername(username)) return invalidAdminInput('管理员用户名必须为 3-64 位字母、数字、下划线、点、@ 或 -');
    if (password && !validAdminPassword(password)) return invalidAdminInput(`管理员密码至少需要 ${ADMIN_PASSWORD_MIN_LENGTH} 位`);
  }

  return null;
}

async function preflightSecurity(req: Request, env: Env) {
  if (shouldProtectAgainstCsrf(req) && !isSameOriginWrite(req)) {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  const loginLimited = await protectLogin(req, env);
  if (loginLimited) return loginLimited;

  const adminRejected = await protectAdminMutation(req);
  if (adminRejected) return adminRejected;

  return null;
}

export default {
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    return inner.scheduled?.(controller, env, ctx);
  },

  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const blocked = await preflightSecurity(req, env);
    if (blocked) return blocked;
    return inner.fetch(req, env, ctx);
  },
};
