export { ChatRoom } from './worker-public-gate';
import worker from './worker-public-gate';
import type { Env } from './worker';
import { COOKIE_NAMES, clearSessionCookie, readCookie } from './security/cookies';
import { consumeRateLimit } from './security/rateLimit';
import { readJsonObjectWithinLimit } from './security/requestLimits';
import { hmacHex, verifySignedValue } from './security/signing';
import { hashSessionToken } from './security/sessionTokens';
import { clientMetadataFromRequest } from './sessionClientMetadata';
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

type ActiveAdminContext = {
  sessionId: string;
  adminId: string;
  username: string;
  role: 'SUPER_ADMIN' | 'OPERATOR';
};

type ActiveAdminSessionRow = {
  id: string;
  admin_id: string;
  username: string;
  role: 'SUPER_ADMIN' | 'OPERATOR';
  created_at: string;
  last_seen_at: string | null;
  expires_at: string;
};

type SettingsRow = { value_json: string };

const inner = worker as WorkerModule;
const ADMIN_MESSAGE_READ = /^\/api\/sessions\/[^/]+\/messages$/;
const INVITE_CONSUME = /^\/api\/guest\/[a-f0-9]{40}$/i;
const OPERATOR_PASSWORD_RESET = /^\/api\/admin\/operators\/[^/]+\/reset-password$/;
const SENSITIVE_PROFILE_MAX_BYTES = 16 * 1024;
const ACTIVE_ADMIN_SESSION_PREFIX = 'admin_active_session:';
const ADMIN_SESSION_META_PREFIX = 'admin_session_meta:';

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

function hardenedJson(status: number, body: Record<string, unknown>, extraHeaders: Record<string, string> = {}) {
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
  headers.delete('authorization');
  return new Request(req, { headers });
}

function clientIp(req: Request) {
  return String(req.headers.get('cf-connecting-ip') || 'unknown').trim().slice(0, 80);
}

function activeAdminSessionKey(adminId: string) {
  return `${ACTIVE_ADMIN_SESSION_PREFIX}${adminId}`;
}

