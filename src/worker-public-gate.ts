export { ChatRoom } from './worker-final';
import worker from './worker-final';
import type { Env } from './worker';
import { hmacHex } from './security/signing';
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

const inner = worker as WorkerModule;
const INVITE_CONSUME = /^\/api\/guest\/([a-f0-9]{40})$/i;
const MESSAGE_LIST = /^\/api\/sessions\/[^/]+\/messages$/;
const CUSTOMER_READ = /^\/api\/sessions\/[^/]+\/customer-read$/;
const CONVERSATION_SOCKET = /^\/api\/ws\/conversations\/[^/]+$/;
const ATTACHMENT = /^\/api\/attachments\/[^/]+$/;
const ADMIN_LOGIN_RESPONSE_FLOOR_MS = 450;
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
      const isLogin = req.method.toUpperCase() === 'POST' && url.pathname === '/api/auth/login';
      const startedAt = Date.now();
      let response = await inner.fetch(req, env, ctx);
      if (isLogin) response = await finishAdminLogin(response, startedAt);
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
