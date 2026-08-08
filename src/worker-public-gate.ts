export { ChatRoom } from './worker-final';
import worker from './worker-final';
import type { Env } from './worker';
import { COOKIE_NAMES, readCookie } from './security/cookies';
import { hmacHex, verifySignedValue } from './security/signing';
import { hashSessionToken } from './security/sessionTokens';
import { consumeRateLimit } from './security/rateLimit';
import { readJsonObjectWithinLimit, requestStreamExceeds } from './security/requestLimits';
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

type DomainEnv = Env & {
  VISITOR_ROOT_DOMAIN?: string;
  VISITOR_PUBLIC_HOSTS?: string;
  ADMIN_PUBLIC_HOST?: string;
};
type InviteEntryRow = {
  expires_at: string;
  revoked_at: string | null;
  consumed_at: string | null;
};
type AdminContext = {
  id: string;
  username: string;
  displayName: string;
  role: 'SUPER_ADMIN' | 'OPERATOR';
  sessionId: string;
};
type InviteStatusRow = {
  id: string;
  source_operator_id: string | null;
  created_by_admin_id: string;
  expires_at: string;
  revoked_at: string | null;
  consumed_at: string | null;
};

const inner = worker as WorkerModule;
const INVITE_CONSUME = /^\/api\/guest\/([a-f0-9]{40})$/i;
const MESSAGE_LIST = /^\/api\/sessions\/[^/]+\/messages$/;
const CUSTOMER_READ = /^\/api\/sessions\/[^/]+\/customer-read$/;
const CONVERSATION_SOCKET = /^\/api\/ws\/conversations\/[^/]+$/;
const ATTACHMENT = /^\/api\/attachments\/[^/]+$/;
const INVITE_STATUS = /^\/api\/invites\/(inv_[A-Za-z0-9_-]{1,96})\/status$/;
const ADMIN_LOGIN_RESPONSE_FLOOR_MS = 450;
const ADMIN_JSON_MAX_BYTES = 16 * 1024;
const AVATAR_REQUEST_MAX_BYTES = 2 * 1024 * 1024 + 64 * 1024;
const SESSION_ENDED_PUBLIC_ERROR = '\u4f1a\u8bdd\u5df2\u7ed3\u675f';

function visitorRoot(env: Env) {
  return normalizePublicHost((env as DomainEnv).VISITOR_ROOT_DOMAIN || DEFAULT_VISITOR_ROOT_DOMAIN) || DEFAULT_VISITOR_ROOT_DOMAIN;
}

function visitorRoots(env: Env) {
  const configured = String((env as DomainEnv).VISITOR_PUBLIC_HOSTS || visitorRoot(env));
  return [...new Set(configured.split(',').map(normalizePublicHost).filter(Boolean))];
}

function adminHost(env: Env) {
  return normalizePublicHost((env as DomainEnv).ADMIN_PUBLIC_HOST || DEFAULT_ADMIN_PUBLIC_HOST) || DEFAULT_ADMIN_PUBLIC_HOST;
}

function visitorHostContext(host: string, env: Env) {
  for (const root of visitorRoots(env)) {
    const token = extractVisitorSubdomainToken(host, root);
    if (token) return { root, token };
  }
  return null;
}

function securityHeaders(surface: 'admin' | 'visitor') {
  const formAction = surface === 'visitor' ? "form-action 'none'" : "form-action 'self'";
  return {
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    'X-Permitted-Cross-Domain-Policies': 'none',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Origin-Agent-Cluster': '?1',
    'Content-Security-Policy': `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'none'; ${formAction}; frame-ancestors 'none'`,
  } as const;
}

function hardenResponse(response: Response, surface: 'admin' | 'visitor') {
  if ((response as Response & { webSocket?: unknown }).webSocket) return response;
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(securityHeaders(surface))) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function notFound(surface: 'admin' | 'visitor' = 'visitor') {
  return hardenResponse(new Response('Not found', {
    status: 404,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  }), surface);
}

function adminLegacyVisitorApi(path: string) {
  return path === '/api/login'
    || path === '/api/visitor'
    || path === '/api/account'
    || path.startsWith('/api/account/');
}

function sameOriginWrite(req: Request) {
  const url = new URL(req.url);
  const origin = req.headers.get('origin');
  if (origin) {
    try { return new URL(origin).origin === url.origin; } catch { return false; }
  }
  const referer = req.headers.get('referer');
  if (referer) {
    try { return new URL(referer).origin === url.origin; } catch { return false; }
  }
  return isLocalDevelopmentHost(url.hostname);
}

