export { ChatRoom } from './worker-preset';
import worker from './worker-preset';
import type { Env } from './worker';
import { COOKIE_NAMES, readCookie } from './security/cookies';
import { hmacHex, verifySignedValue } from './security/signing';
import { hashSessionToken } from './security/sessionTokens';
import { jsonResponse } from './security/responseHeaders';
import { activeAdminSession } from './security/adminSession';
import { readOperatorPolicy } from './security/operatorPolicy';
import { isSameOriginWebSocket as sameOriginWebSocket } from './security/requestOrigin';
import { requestStreamExceeds } from './security/requestLimits';
import { withStaffRoomAccess } from './durable-objects/ChatRoom';
import { readOperatorPresentation } from './operatorPresentation';
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

type StaffAdminContext = {
  id: string;
  role: 'SUPER_ADMIN' | 'OPERATOR';
  sessionId: string;
};
type DomainEnv = Env & { ADMIN_PUBLIC_HOST?: string; VISITOR_ROOT_DOMAIN?: string };
type InviteGateRow = {
  source_operator_id?: string | null;
  created_by_admin_id?: string | null;
  expires_at: string;
  revoked_at: string | null;
  consumed_at: string | null;
  consumed_session_id?: string | null;
};
type PresentationOwnerRow = {
  id: string;
  username: string;
  display_name: string | null;
  is_disabled: number;
};
type GuestSessionRow = { visitor_key: string | null };
type GuestUserRow = { id: string };
type GuestConversationRow = { id: string; purged_at: string | null };

const inner = worker as WorkerModule;
const ADMIN_CONTROL_JSON_MAX_BYTES = 16 * 1024;
const GUEST_CONSUME_PATH = /^\/api\/guest\/([a-f0-9]{40})$/i;

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
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
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
    || path === '/api/operators'
    || path.startsWith('/api/operator-avatar/');
}

function isVisitorOnlyApi(path: string) {
  return path.startsWith('/api/guest/')
    || path === '/api/guest'
    || path === '/api/guest-avatar'
    || path === '/api/guest-presentation'
    || path.startsWith('/api/invite-presentation/')
    || path.startsWith('/api/invite-avatar/');
}

function allowedVisitorAssetPath(path: string) {
  if (path === '/visitor/visitor.html') return true;
  return path.startsWith('/visitor/assets/') && !path.endsWith('.map');
}

function domainBoundaryBlock(req: Request, env: Env) {
  const url = new URL(req.url);
  const host = normalizePublicHost(url.hostname);
  if (isLocalDevHost(host)) return null;
  const visitor = isVisitorSurfaceHost(host, visitorRootDomain(env));
  const admin = isAdminSurfaceHost(host, adminPublicHost(env));

  if (!visitor && !admin) return notFound();

  if (admin) {
    if (url.pathname.startsWith('/visitor/')
      || url.pathname === '/chat'
      || isVisitorOnlyApi(url.pathname)) return notFound();
    return null;
  }

  if (url.pathname === '/'
    || url.pathname === '/admin'
    || url.pathname === '/setup'
    || url.pathname === '/chat'
    || url.pathname.startsWith('/assets/')
    || url.pathname.startsWith('/icons/')
    || url.pathname === '/manifest.webmanifest'
    || url.pathname === '/sw.js'
    || url.pathname.startsWith('/api/invite-presentation/')
    || isAdminOnlyApi(url.pathname)) return notFound();

  if (url.pathname.startsWith('/visitor/') && !allowedVisitorAssetPath(url.pathname)) return notFound();
  if (!url.pathname.startsWith('/api/')
    && !allowedVisitorAssetPath(url.pathname)) return notFound();

  return null;
}

