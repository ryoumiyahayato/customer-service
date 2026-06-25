import { NextRequest, NextResponse } from 'next/server';


function intEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
const WINDOW_SECONDS = intEnv('API_RATE_LIMIT_WINDOW_SECONDS', 60);
const GLOBAL_LIMIT = intEnv('API_RATE_LIMIT_GLOBAL_MAX', 60);
const AUTH_LIMIT = intEnv('API_RATE_LIMIT_AUTH_MAX', 10);
const FAILURE_LIMIT = intEnv('AUTH_FAILURE_LIMIT', 5);
const SLOWDOWN_LIMIT = intEnv('AUTH_SLOWDOWN_FAILURES', 3);
const BAN_SECONDS = intEnv('AUTH_BAN_SECONDS', 10 * 60);
const MISSING_STORE_STATUS = 503;

function failClosedWhenStoreUnavailable() {
  return process.env.API_SECURITY_FAIL_CLOSED === '1';
}

type StoreResult<T> = { ok: true; value: T } | { ok: false; response: NextResponse };

type RateCheck = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
  reason?: 'rate_limited' | 'banned' | 'auth_failures' | 'store_unavailable';
};

function kvConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

async function redisCommand<T = unknown>(command: unknown[]): Promise<StoreResult<T>> {
  const config = kvConfig();
  if (!config) {
    if (failClosedWhenStoreUnavailable()) {
      return { ok: false, response: NextResponse.json({ error: 'API rate-limit store is not configured' }, { status: MISSING_STORE_STATUS }) };
    }
    return { ok: true, value: null as T };
  }

  try {
    const res = await fetch(`${config.url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([command]),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`KV command failed: ${res.status}`);
    const payload = await res.json() as Array<{ result?: T; error?: string }>;
    if (payload[0]?.error) throw new Error(payload[0].error);
    return { ok: true, value: payload[0]?.result as T };
  } catch {
    if (failClosedWhenStoreUnavailable()) {
      return { ok: false, response: NextResponse.json({ error: 'API rate-limit store is unavailable' }, { status: MISSING_STORE_STATUS }) };
    }
    return { ok: true, value: null as T };
  }
}

async function redisPipeline<T = unknown>(commands: unknown[][]): Promise<StoreResult<T[]>> {
  const config = kvConfig();
  if (!config) {
    if (failClosedWhenStoreUnavailable()) {
      return { ok: false, response: NextResponse.json({ error: 'API rate-limit store is not configured' }, { status: MISSING_STORE_STATUS }) };
    }
    return { ok: true, value: [] as T[] };
  }

  try {
    const res = await fetch(`${config.url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(commands),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`KV pipeline failed: ${res.status}`);
    const payload = await res.json() as Array<{ result?: T; error?: string }>;
    const failed = payload.find(item => item.error);
    if (failed?.error) throw new Error(failed.error);
    return { ok: true, value: payload.map(item => item.result as T) };
  } catch {
    if (failClosedWhenStoreUnavailable()) {
      return { ok: false, response: NextResponse.json({ error: 'API rate-limit store is unavailable' }, { status: MISSING_STORE_STATUS }) };
    }
    return { ok: true, value: [] as T[] };
  }
}

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9:_-]/g, '_').slice(0, 160);
}

export function getClientIp(req: NextRequest | Request) {
  const headers = req.headers;
  const forwardedFor = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwardedFor || headers.get('x-real-ip') || headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() || headers.get('cf-connecting-ip') || 'unknown';
}

export function routeKey(pathname: string) {
  return safeSegment(pathname.replace(/^\/api\//, '').replace(/\/[a-zA-Z0-9_-]{12,}/g, '/:id') || 'root');
}

function isAuthPath(pathname: string) {
  return pathname.startsWith('/api/auth/') || pathname.includes('/login') || pathname.startsWith('/api/account/login');
}

export async function checkApiRequest(req: NextRequest): Promise<StoreResult<RateCheck>> {
  const ip = safeSegment(getClientIp(req));
  const route = routeKey(req.nextUrl.pathname);
  const auth = isAuthPath(req.nextUrl.pathname);
  const limit = auth ? AUTH_LIMIT : GLOBAL_LIMIT;
  const nowWindow = Math.floor(Date.now() / (WINDOW_SECONDS * 1000));
  const countKey = `rl:${ip}:${route}:${nowWindow}`;
  const banKey = `ban:${ip}:${route}`;
  const failKey = `authfail:${ip}:${route}`;
  const commands: unknown[][] = [['GET', banKey], ['INCR', countKey], ['EXPIRE', countKey, WINDOW_SECONDS], ['GET', failKey]];
  const result = await redisPipeline<string | number | null>(commands);
  if (!result.ok) return result;

  if (result.value.length === 0) {
    return { ok: true, value: { allowed: true, limit, remaining: limit, resetSeconds: WINDOW_SECONDS } };
  }

  const banned = result.value[0];
  const count = Number(result.value[1] || 0);
  const failures = Number(result.value[3] || 0);
  if (banned) return { ok: true, value: { allowed: false, limit, remaining: 0, resetSeconds: BAN_SECONDS, reason: 'banned' } };
  if (auth && failures >= FAILURE_LIMIT) return { ok: true, value: { allowed: false, limit, remaining: 0, resetSeconds: BAN_SECONDS, reason: 'auth_failures' } };
  if (count > limit) {
    await redisPipeline([['INCR', `strike:${ip}:${route}`], ['EXPIRE', `strike:${ip}:${route}`, 24 * 60 * 60], ['SET', banKey, '1', 'EX', count > limit * 2 ? BAN_SECONDS : WINDOW_SECONDS]]);
    return { ok: true, value: { allowed: false, limit, remaining: 0, resetSeconds: WINDOW_SECONDS, reason: 'rate_limited' } };
  }
  return { ok: true, value: { allowed: true, limit, remaining: Math.max(0, limit - count), resetSeconds: WINDOW_SECONDS } };
}

export function rateLimitResponse(check: RateCheck) {
  const status = check.reason === 'banned' || check.reason === 'auth_failures' ? 403 : 429;
  const res = NextResponse.json({ error: check.reason || 'rate_limited' }, { status });
  res.headers.set('Retry-After', String(check.resetSeconds));
  res.headers.set('X-RateLimit-Limit', String(check.limit));
  res.headers.set('X-RateLimit-Remaining', String(check.remaining));
  return res;
}

export async function recordAuthFailure(req: NextRequest | Request, route = 'auth') {
  const ip = safeSegment(getClientIp(req));
  const pathRoute = routeKey(new URL(req.url).pathname || route);
  const failKey = `authfail:${ip}:${pathRoute}`;
  const count = await redisPipeline<number>([['INCR', failKey], ['EXPIRE', failKey, BAN_SECONDS]]);
  if (!count.ok) return;
  const failures = Number(count.value[0] || 0);
  if (failures >= FAILURE_LIMIT) await redisCommand(['SET', `ban:${ip}:${pathRoute}`, '1', 'EX', BAN_SECONDS]);
}

export async function recordAuthSuccess(req: NextRequest | Request, route = 'auth') {
  const ip = safeSegment(getClientIp(req));
  const pathRoute = routeKey(new URL(req.url).pathname || route);
  await redisCommand(['DEL', `authfail:${ip}:${pathRoute}`]);
}

export const apiSecurityConfig = { WINDOW_SECONDS, GLOBAL_LIMIT, AUTH_LIMIT, FAILURE_LIMIT, SLOWDOWN_LIMIT, BAN_SECONDS };
