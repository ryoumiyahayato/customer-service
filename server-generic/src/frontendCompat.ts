import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  abuseSessionPart,
  abuseUsernamePart,
  sendRateLimitResponse,
  type AbuseGuard,
} from './abuseGuard.js';
import { loginAdmin, logoutAdmin, requireCurrentAdmin } from './auth.js';
import { listAdminChatSessions, requireAdminSessionExists, requireVisitorSession, type ChatSessionSummary } from './chat.js';
import type { GenericServerConfig } from './config.js';
import { hashVisitorToken } from './crypto.js';
import type { PostgresAdapter } from './db/postgres.js';
import { HttpError, optionalString, requireString } from './http.js';
import { consumeInvite, createInvite, listInvites, revokeInvite, type PublicInvite } from './invites.js';
import { createSessionMessage, listSessionMessages, markSessionMessagesRead, type ChatMessage } from './messages.js';
import { readJsonBody, sendJson, sendNoContent } from './response.js';
import { isSafeId } from './routes.js';
import { getAdminSessionToken, parseCookies, serializeAdminSessionCookie, serializeClearAdminSessionCookie } from './security.js';
import type { WebSocketHub } from './websocket.js';

const VISITOR_COOKIE_NAME = 'support_visitor';
const VISITOR_COOKIE_TTL = 60 * 60 * 24 * 30;

export const FRONTEND_COMPAT_ROUTES = [
  'POST /api/auth/login',
  'POST /api/auth/logout',
  'GET /api/auth/me',
  'GET /api/sessions',
  'GET /api/sessions/:id/messages',
  'POST /api/sessions/:id/customer-read',
  'POST /api/messages',
  'POST /api/guest/:token',
  'GET /api/invites',
  'POST /api/invites',
  'POST /api/invites/:id/revoke',
  'POST /api/upload',
] as const;

type FrontendCompatContext = {
  config: GenericServerConfig;
  db: PostgresAdapter;
  hub: WebSocketHub;
  abuseGuard: AbuseGuard;
};

type FrontendAdminSource = {
  id: string;
  username: string;
  email: string | null;
  displayName: string | null;
  role: string;
  createdAt: string;
};

function isProductionCookie() {
  return process.env.NODE_ENV === 'production';
}

function serializeVisitorCookie(token: string) {
  const parts = [
    `${VISITOR_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${VISITOR_COOKIE_TTL}`,
  ];
  if (isProductionCookie()) parts.push('Secure');
  return parts.join('; ');
}

function visitorTokenFromRequest(request: IncomingMessage, body?: Record<string, unknown>): string | null {
  const fromBody = optionalString(body?.visitorId)?.trim() || optionalString(body?.visitorToken)?.trim();
  if (fromBody) return fromBody;
  return parseCookies(request.headers.cookie).get(VISITOR_COOKIE_NAME) || null;
}

function frontendStatus(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === 'closed') return 'CLOSED';
  if (normalized === 'archived') return 'ARCHIVED';
  return 'OPEN';
}

export function mapFrontendSession(session: ChatSessionSummary) {
  return {
    id: session.id,
    status: frontendStatus(session.status),
    customer_name: session.customerName,
    customer_remark_name: null,
    visitor_key: session.id,
    user_id: null,
    assigned_operator_id: null,
    unread_count: 0,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
    closed_at: session.closedAt,
    archived_at: session.archivedAt,
    deleted_at: session.deletedAt,
    purged_at: null,
    history_cleared_at: session.historyClearedAt,
  };
}

export function mapFrontendMessage(message: ChatMessage) {
  const senderType = message.senderType === 'admin' ? 'OPERATOR' : 'VISITOR';
  const attachment = message.attachments[0] || null;
  return {
    id: message.id,
    session_id: message.sessionId,
    sessionId: message.sessionId,
    sender_type: senderType,
    senderType,
    sender_id: message.senderId || null,
    content: message.body || '',
    body: message.body || '',
    message_type: attachment ? 'image' : message.messageType || 'text',
    messageType: attachment ? 'image' : message.messageType || 'text',
    image_path: null,
    status: 'sent',
    is_read: message.readAt ? 1 : 0,
    read_at: message.readAt,
    created_at: message.createdAt,
    quote_message_id: null,
    client_message_id: message.clientMessageId,
    deduped: Boolean(message.deduped),
    attachments: message.attachments,
  };
}