async function serveVisitorAsset(req: Request, env: Env, pathname: string) {
  if (!allowedVisitorAssetPath(pathname)) return notFound();
  const assetUrl = new URL(req.url);
  assetUrl.pathname = pathname;
  assetUrl.search = '';
  const assetResponse = await env.ASSETS.fetch(new Request(assetUrl.toString(), { method: 'GET', headers: req.headers }));
  if (!assetResponse.ok) return notFound();
  const contentType = String(assetResponse.headers.get('content-type') || '').toLowerCase();
  if (pathname !== '/visitor/visitor.html' && contentType.includes('text/html')) return notFound();
  const headers = new Headers(assetResponse.headers);
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  if (pathname.endsWith('.html')) headers.set('Cache-Control', 'no-store');
  return new Response(assetResponse.body, {
    status: assetResponse.status,
    statusText: assetResponse.statusText,
    headers,
  });
}

async function inviteByToken(env: Env, token: string) {
  const tokenHash = await hmacHex(env.SESSION_SECRET, `invite:${token}`);
  return env.DB.prepare(
    `SELECT source_operator_id,created_by_admin_id,expires_at,revoked_at,consumed_at,consumed_session_id
       FROM invite_links WHERE token_hash=? LIMIT 1`,
  ).bind(tokenHash).first<InviteGateRow>();
}

function inviteUnavailable(invite: InviteGateRow | null, at = new Date().toISOString()) {
  return !invite || Boolean(invite.revoked_at) || invite.expires_at <= at || Boolean(invite.consumed_at);
}

async function consumedInviteBlock(req: Request, env: Env) {
  if (req.method.toUpperCase() !== 'POST') return null;
  const match = new URL(req.url).pathname.match(GUEST_CONSUME_PATH);
  if (!match) return null;
  const invite = await inviteByToken(env, match[1].toLowerCase());
  if (!inviteUnavailable(invite)) return null;
  return jsonResponse({ error: 'invite_unavailable' }, {
    status: 410,
    headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  });
}

async function readPresentation(env: Env, adminId: string) {
  return readOperatorPresentation(env.DB, adminId);
}

async function publicPresentationForInvite(env: Env, token: string) {
  const invite = await inviteByToken(env, token);
  if (!invite || !invite.consumed_at || !invite.consumed_session_id || invite.revoked_at || invite.expires_at <= new Date().toISOString()) return null;
  const ownerId = String(invite.source_operator_id || invite.created_by_admin_id || '').trim();
  if (!ownerId) return null;
  const owner = await env.DB.prepare(
    'SELECT id,username,display_name,is_disabled FROM admins WHERE id=? AND COALESCE(is_disabled,0)=0 LIMIT 1',
  ).bind(ownerId).first<PresentationOwnerRow>();
  if (!owner?.id) return null;
  const presentation = await readPresentation(env, owner.id);
  return {
    displayName: String(owner.display_name || owner.username || '在线客服'),
    avatarUrl: presentation.avatarKey ? '/api/guest-avatar' : '',
  };
}