function adminSessionMetaKey(sessionId: string) {
  return `${ADMIN_SESSION_META_PREFIX}${sessionId}`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function responseCookieValue(response: Response, cookieName: string) {
  const setCookie = response.headers.get('set-cookie') || '';
  const match = setCookie.match(new RegExp(`(?:^|,\\s*)${escapeRegExp(cookieName)}=([^;]+)`));
  return match?.[1]?.trim() || '';
}

async function limitedByIp(req: Request, env: Env, key: string, limit: number, windowMs: number) {
  const retryAfter = await consumeRateLimit(
    env.DB,
    `surface:${key}:${clientIp(req)}`.slice(0, 240),
    limit,
    windowMs,
  );
  return retryAfter === null
    ? null
    : hardenedPlain(429, 'Too many requests', { 'Retry-After': String(retryAfter) });
}

async function adminSetupLimited(req: Request, env: Env) {
  const url = new URL(req.url);
  if (req.method.toUpperCase() === 'GET' || !url.pathname.startsWith('/api/setup/')) return null;
  return limitedByIp(req, env, 'admin-setup', 5, 10 * 60 * 1000);
}

async function visitorEntryLimited(req: Request, env: Env) {
  const url = new URL(req.url);
  const method = req.method.toUpperCase();
  const entry = (method === 'GET' || method === 'HEAD') && url.pathname === '/';
  const consume = method === 'POST' && INVITE_CONSUME.test(url.pathname);
  if (!entry && !consume) return null;
  return limitedByIp(req, env, 'visitor-entry', 60, 5 * 60 * 1000);
}

async function visitorUploadLimited(req: Request, env: Env) {
  const url = new URL(req.url);
  if (req.method.toUpperCase() !== 'POST' || url.pathname !== '/api/upload') return null;
  return limitedByIp(req, env, 'visitor-upload', 20, 10 * 60 * 1000);
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
  if (tooLarge) return false;
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

async function activeAdminContext(env: Env, req: Request): Promise<ActiveAdminContext | null> {
  const signed = readCookie(req, COOKIE_NAMES.admin);
  const sessionId = await verifySignedValue(env.SESSION_SECRET, signed);
  if (!sessionId) return null;
  const tokenHash = await hashSessionToken(env.SESSION_SECRET, sessionId);
  const row = await env.DB.prepare(
    `SELECT s.id session_id,a.id admin_id,a.username,a.role
       FROM admin_sessions s
       JOIN admins a ON a.id=s.admin_id
      WHERE s.id=? AND s.token_hash=? AND s.revoked_at IS NULL
        AND datetime(s.expires_at)>datetime('now')
        AND datetime(s.created_at)>datetime('now','-1 day')
        AND datetime(COALESCE(s.last_seen_at,s.created_at))>datetime('now','-30 minutes')
        AND COALESCE(a.is_disabled,0)=0
      LIMIT 1`,
  ).bind(sessionId, tokenHash).first<{
    session_id: string;
    admin_id: string;
    username: string;
    role: 'SUPER_ADMIN' | 'OPERATOR';
  }>();
  if (!row?.session_id || !row.admin_id) return null;
  return { sessionId: row.session_id, adminId: row.admin_id, username: row.username, role: row.role };
}

async function writeAdminSessionMetadata(env: Env, req: Request, sessionId: string, timestamp = new Date().toISOString()) {
  const metadata = clientMetadataFromRequest(req, timestamp);
  await env.DB.prepare(
    `INSERT INTO settings(key,value_json,updated_at) VALUES(?,?,?)
      ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`,
  ).bind(adminSessionMetaKey(sessionId), JSON.stringify(metadata), timestamp).run();
}

async function activateLoginSession(req: Request, env: Env, response: Response) {
  if (!response.ok) return response;
  const signed = responseCookieValue(response, COOKIE_NAMES.admin);
  const sessionId = await verifySignedValue(env.SESSION_SECRET, signed);
  if (!sessionId) return response;
  const tokenHash = await hashSessionToken(env.SESSION_SECRET, sessionId);
  const session = await env.DB.prepare(
    'SELECT admin_id FROM admin_sessions WHERE id=? AND token_hash=? AND revoked_at IS NULL LIMIT 1',
  ).bind(sessionId, tokenHash).first<{ admin_id: string }>();
  if (!session?.admin_id) {
    return hardenedJson(503, { error: 'session_activation_failed' }, { 'Set-Cookie': clearSessionCookie(COOKIE_NAMES.admin) });
  }
  const timestamp = new Date().toISOString();
  try {
    await env.DB.batch([
      env.DB.prepare(
        'UPDATE admin_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE admin_id=? AND id<>? AND revoked_at IS NULL',
      ).bind(timestamp, session.admin_id, sessionId),
      env.DB.prepare(
        `INSERT INTO settings(key,value_json,updated_at) VALUES(?,?,?)
          ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`,
      ).bind(activeAdminSessionKey(session.admin_id), sessionId, timestamp),
    ]);
    await writeAdminSessionMetadata(env, req, sessionId, timestamp);
    return response;
  } catch (error) {
    console.error('Failed to activate single admin session', error);
    await env.DB.prepare('UPDATE admin_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE id=?')
      .bind(timestamp, sessionId).run().catch(() => {});
    return hardenedJson(503, { error: 'session_activation_failed' }, { 'Set-Cookie': clearSessionCookie(COOKIE_NAMES.admin) });
  }
}

async function enforceSingleAdminSession(req: Request, env: Env) {
  const context = await activeAdminContext(env, req);
  if (!context) return null;
  const key = activeAdminSessionKey(context.adminId);
  const row = await env.DB.prepare('SELECT value_json FROM settings WHERE key=? LIMIT 1')
    .bind(key).first<SettingsRow>();
  const timestamp = new Date().toISOString();
  if (!row?.value_json) {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO settings(key,value_json,updated_at) VALUES(?,?,?)
          ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`,
      ).bind(key, context.sessionId, timestamp),
      env.DB.prepare(
        'UPDATE admin_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE admin_id=? AND id<>? AND revoked_at IS NULL',
      ).bind(timestamp, context.adminId, context.sessionId),
    ]);
    await writeAdminSessionMetadata(env, req, context.sessionId, timestamp).catch(() => {});
    return null;
  }
  if (row.value_json === context.sessionId) return null;
  await env.DB.prepare('UPDATE admin_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE id=? AND revoked_at IS NULL')
    .bind(timestamp, context.sessionId).run().catch(() => {});
  return hardenedJson(401, { error: 'session_replaced' }, { 'Set-Cookie': clearSessionCookie(COOKIE_NAMES.admin) });
}

async function handleActiveAdminSessions(req: Request, env: Env) {
  const current = await activeAdminContext(env, req);
  if (!current) return hardenedJson(401, { error: 'unauthenticated' });
  if (current.role !== 'SUPER_ADMIN') return hardenedJson(403, { error: 'forbidden' });
  const rows = await env.DB.prepare(
    `SELECT s.id,a.id admin_id,a.username,a.role,s.created_at,s.last_seen_at,s.expires_at
       FROM admin_sessions s
       JOIN admins a ON a.id=s.admin_id
       JOIN settings active ON active.key=('admin_active_session:' || a.id) AND active.value_json=s.id
      WHERE s.revoked_at IS NULL
        AND datetime(s.expires_at)>datetime('now')
        AND datetime(s.created_at)>datetime('now','-1 day')
        AND datetime(COALESCE(s.last_seen_at,s.created_at))>datetime('now','-30 minutes')
        AND COALESCE(a.is_disabled,0)=0
      ORDER BY datetime(COALESCE(s.last_seen_at,s.created_at)) DESC`,
  ).all<ActiveAdminSessionRow>();
  const sessions = [];
  for (const row of rows.results || []) {
    let deviceLabel = '';
    let approximateLocation = '';
    const meta = await env.DB.prepare('SELECT value_json FROM settings WHERE key=? LIMIT 1')
      .bind(adminSessionMetaKey(row.id)).first<SettingsRow>();
    if (meta?.value_json) {
      try {
        const parsed = JSON.parse(meta.value_json) as { deviceLabel?: unknown; approximateLocation?: unknown };
        deviceLabel = typeof parsed.deviceLabel === 'string' ? parsed.deviceLabel : '';
        approximateLocation = typeof parsed.approximateLocation === 'string' ? parsed.approximateLocation : '';
      } catch {
        // Old or malformed metadata is shown as unknown instead of guessed.
      }
    }
    sessions.push({
      id: row.id,
      adminId: row.admin_id,
      username: row.username,
      role: row.role,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      expiresAt: row.expires_at,
      deviceLabel,
      approximateLocation,
      isCurrent: row.id === current.sessionId,
    });
  }
  return hardenedJson(200, { sessions });
}

async function preserveDisplayNameForLoginUsernameChange(req: Request, env: Env, response: Response, profileReq: Request) {
  if (!response.ok) return response;
  const parsed = await profileReq.json().catch(() => null) as { username?: unknown; displayName?: unknown } | null;
  const username = typeof parsed?.username === 'string' ? parsed.username.trim() : '';
  if (!username || typeof parsed?.displayName === 'string') return response;
  const current = await activeAdminContext(env, req);
  if (!current || current.role !== 'SUPER_ADMIN') return response;
  const stored = await env.DB.prepare('SELECT display_name FROM admins WHERE id=? LIMIT 1')
    .bind(current.adminId).first<{ display_name: string | null }>();
  if (stored?.display_name === undefined) return response;
  // runtimeWorker historically couples username and display_name. Restore the independent
  // public display name immediately after a login-username-only change.
  await env.DB.prepare('UPDATE admins SET display_name=? WHERE id=?').bind(stored.display_name, current.adminId).run();
  return response;
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
      const adminReq = requestWithOnlyCookie(req, COOKIE_NAMES.admin);
      const method = req.method.toUpperCase();
      const isLogin = url.pathname === '/api/auth/login' && method === 'POST';

      const setupLimit = await adminSetupLimited(req, env);
      if (setupLimit) return setupLimit;
      if (crossSiteReadMutation(req)) return hardenedPlain(403, 'Forbidden');

      if (!isLogin) {
        const replaced = await enforceSingleAdminSession(adminReq, env);
        if (replaced) return replaced;
      }

      if (url.pathname === '/api/admin/security/sessions' && method === 'GET') {
        return handleActiveAdminSessions(adminReq, env);
      }

      if (await sensitiveIdentityMutation(req) && !(await recentAdminSession(env, adminReq))) {
        return hardenedJson(403, { error: 'reauthentication_required' });
      }

      if (isLogin) {
        const response = await inner.fetch(adminReq, env, ctx);
        return activateLoginSession(req, env, response);
      }

      const profileReq = url.pathname === '/api/admins/profile' && method === 'PATCH'
        ? req.clone() as unknown as Request
        : null;
      const response = await inner.fetch(adminReq, env, ctx);
      return profileReq ? preserveDisplayNameForLoginUsernameChange(adminReq, env, response, profileReq) : response;
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

    return inner.fetch(requestWithOnlyCookie(req, COOKIE_NAMES.guest), env, ctx);
  },
};