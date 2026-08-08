export { ChatRoom } from './worker-entry';
import worker from './worker-entry';
import type { Env } from './worker';
import { COOKIE_NAMES, readCookie } from './security/cookies';
import { verifySignedValue } from './security/signing';
import { hashSessionToken } from './security/sessionTokens';
import { jsonResponse } from './security/responseHeaders';
import { requestStreamExceeds } from './security/requestLimits';
import { withStaffRoomAccess } from './durable-objects/ChatRoom';
import {
  DEFAULT_ADMIN_PUBLIC_HOST,
  DEFAULT_VISITOR_ROOT_DOMAIN,
  buildVisitorInviteUrl,
  isAdminSurfaceHost,
  isLocalDevelopmentHost,
  isVisitorSurfaceHost,
  normalizePublicHost,
} from './domainIsolation';

type WorkerModule = {
  fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
  scheduled?(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void>;
};

type SettingsRow = { value_json: string };
type StaffAdminContext = {
  id: string;
  role: 'SUPER_ADMIN' | 'OPERATOR';
  sessionId: string;
};
type DomainEnv = Env & { ADMIN_PUBLIC_HOST?: string; VISITOR_ROOT_DOMAIN?: string };

const inner = worker as WorkerModule;
const ADMIN_CONTROL_JSON_MAX_BYTES = 16 * 1024;

function isLocalDevHost(host: string) {
  return isLocalDevelopmentHost(host);
}

function visitorRootDomain(env: Env) {
  return normalizePublicHost((env as DomainEnv).VISITOR_ROOT_DOMAIN || DEFAULT_VISITOR_ROOT_DOMAIN) || DEFAULT_VISITOR_ROOT_DOMAIN;
}

function adminPublicHost(env: Env) {
  return normalizePublicHost((env as DomainEnv).ADMIN_PUBLIC_HOST || DEFAULT_ADMIN_PUBLIC_HOST) || DEFAULT_ADMIN_PUBLIC_HOST;
}

function notFound() {
  return new Response('Not found', {
    status: 404,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
    },
  });
}

function isAdminOnlyApi(path: string) {
  return path === '/api/invites'
    || path === '/api/staff-chat'
    || path === '/api/ws/staff'
    || path.startsWith('/api/auth/')
    || path === '/api/auth'
    || path.startsWith('/api/admin/')
    || path === '/api/admin'
    || path.startsWith('/api/admins/')
    || path === '/api/admins'
    || path.startsWith('/api/operators/')
    || path === '/api/operators';
}

function isVisitorOnlyApi(path: string) {
  return path.startsWith('/api/guest/')
    || path === '/api/guest'
    || path === '/api/guest-avatar'
    || path === '/api/guest-presentation'
    || path.startsWith('/api/invite-presentation/')
    || path.startsWith('/api/invite-avatar/');
}

function domainBoundaryBlock(req: Request, env: Env) {
  const url = new URL(req.url);
  const host = normalizePublicHost(url.hostname);
  if (isLocalDevHost(host)) return null;
  const visitor = isVisitorSurfaceHost(host, visitorRootDomain(env));
  const admin = isAdminSurfaceHost(host, adminPublicHost(env));

  if (admin) {
    if (/^\/g\/[^/]+\/?$/.test(url.pathname) || url.pathname === '/chat' || isVisitorOnlyApi(url.pathname)) return notFound();
    return null;
  }

  if (visitor) {
    if (url.pathname === '/' || url.pathname === '/admin' || url.pathname === '/setup' || isAdminOnlyApi(url.pathname)) return notFound();
    return null;
  }

  return null;
}

function isSameOriginWebSocket(req: Request) {
  const url = new URL(req.url);
  const origin = req.headers.get('origin');
  if (origin) {
    try { return new URL(origin).origin === url.origin; } catch { return false; }
  }
  return isLocalDevHost(url.hostname) || isLocalDevHost(req.headers.get('host') || '');
}

function isBoundedAdminControlMutation(path: string, method: string) {
  if (method === 'PUT' && /^\/api\/admin\/operator-policies\/[^/]+$/.test(path)) return true;
  return method === 'POST' && /^\/api\/admin\/operators\/[^/]+\/reset-password$/.test(path);
}