async function rewriteGuestBootstrapResponse(response: Response, env: Env, token: string) {
  if (!response.ok) return response;
  const payload = await response.clone().json().catch(() => null) as Record<string, unknown> | null;
  if (!payload) return response;
  const presentation = await publicPresentationForInvite(env, token);
  const safePayload: Record<string, unknown> = {};
  if (payload.session) safePayload.session = payload.session;
  if (payload.messages) safePayload.messages = payload.messages;
  safePayload.presentation = presentation;
  const headers = new Headers(response.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.delete('Content-Length');
  return new Response(JSON.stringify(safePayload), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function currentGuestConversationId(env: Env, req: Request) {
  const signed = readCookie(req, COOKIE_NAMES.guest);
  const visitorSessionId = await verifySignedValue(env.SESSION_SECRET, signed);
  if (!visitorSessionId) return '';
  const tokenHash = await hashSessionToken(env.SESSION_SECRET, visitorSessionId);
  const visitorSession = await env.DB.prepare(
    `SELECT visitor_key FROM visitor_sessions
      WHERE id=? AND token_hash=? AND revoked_at IS NULL AND datetime(expires_at)>datetime('now') LIMIT 1`,
  ).bind(visitorSessionId, tokenHash).first<GuestSessionRow>();
  if (!visitorSession?.visitor_key) return '';
  const user = await env.DB.prepare('SELECT id FROM users WHERE visitor_key=? LIMIT 1')
    .bind(visitorSession.visitor_key).first<GuestUserRow>();
  if (!user?.id) return '';
  const session = await env.DB.prepare(
    `SELECT id,purged_at FROM sessions
      WHERE user_id=? AND purged_at IS NULL
      ORDER BY datetime(created_at) DESC LIMIT 1`,
  ).bind(user.id).first<GuestConversationRow>();
  return session?.id || '';
}

async function guestAvatarResponse(req: Request, env: Env) {
  const sessionId = await currentGuestConversationId(env, req);
  if (!sessionId) return notFound();
  const invite = await env.DB.prepare(
    `SELECT source_operator_id,created_by_admin_id,expires_at,revoked_at,consumed_at,consumed_session_id
       FROM invite_links WHERE consumed_session_id=? LIMIT 1`,
  ).bind(sessionId).first<InviteGateRow>();
  if (!invite || !invite.consumed_at || invite.revoked_at || invite.expires_at <= new Date().toISOString()) return notFound();
  const ownerId = String(invite.source_operator_id || invite.created_by_admin_id || '').trim();
  if (!ownerId) return notFound();
  const presentation = await readPresentation(env, ownerId);
  if (!presentation.avatarKey || !presentation.avatarKey.startsWith(`operator-avatars/${ownerId}/`)) return notFound();
  const object = await env.UPLOADS.get(presentation.avatarKey);
  if (!object) return notFound();
  return new Response(object.body, {
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    },
  });
}


function isBoundedAdminControlMutation(path: string, method: string) {
  if (method === 'PUT' && /^\/api\/admin\/operator-policies\/[^/]+$/.test(path)) return true;
  return method === 'POST' && /^\/api\/admin\/operators\/[^/]+\/reset-password$/.test(path);
}

async function currentStaffAdmin(env: Env, req: Request): Promise<StaffAdminContext | null> {
  const active = await activeAdminSession(env, req, { touch: true });
  return active ? { id: active.id, role: active.role, sessionId: active.sessionId } : null;
}

async function staffChatAllowed(env: Env, admin: StaffAdminContext) {
  if (admin.role === 'SUPER_ADMIN') return true;
  if (admin.role !== 'OPERATOR') return false;
  return (await readOperatorPolicy(env.DB, admin.id)).canUseStaffChat;
}

async function openStaffSocket(req: Request, env: Env) {
  if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    return new Response('Expected WebSocket', { status: 426 });
  }
  if (!sameOriginWebSocket(req)) {
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
    const visitorHost = isVisitorSurfaceHost(url.hostname, visitorRootDomain(env));

    if (visitorHost && method === 'GET' && allowedVisitorAssetPath(url.pathname)) {
      return serveVisitorAsset(req, env, url.pathname);
    }
    if (visitorHost && method === 'GET' && url.pathname === '/api/guest-avatar') {
      return guestAvatarResponse(req, env);
    }

    const consumedInvite = await consumedInviteBlock(req, env);
    if (consumedInvite) return consumedInvite;

    if (url.pathname === '/api/ws/staff') return openStaffSocket(req, env);
    if (isBoundedAdminControlMutation(url.pathname, method) && await requestStreamExceeds(req as unknown as Request, ADMIN_CONTROL_JSON_MAX_BYTES)) {
      return jsonResponse({ error: 'request_too_large' }, { status: 413 });
    }
    const response = await inner.fetch(req, env, ctx);
    if (url.pathname === '/api/invites' && method === 'POST') return rewriteInvitePublicUrl(req, env, response);
    const guestConsume = url.pathname.match(GUEST_CONSUME_PATH);
    if (visitorHost && method === 'POST' && guestConsume) {
      return rewriteGuestBootstrapResponse(response, env, guestConsume[1].toLowerCase());
    }
    return response;
  },
};