async function currentAdminContext(env: Env, req: Request): Promise<AdminContext | null> {
  const sessionId = await verifySignedValue(env.SESSION_SECRET, readCookie(req, COOKIE_NAMES.admin));
  if (!sessionId) return null;
  const row = await env.DB.prepare(
    `SELECT a.id,a.username,a.display_name,a.role,s.id session_id
       FROM admin_sessions s
       JOIN admins a ON a.id=s.admin_id
      WHERE s.id=? AND s.token_hash=? AND s.revoked_at IS NULL
        AND datetime(s.expires_at)>datetime('now')
        AND datetime(s.created_at)>datetime('now','-1 day')
        AND datetime(COALESCE(s.last_seen_at,s.created_at))>datetime('now','-30 minutes')
        AND COALESCE(a.is_disabled,0)=0
        AND a.role IN ('SUPER_ADMIN','OPERATOR')
      LIMIT 1`,
  ).bind(sessionId, await hashSessionToken(env.SESSION_SECRET, sessionId))
    .first<{ id: string; username: string; display_name: string | null; role: 'SUPER_ADMIN' | 'OPERATOR'; session_id: string }>();
  if (!row?.id) return null;
  const seenAt = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare('UPDATE admin_sessions SET last_seen_at=? WHERE id=? AND revoked_at IS NULL').bind(seenAt, sessionId),
    env.DB.prepare('UPDATE admins SET last_seen_at=? WHERE id=? AND COALESCE(is_disabled,0)=0').bind(seenAt, row.id),
  ]);
  return {
    id: row.id,
    username: row.username,
    displayName: String(row.display_name || row.username || ''),
    role: row.role,
    sessionId: row.session_id,
  };
}

function b64(bytes: Uint8Array) {
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

async function hashAdminPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const iterations = 210000;
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256);
  return `pbkdf2:${iterations}:${b64(salt)}:${b64(new Uint8Array(bits))}`;
}

async function adminMutationLimit(env: Env, req: Request, admin: AdminContext, bucket: string, limit: number, windowMs: number) {
  const ip = String(req.headers.get('cf-connecting-ip') || 'unknown').slice(0, 80);
  return consumeRateLimit(env.DB, `${bucket}:${admin.id}:${ip}`.slice(0, 240), limit, windowMs);
}

async function handleOwnProfilePatch(req: Request, env: Env) {
  if (!sameOriginWrite(req)) return jsonResponse({ error: 'forbidden' }, { status: 403 });
  const admin = await currentAdminContext(env, req);
  if (!admin) return jsonResponse({ error: 'unauthenticated' }, { status: 401 });
  const retryAfter = await adminMutationLimit(env, req, admin, 'profile', 12, 10 * 60 * 1000);
  if (retryAfter !== null) return jsonResponse({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(retryAfter) } });

  const parsed = await readJsonObjectWithinLimit(req, ADMIN_JSON_MAX_BYTES);
  if (parsed.tooLarge) return jsonResponse({ error: 'request_too_large' }, { status: 413 });
  const body = parsed.body;
  const usernameProvided = typeof body.username === 'string' && body.username.trim().length > 0;
  const displayNameProvided = typeof body.displayName === 'string';
  const passwordProvided = typeof body.password === 'string' && body.password.length > 0;
  if (!usernameProvided && !displayNameProvided && !passwordProvided) return jsonResponse({ error: 'no_changes' }, { status: 400 });

  const username = usernameProvided ? String(body.username).trim() : admin.username;
  const displayName = displayNameProvided ? String(body.displayName).trim() : admin.displayName;
  const password = passwordProvided ? String(body.password) : '';
  if (!/^[A-Za-z0-9_.@-]{3,64}$/.test(username)) return jsonResponse({ error: 'invalid_username' }, { status: 400 });
  if (!displayName || Array.from(displayName).length > 80) return jsonResponse({ error: 'invalid_display_name' }, { status: 400 });
  if (passwordProvided && (password.length < 12 || password.length > 128)) return jsonResponse({ error: 'invalid_password' }, { status: 400 });

  const at = new Date().toISOString();
  try {
    if (passwordProvided) {
      await env.DB.batch([
        env.DB.prepare(
          'UPDATE admins SET username=?,display_name=?,password_hash=?,must_change_password=0,updated_at=? WHERE id=? AND COALESCE(is_disabled,0)=0',
        ).bind(username, displayName, await hashAdminPassword(password), at, admin.id),
        env.DB.prepare(
          'UPDATE admin_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE admin_id=? AND id<>? AND revoked_at IS NULL',
        ).bind(at, admin.id, admin.sessionId),
      ]);
    } else {
      await env.DB.prepare(
        'UPDATE admins SET username=?,display_name=?,updated_at=? WHERE id=? AND COALESCE(is_disabled,0)=0',
      ).bind(username, displayName, at, admin.id).run();
    }
  } catch {
    return jsonResponse({ error: 'profile_conflict' }, { status: 409 });
  }
  return jsonResponse({ ok: true, profile: { username, displayName } });
}