export function mapFrontendAdmin(admin: FrontendAdminSource) {
  return {
    id: admin.id,
    username: admin.username,
    email: admin.email,
    display_name: admin.displayName,
    displayName: admin.displayName,
    role: admin.role,
    created_at: admin.createdAt,
    updated_at: null,
    disabled: false,
  };
}

function mapFrontendInvite(invite: PublicInvite) {
  return {
    id: invite.id,
    created_by_admin_id: invite.createdByAdminId,
    source_admin_id: invite.sourceAdminId,
    session_id: invite.sessionId,
    expires_at: invite.expiresAt,
    consumed_at: invite.consumedAt,
    revoked_at: invite.revokedAt,
    created_at: invite.createdAt,
    mode: 'persistent_single_use',
  };
}

function matchCompatSessionMessages(pathname: string): string | null {
  const match = /^\/api\/sessions\/([^/]+)\/messages$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

function matchCustomerRead(pathname: string): string | null {
  const match = /^\/api\/sessions\/([^/]+)\/customer-read$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

function matchGuestBootstrap(pathname: string): string | null {
  const match = /^\/api\/guest\/([^/]+)$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

function matchInviteRevoke(pathname: string): string | null {
  const match = /^\/api\/invites\/([^/]+)\/revoke$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

function enforceAbuseLimit(response: ServerResponse, decision: ReturnType<AbuseGuard['check']>) {
  if (decision.allowed) return false;
  sendRateLimitResponse(response, decision);
  return true;
}

async function currentAdminOrNull(db: PostgresAdapter, request: IncomingMessage) {
  const token = getAdminSessionToken(request.headers.cookie);
  if (!token) return null;
  try {
    return await requireCurrentAdmin(db, token);
  } catch {
    return null;
  }
}

async function requireAdmin(db: PostgresAdapter, request: IncomingMessage) {
  return requireCurrentAdmin(db, getAdminSessionToken(request.headers.cookie));
}

async function requireVisitorIdentity(
  db: PostgresAdapter,
  sessionId: string,
  request: IncomingMessage,
  body?: Record<string, unknown>,
) {
  const visitorToken = visitorTokenFromRequest(request, body);
  const session = await requireVisitorSession(db, sessionId, visitorToken);
  return { session, visitorToken: requireString(visitorToken, 'visitorToken') };
}

function broadcastReadReceipt(context: FrontendCompatContext, sessionId: string, messageIds: string[], readAt: string | null) {
  if (!messageIds.length) return;
  context.hub.broadcastToSession(sessionId, {
    type: 'messages_read',
    sessionId,
    messageIds,
    readAt,
  });
}

async function handleFrontendLogin(request: IncomingMessage, response: ServerResponse, context: FrontendCompatContext) {
  const body = await readJsonBody<Record<string, unknown>>(request);
  if (enforceAbuseLimit(response, context.abuseGuard.check(request, 'admin_login', [abuseUsernamePart(body)]))) return;
  const result = await loginAdmin(context.config, context.db, body);
  sendJson(
    response,
    200,
    {
      ok: true,
      admin: mapFrontendAdmin(result.admin),
    },
    { 'set-cookie': serializeAdminSessionCookie(result.session.token, context.config) },
  );
}

async function handleFrontendMe(request: IncomingMessage, response: ServerResponse, context: FrontendCompatContext) {
  const admin = await requireAdmin(context.db, request);
  sendJson(response, 200, { ok: true, admin: mapFrontendAdmin(admin), disabled: false });
}

async function handleFrontendLogout(request: IncomingMessage, response: ServerResponse, context: FrontendCompatContext) {
  await logoutAdmin(context.db, getAdminSessionToken(request.headers.cookie));
  sendNoContent(response, { 'set-cookie': serializeClearAdminSessionCookie() });
}

async function handleFrontendSessions(request: IncomingMessage, response: ServerResponse, context: FrontendCompatContext) {
  await requireAdmin(context.db, request);
  const sessions = await listAdminChatSessions(context.db, 100);
  sendJson(response, 200, { ok: true, sessions: sessions.map(mapFrontendSession) });
}

async function handleFrontendSessionMessages(
  request: IncomingMessage,
  response: ServerResponse,
  context: FrontendCompatContext,
  sessionId: string,
) {
  if (!isSafeId(sessionId)) throw new HttpError(404, 'session_not_found');
  const admin = await currentAdminOrNull(context.db, request);
  const readerType = admin ? 'admin' : 'visitor';
  if (!admin) await requireVisitorIdentity(context.db, sessionId, request);
  else await requireAdminSessionExists(context.db, sessionId);

  const receipt = await markSessionMessagesRead(context.db, sessionId, readerType);
  broadcastReadReceipt(context, sessionId, receipt.messageIds, receipt.readAt);
  const messages = await listSessionMessages(context.db, sessionId, context.config.encryption);
  sendJson(response, 200, { ok: true, messages: messages.map(mapFrontendMessage), read: receipt });
}

async function handleFrontendCustomerRead(
  request: IncomingMessage,
  response: ServerResponse,
  context: FrontendCompatContext,
  sessionId: string,
) {
  if (!isSafeId(sessionId)) throw new HttpError(404, 'session_not_found');
  await requireVisitorIdentity(context.db, sessionId, request);
  const receipt = await markSessionMessagesRead(context.db, sessionId, 'visitor');
  broadcastReadReceipt(context, sessionId, receipt.messageIds, receipt.readAt);
  sendJson(response, 200, { ok: true, ...receipt });
}

async function handleFrontendMessageCreate(request: IncomingMessage, response: ServerResponse, context: FrontendCompatContext) {
  const body = await readJsonBody<Record<string, unknown>>(request);
  const sessionId = (optionalString(body.sessionId) || optionalString(body.session_id) || '').trim();
  if (!sessionId || !isSafeId(sessionId)) throw new HttpError(404, 'session_not_found');
  if (enforceAbuseLimit(response, context.abuseGuard.check(request, 'message_ip'))) return;
  if (enforceAbuseLimit(response, context.abuseGuard.check(request, 'message_session', [abuseSessionPart(sessionId)]))) return;

  const content = optionalString(body.content) ?? optionalString(body.body) ?? '';
  const messageType = (optionalString(body.messageType) || optionalString(body.message_type) || 'text').trim().toLowerCase();
  if (messageType !== 'text') throw new HttpError(501, 'server_generic_upload_unsupported');

  const senderType = (optionalString(body.senderType) || optionalString(body.sender_type) || '').trim().toUpperCase();
  const clientMessageId = optionalString(body.clientMessageId) || optionalString(body.client_message_id);
  let message: ChatMessage;

  if (senderType === 'OPERATOR' || senderType === 'ADMIN') {
    const admin = await requireAdmin(context.db, request);
    message = await createSessionMessage(
      context.db,
      context.config.encryption,
      sessionId,
      'admin',
      content,
      admin.id,
      clientMessageId,
    );
  } else if (senderType === 'VISITOR' || senderType === 'CUSTOMER') {
    const visitor = await requireVisitorIdentity(context.db, sessionId, request, body);
    message = await createSessionMessage(
      context.db,
      context.config.encryption,
      sessionId,
      'visitor',
      content,
      hashVisitorToken(visitor.visitorToken),
      clientMessageId,
    );
  } else {
    throw new HttpError(400, 'sender_type_required');
  }

  const session = await requireAdminSessionExists(context.db, sessionId);
  const frontendMessage = mapFrontendMessage(message);
  if (!message.deduped) {
    context.hub.broadcastToSession(sessionId, {
      type: 'message_created',
      sessionId,
      message: frontendMessage as unknown as ChatMessage,
    });
  }
  sendJson(response, message.deduped ? 200 : 201, {
    ok: true,
    deduped: Boolean(message.deduped),
    message: frontendMessage,
    session: mapFrontendSession(session),
  });
}

async function handleFrontendGuestBootstrap(
  request: IncomingMessage,
  response: ServerResponse,
  context: FrontendCompatContext,
  token: string,
) {
  if (enforceAbuseLimit(response, context.abuseGuard.check(request, 'guest_bootstrap', [token]))) return;
  const body = await readJsonBody<Record<string, unknown>>(request);
  const existingVisitorToken = visitorTokenFromRequest(request, body);
  const customerName = optionalString(body.customerName)?.trim() || '访客';
  const consumed = await consumeInvite(context.db, token, existingVisitorToken, customerName);
  const messages = await listSessionMessages(context.db, consumed.session.id, context.config.encryption);
  sendJson(
    response,
    200,
    {
      ok: true,
      selfHostedInvite: true,
      resumed: consumed.resumed,
      invite: mapFrontendInvite(consumed.invite),
      visitorId: consumed.visitorToken,
      session: mapFrontendSession(consumed.session),
      messages: messages.map(mapFrontendMessage),
    },
    { 'set-cookie': serializeVisitorCookie(consumed.visitorToken) },
  );
}

async function handleFrontendInviteCreate(request: IncomingMessage, response: ServerResponse, context: FrontendCompatContext) {
  const admin = await requireAdmin(context.db, request);
  const body = await readJsonBody<Record<string, unknown>>(request);
  const result = await createInvite(context.db, admin.id, {
    sourceAdminId: optionalString(body.sourceAdminId) || optionalString(body.source_admin_id),
    expiresInSeconds: body.expiresInSeconds ?? body.expires_in_seconds,
  });
  sendJson(response, 201, {
    ok: true,
    invite: {
      ...mapFrontendInvite(result.invite),
      token: result.token,
      url: `/g/${encodeURIComponent(result.token)}`,
    },
  });
}

async function handleFrontendInviteList(request: IncomingMessage, response: ServerResponse, context: FrontendCompatContext) {
  await requireAdmin(context.db, request);
  const invites = await listInvites(context.db, 100);
  sendJson(response, 200, { ok: true, invites: invites.map(mapFrontendInvite) });
}

async function handleFrontendInviteRevoke(
  request: IncomingMessage,
  response: ServerResponse,
  context: FrontendCompatContext,
  inviteId: string,
) {
  await requireAdmin(context.db, request);
  if (!isSafeId(inviteId)) throw new HttpError(404, 'invite_not_found');
  const invite = await revokeInvite(context.db, inviteId);
  sendJson(response, 200, { ok: true, invite: mapFrontendInvite(invite) });
}

async function handleFrontendUploadUnsupported(request: IncomingMessage, response: ServerResponse, context: FrontendCompatContext) {
  if (enforceAbuseLimit(response, context.abuseGuard.check(request, 'upload'))) return;
  sendJson(response, 501, { ok: false, error: 'server_generic_upload_unsupported' });
}

export async function handleFrontendCompatRequest(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  context: FrontendCompatContext,
): Promise<boolean> {
  if (request.method === 'POST' && url.pathname === '/api/auth/login') {
    await handleFrontendLogin(request, response, context);
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/auth/me') {
    await handleFrontendMe(request, response, context);
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
    await handleFrontendLogout(request, response, context);
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/sessions') {
    await handleFrontendSessions(request, response, context);
    return true;
  }

  const messagesSessionId = matchCompatSessionMessages(url.pathname);
  if (request.method === 'GET' && messagesSessionId) {
    await handleFrontendSessionMessages(request, response, context, messagesSessionId);
    return true;
  }

  const customerReadSessionId = matchCustomerRead(url.pathname);
  if (request.method === 'POST' && customerReadSessionId) {
    await handleFrontendCustomerRead(request, response, context, customerReadSessionId);
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/messages') {
    await handleFrontendMessageCreate(request, response, context);
    return true;
  }

  const guestToken = matchGuestBootstrap(url.pathname);
  if (request.method === 'POST' && guestToken) {
    await handleFrontendGuestBootstrap(request, response, context, guestToken);
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/invites') {
    await handleFrontendInviteList(request, response, context);
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/invites') {
    await handleFrontendInviteCreate(request, response, context);
    return true;
  }

  const inviteId = matchInviteRevoke(url.pathname);
  if (request.method === 'POST' && inviteId) {
    await handleFrontendInviteRevoke(request, response, context, inviteId);
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/upload') {
    await handleFrontendUploadUnsupported(request, response, context);
    return true;
  }

  return false;
}