async function currentStaffAdmin(env: Env, req: Request): Promise<StaffAdminContext | null> {
  const signed = readCookie(req, COOKIE_NAMES.admin);
  const sessionId = await verifySignedValue(env.SESSION_SECRET, signed);
  if (!sessionId) return null;
  const row = await env.DB.prepare(
    `SELECT a.id,a.role,s.id session_id
       FROM admin_sessions s
       JOIN admins a ON a.id=s.admin_id
      WHERE s.id=? AND s.token_hash=? AND s.revoked_at IS NULL
        AND datetime(s.expires_at)>datetime('now')
        AND datetime(s.created_at)>datetime('now','-1 day')
        AND datetime(COALESCE(s.last_seen_at,s.created_at))>datetime('now','-30 minutes')
        AND COALESCE(a.is_disabled,0)=0
        AND a.role IN ('SUPER_ADMIN','OPERATOR')
      LIMIT 1`,
  ).bind(sessionId, await hashSessionToken(env.SESSION_SECRET, sessionId)).first<{ id: string; role: 'SUPER_ADMIN' | 'OPERATOR'; session_id: string }>();
  if (!row?.id) return null;
  const seenAt = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare('UPDATE admin_sessions SET last_seen_at=? WHERE id=? AND revoked_at IS NULL').bind(seenAt, sessionId),
    env.DB.prepare('UPDATE admins SET last_seen_at=? WHERE id=? AND COALESCE(is_disabled,0)=0').bind(seenAt, row.id),
  ]);
  return { id: row.id, role: row.role, sessionId: row.session_id };
}

async function staffChatAllowed(env: Env, admin: StaffAdminContext) {
  if (admin.role === 'SUPER_ADMIN') return true;
  const row = await env.DB.prepare('SELECT value_json FROM settings WHERE key=? LIMIT 1')
    .bind(`operator_policy:${admin.id}`).first<SettingsRow>();
  if (!row?.value_json) return true;
  try {
    const policy = JSON.parse(row.value_json) as { canUseStaffChat?: unknown };
    return policy.canUseStaffChat !== false;
  } catch {
    return true;
  }
}

async function openStaffSocket(req: Request, env: Env) {
  if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    return new Response('Expected WebSocket', { status: 426 });
  }
  if (!isSameOriginWebSocket(req)) {
    return jsonResponse({ error: 'forbidden' }, { status: 403 });
  }
  const admin = await currentStaffAdmin(env, req);
  if (!admin) return jsonResponse({ error: 'unauthenticated' }, { status: 401 });
  if (!(await staffChatAllowed(env, admin))) {
    return jsonResponse({ error: 'operator_permission_denied', capability: 'canUseStaffChat' }, { status: 403 });
  }
  const stub = env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName('staff'));
  return stub.fetch(withStaffRoomAccess(req as unknown as Request, admin.id, admin.sessionId));
}

async function rewriteInvitePublicUrl(req: Request, env: Env, response: Response) {
  if (!response.ok || new URL(req.url).pathname !== '/api/invites') return response;
  const payload = await response.clone().json().catch(() => null) as { invite?: Record<string, unknown> } | null;
  if (!payload?.invite) return response;
  const token = typeof payload.invite.token === 'string' ? payload.invite.token.trim() : '';
  if (!token) return response;
  try {
    payload.invite.url = buildVisitorInviteUrl(token, visitorRootDomain(env));
  } catch {
    return jsonResponse({ error: 'visitor_domain_configuration_error' }, { status: 500 });
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

export default {
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    await inner.scheduled?.(controller, env, ctx);
  },

  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const boundary = domainBoundaryBlock(req, env);
    if (boundary) return boundary;

    const url = new URL(req.url);
    const method = req.method.toUpperCase();
    if (url.pathname === '/api/ws/staff') return openStaffSocket(req, env);
    if (isBoundedAdminControlMutation(url.pathname, method) && await requestStreamExceeds(req as unknown as Request, ADMIN_CONTROL_JSON_MAX_BYTES)) {
      return jsonResponse({ error: 'request_too_large' }, { status: 413 });
    }
    const response = await inner.fetch(req, env, ctx);
    if (url.pathname === '/api/invites' && method === 'POST') return rewriteInvitePublicUrl(req, env, response);
    return response;
  },
};