async function inviteStatus(req: Request, env: Env, inviteId: string) {
  const admin = await currentAdminContext(env, req);
  if (!admin) return jsonResponse({ error: 'unauthenticated' }, { status: 401 });
  const retryAfter = await adminMutationLimit(env, req, admin, 'invite-status', 90, 60 * 1000);
  if (retryAfter !== null) return jsonResponse({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(retryAfter) } });
  const row = await env.DB.prepare(
    `SELECT id,source_operator_id,created_by_admin_id,expires_at,revoked_at,consumed_at
       FROM invite_links WHERE id=? LIMIT 1`,
  ).bind(inviteId).first<InviteStatusRow>();
  if (!row?.id) return notFound('admin');
  if (admin.role !== 'SUPER_ADMIN' && row.created_by_admin_id !== admin.id && row.source_operator_id !== admin.id) return notFound('admin');
  const state = row.revoked_at
    ? 'revoked'
    : row.consumed_at
      ? 'consumed'
      : row.expires_at <= new Date().toISOString()
        ? 'expired'
        : 'active';
  return jsonResponse({ invite: { handle: row.id, state, expiresAt: row.expires_at } });
}

async function enrichInviteHandle(req: Request, env: Env, response: Response) {
  if (!response.ok) return response;
  const admin = await currentAdminContext(env, req);
  if (!admin) return response;
  const payload = await response.clone().json().catch(() => null) as Record<string, unknown> | null;
  const invite = payload?.invite && typeof payload.invite === 'object' && !Array.isArray(payload.invite)
    ? payload.invite as Record<string, unknown>
    : null;
  if (!invite) return response;
  const row = await env.DB.prepare(
    `SELECT id,expires_at FROM invite_links
      WHERE created_by_admin_id=? AND revoked_at IS NULL AND consumed_at IS NULL
        AND datetime(expires_at)>datetime('now')
      ORDER BY datetime(created_at) DESC LIMIT 1`,
  ).bind(admin.id).first<{ id: string; expires_at: string }>();
  if (!row?.id) return response;
  invite.inviteHandle = row.id;
  if (invite.expiresAt === undefined && invite.expires_at === undefined) invite.expiresAt = row.expires_at;
  const headers = new Headers(response.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  headers.delete('Content-Length');
  return new Response(JSON.stringify(payload), { status: response.status, statusText: response.statusText, headers });
}

async function avatarMagicMatches(req: Request) {
  const form = await req.clone().formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return true;
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (file.type === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (file.type === 'image/png') {
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return bytes.length >= sig.length && sig.every((byte, index) => bytes[index] === byte);
  }
  if (file.type === 'image/webp') {
    return bytes.length >= 12
      && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
      && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  }
  return false;
}

async function inviteAllowsInitialDocument(env: Env, token: string) {
  const tokenHash = await hmacHex(env.SESSION_SECRET, `invite:${token.toLowerCase()}`);
  const row = await env.DB.prepare(
    `SELECT expires_at,revoked_at,consumed_at
       FROM invite_links
      WHERE token_hash=?
      LIMIT 1`,
  ).bind(tokenHash).first<InviteEntryRow>();
  if (!row) return false;
  if (row.revoked_at || row.consumed_at) return false;
  return row.expires_at > new Date().toISOString();
}

export function isAllowedVisitorApiRequest(req: Request, expectedInviteToken = '') {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method.toUpperCase();
  const consume = path.match(INVITE_CONSUME);
  if (method === 'POST' && consume) {
    return !expectedInviteToken || consume[1].toLowerCase() === expectedInviteToken.toLowerCase();
  }
  if (method === 'GET' && path === '/api/guest-avatar') return true;
  if (method === 'GET' && MESSAGE_LIST.test(path)) return true;
  if (method === 'POST' && CUSTOMER_READ.test(path)) return true;
  if (method === 'POST' && path === '/api/messages') return true;
  if (method === 'POST' && path === '/api/upload') return true;
  if ((method === 'GET' || method === 'HEAD') && ATTACHMENT.test(path)) return true;
  if (method === 'GET' && CONVERSATION_SOCKET.test(path) && req.headers.get('upgrade')?.toLowerCase() === 'websocket') return true;
  return false;
}

function visitorDocumentRequest(req: Request) {
  const url = new URL(req.url);
  url.pathname = '/visitor/visitor.html';
  url.search = '';
  return new Request(url.toString(), {
    method: 'GET',
    headers: req.headers,
  });
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function first(source: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) if (source[key] !== undefined) return source[key];
  return undefined;
}

function safeVisitorMessage(value: unknown) {
  const source = record(value);
  if (!source.id) return null;
  return {
    id: source.id,
    sessionId: first(source, 'sessionId', 'session_id'),
    senderType: first(source, 'senderType', 'sender_type'),
    senderId: null,
    content: typeof source.content === 'string' ? source.content : typeof source.body === 'string' ? source.body : '',
    messageType: first(source, 'messageType', 'message_type') || 'text',
    imagePath: first(source, 'imagePath', 'image_path') ?? null,
    status: source.status || 'sent',
    createdAt: first(source, 'createdAt', 'created_at') || '',
    readAt: first(source, 'readAt', 'read_at') ?? null,
    isRead: Boolean(first(source, 'isRead', 'is_read')),
    quoteMessageId: first(source, 'quoteMessageId', 'quote_message_id') ?? null,
    clientMessageId: first(source, 'clientMessageId', 'client_message_id') ?? null,
    recalledAt: first(source, 'recalledAt', 'recalled_at') ?? null,
    deletedAt: first(source, 'deletedAt', 'deleted_at') ?? null,
    imagePurgedAt: first(source, 'imagePurgedAt', 'image_purged_at') ?? null,
  };
}

function safeVisitorSession(value: unknown) {
  const source = record(value);
  if (!source.id) return null;
  return {
    id: source.id,
    status: source.status || 'UNKNOWN',
    createdAt: first(source, 'createdAt', 'created_at') || '',
    updatedAt: first(source, 'updatedAt', 'updated_at') || '',
    historyClearedAt: first(source, 'historyClearedAt', 'history_cleared_at') ?? null,
    unreadCount: 0,
  };
}

function safeVisitorPresentation(value: unknown) {
  const source = record(value);
  return {
    displayName: typeof source.displayName === 'string' ? source.displayName : '',
    welcomeText: typeof source.welcomeText === 'string' ? source.welcomeText : '',
    avatarUrl: typeof source.avatarUrl === 'string' ? source.avatarUrl : '',
  };
}

function visitorErrorPayload(response: Response, source: Record<string, unknown>) {
  const raw = typeof source.error === 'string' ? source.error : '';
  if (response.status === 400 && (raw === SESSION_ENDED_PUBLIC_ERROR || raw === 'session_ended')) {
    return { error: SESSION_ENDED_PUBLIC_ERROR };
  }
  if ([401, 403, 404, 410].includes(response.status)) return { error: 'unavailable' };
  if (response.status === 413) return { error: 'request_too_large' };
  if (response.status === 429) return { error: 'rate_limited' };
  if (response.status >= 500) return { error: 'server_error' };
  return { error: 'bad_request' };
}

async function minimizeVisitorJson(req: Request, response: Response) {
  if ((response as Response & { webSocket?: unknown }).webSocket) return response;
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('application/json')) return response;

  const value = await response.clone().json().catch(() => null);
  const source = record(value);
  let payload: Record<string, unknown>;
  if (!response.ok) {
    payload = visitorErrorPayload(response, source);
  } else {
    const path = new URL(req.url).pathname;
    if (INVITE_CONSUME.test(path)) {
      payload = {
        session: safeVisitorSession(source.session),
        messages: Array.isArray(source.messages) ? source.messages.map(safeVisitorMessage).filter(Boolean) : [],
        presentation: safeVisitorPresentation(source.presentation),
      };
    } else if (MESSAGE_LIST.test(path)) {
      payload = {
        messages: Array.isArray(source.messages) ? source.messages.map(safeVisitorMessage).filter(Boolean) : [],
      };
    } else if (path === '/api/messages') {
      payload = {
        message: safeVisitorMessage(source.message),
        session: source.session ? safeVisitorSession(source.session) : undefined,
        deduped: Boolean(source.deduped),
      };
    } else if (path === '/api/upload') {
      payload = { path: typeof source.path === 'string' ? source.path : '' };
    } else if (CUSTOMER_READ.test(path)) {
      payload = { ok: true };
    } else {
      payload = {};
    }
  }

  const headers = new Headers(response.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  headers.delete('Content-Length');
  return new Response(JSON.stringify(payload), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function genericInvalidCredentials(response: Response) {
  const headers = new Headers(response.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  headers.delete('Content-Length');
  return new Response(JSON.stringify({ error: 'invalid_credentials' }), {
    status: 401,
    headers,
  });
}

async function finishAdminLogin(response: Response, startedAt: number) {
  const normalized = response.status === 403 ? genericInvalidCredentials(response) : response;
  if (normalized.status !== 429) {
    const remaining = ADMIN_LOGIN_RESPONSE_FLOOR_MS - (Date.now() - startedAt);
    if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
  }
  return normalized;
}

export default {
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    await inner.scheduled?.(controller, env, ctx);
  },

  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(req.url);
    const host = normalizePublicHost(url.hostname);
    if (isLocalDevelopmentHost(host)) return inner.fetch(req, env, ctx);

    const visitor = visitorHostContext(host, env);
    if (!visitor) {
      if (!isAdminSurfaceHost(host, adminHost(env))) return hardenResponse(await inner.fetch(req, env, ctx), 'admin');
      if (adminLegacyVisitorApi(url.pathname)) return notFound('admin');

      if (req.method.toUpperCase() === 'PATCH' && url.pathname === '/api/admins/profile') {
        return hardenResponse(await handleOwnProfilePatch(req, env), 'admin');
      }
      const statusMatch = url.pathname.match(INVITE_STATUS);
      if (req.method.toUpperCase() === 'GET' && statusMatch) {
        return hardenResponse(await inviteStatus(req, env, statusMatch[1]), 'admin');
      }
      if (req.method.toUpperCase() === 'POST' && url.pathname === '/api/admins/presentation/avatar') {
        if (await requestStreamExceeds(req, AVATAR_REQUEST_MAX_BYTES)) {
          return hardenResponse(jsonResponse({ error: 'avatar_too_large' }, { status: 413 }), 'admin');
        }
        if (!(await avatarMagicMatches(req))) {
          return hardenResponse(jsonResponse({ error: 'avatar_content_mismatch' }, { status: 400 }), 'admin');
        }
      }

      const isLogin = req.method.toUpperCase() === 'POST' && url.pathname === '/api/auth/login';
      const startedAt = Date.now();
      let response = await inner.fetch(req, env, ctx);
      if (isLogin) response = await finishAdminLogin(response, startedAt);
      if (req.method.toUpperCase() === 'POST' && url.pathname === '/api/invites') {
        response = await enrichInviteHandle(req, env, response);
      }
      return hardenResponse(response, 'admin');
    }

    const method = req.method.toUpperCase();
    if ((method === 'GET' || method === 'HEAD') && url.pathname === '/') {
      if (!(await inviteAllowsInitialDocument(env, visitor.token))) return notFound('visitor');
      if (method === 'HEAD') {
        return hardenResponse(new Response(null, {
          status: 200,
          headers: { 'Cache-Control': 'no-store' },
        }), 'visitor');
      }
      return hardenResponse(await inner.fetch(visitorDocumentRequest(req), env, ctx), 'visitor');
    }
    if (method === 'GET' && url.pathname.startsWith('/visitor/assets/')) {
      return hardenResponse(await inner.fetch(req, env, ctx), 'visitor');
    }
    if (url.pathname.startsWith('/api/')) {
      if (!isAllowedVisitorApiRequest(req, visitor.token)) return notFound('visitor');
      const response = await inner.fetch(req, env, ctx);
      return hardenResponse(await minimizeVisitorJson(req, response), 'visitor');
    }

    return notFound('visitor');
  },
};
