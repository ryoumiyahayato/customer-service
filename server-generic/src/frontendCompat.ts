import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { loginAdmin, logoutAdmin, requireCurrentAdmin } from './auth.js';
import { createVisitorSession, listAdminChatSessions, mapChatSession, requireAdminSessionExists, requireVisitorSession, type ChatSessionSummary } from './chat.js';
import type { GenericServerConfig } from './config.js';
import { hashVisitorToken } from './crypto.js';
import type { PostgresAdapter } from './db/postgres.js';
import { HttpError, optionalString, requireString } from './http.js';
import { createSessionMessage, listSessionMessages, type ChatMessage } from './messages.js';
import { readJsonBody, sendJson, sendNoContent } from './response.js';
import { isSafeId } from './routes.js';
import { getAdminSessionToken, parseCookies, serializeAdminSessionCookie, serializeClearAdminSessionCookie } from './security.js';
import type { WebSocketHub } from './websocket.js';

const VISITOR_COOKIE_NAME = 'support_visitor';
const VISITOR_COOKIE_TTL = 60 * 60 * 24 * 30;

export const FRONTEND_COMPAT_ROUTES = [
  'POST /api/auth/login',
  'POST /api/auth/logout',
  'GET /api/sessions',
  'GET /api/sessions/:id/messages',
  'POST /api/messages',
  'POST /api/guest/:token',
  'POST /api/invites',
  'POST /api/upload',
] as const;

type FrontendCompatContext = {
  config: GenericServerConfig;
  db: PostgresAdapter;
  hub: WebSocketHub;
};

type ChatSessionRow = {
  id: string;
  status: string;
  customer_name: string | null;
  created_at: Date;
  updated_at: Date;
  closed_at: Date | null;
  archived_at: Date | null;
  deleted_at: Date | null;
  history_cleared_at: Date | null;
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

export function mapFrontendMessage(message: ChatMessage, clientMessageId?: string | null) {
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
    client_message_id: clientMessageId || null,
    attachments: message.attachments,
  };
}

function mapFrontendAdmin(admin: { id: string; username: string; email: string | null; displayName: string | null; role: string; createdAt: string }) {
  return {
    id: admin.id,
    username: admin.username,
    email: admin.email,
    display_name: admin.displayName,
    displayName: admin.displayName,
    role: admin.role,
    created_at: admin.createdAt,
    disabled: false,
  };
}

function matchCompatSessionMessages(pathname: string): string | null {
  const match = /^\/api\/sessions\/([^/]+)\/messages$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

function matchGuestBootstrap(pathname: string): string | null {
  const match = /^\/api\/guest\/([^/]+)$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

async function findSessionByVisitorToken(db: PostgresAdapter, visitorToken: string): Promise<ChatSessionSummary | null> {
  const rows = await db.query<ChatSessionRow>(
    `SELECT id, status, customer_name, created_at, updated_at, closed_at, archived_at, deleted_at, history_cleared_at
       FROM chat_sessions
      WHERE visitor_token_hash = $1
      LIMIT 1`,
    [hashVisitorToken(visitorToken)],
  );
  return rows[0] ? mapChatSession(rows[0]) : null;
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

async function requireVisitorForSession(db: PostgresAdapter, sessionId: string, request: IncomingMessage, body?: Record<string, unknown>) {
  const visitorToken = visitorTokenFromRequest(request, body);
  return requireVisitorSession(db, sessionId, visitorToken);
}

async function handleFrontendLogin(request: IncomingMessage, response: ServerResponse, context: FrontendCompatContext) {
  const body = await readJsonBody<Record<string, unknown>>(request);
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

async function handleFrontendLogout(request: IncomingMessage, response: ServerResponse, context: FrontendCompatContext) {
  await logoutAdmin(context.db, getAdminSessionToken(request.headers.cookie));
  sendNoContent(response, { 'set-cookie': serializeClearAdminSessionCookie() });
}

async function handleFrontendSessions(request: IncomingMessage, response: ServerResponse, context: FrontendCompatContext) {
  await requireAdmin(context.db, request);
  const sessions = await listAdminChatSessions(context.db, 100);
  sendJson(response, 200, { ok: true, sessions: sessions.map(mapFrontendSession) });
}

async function handleFrontendSessionMessages(request: IncomingMessage, response: ServerResponse, context: FrontendCompatContext, sessionId: string) {
  if (!isSafeId(sessionId)) throw new HttpError(404, 'session_not_found');
  const admin = await currentAdminOrNull(context.db, request);
  if (!admin) await requireVisitorForSession(context.db, sessionId, request);
  else await requireAdminSessionExists(context.db, sessionId);

  const messages = await listSessionMessages(context.db, sessionId, context.config.encryption);
  sendJson(response, 200, { ok: true, messages: messages.map((message) => mapFrontendMessage(message)) });
}

async function handleFrontendMessageCreate(request: IncomingMessage, response: ServerResponse, context: FrontendCompatContext) {
  const body = await readJsonBody<Record<string, unknown>>(request);
  const sessionId = (optionalString(body.sessionId) || optionalString(body.session_id) || '').trim();
  if (!sessionId || !isSafeId(sessionId)) throw new HttpError(404, 'session_not_found');

  const content = (optionalString(body.content) ?? optionalString(body.body) ?? '').trim();
  const messageType = (optionalString(body.messageType) || optionalString(body.message_type) || 'text').trim().toLowerCase();
  if (messageType !== 'text') throw new HttpError(501, 'server_generic_upload_unsupported');

  const senderType = (optionalString(body.senderType) || optionalString(body.sender_type) || '').trim().toUpperCase();
  const clientMessageId = optionalString(body.clientMessageId) || optionalString(body.client_message_id);
  let message: ChatMessage;

  if (senderType === 'OPERATOR' || senderType === 'ADMIN') {
    const admin = await requireAdmin(context.db, request);
    message = await createSessionMessage(context.db, context.config.encryption, sessionId, 'admin', content, admin.id);
  } else if (senderType === 'VISITOR' || senderType === 'CUSTOMER') {
    await requireVisitorForSession(context.db, sessionId, request, body);
    message = await createSessionMessage(context.db, context.config.encryption, sessionId, 'visitor', content);
  } else {
    throw new HttpError(400, 'sender_type_required');
  }

  const session = await requireAdminSessionExists(context.db, sessionId);
  const frontendMessage = mapFrontendMessage(message, clientMessageId);
  context.hub.broadcastToSession(sessionId, { type: 'message_created', sessionId, message: frontendMessage as unknown as ChatMessage });
  sendJson(response, 201, { ok: true, message: frontendMessage, session: mapFrontendSession(session) });
}

async function handleFrontendGuestBootstrap(request: IncomingMessage, response: ServerResponse, context: FrontendCompatContext, token: string) {
  if (!token || token.length > 128) throw new HttpError(404, 'invite_not_found');
  const body = await readJsonBody<Record<string, unknown>>(request);
  let visitorToken = visitorTokenFromRequest(request, body);
  let session = visitorToken ? await findSessionByVisitorToken(context.db, visitorToken) : null;

  if (!session) {
    const created = await createVisitorSession(context.db, { customerName: '访客' });
    visitorToken = created.visitorToken;
    session = created.session;
  }

  const messages = await listSessionMessages(context.db, session.id, context.config.encryption);
  sendJson(
    response,
    200,
    {
      ok: true,
      selfHostedInvite: true,
      invite: { token, mode: 'self_host_minimal_bootstrap' },
      visitorId: visitorToken,
      session: mapFrontendSession(session),
      messages: messages.map((message) => mapFrontendMessage(message)),
    },
    { 'set-cookie': serializeVisitorCookie(requireString(visitorToken, 'visitorToken')) },
  );
}

async function handleFrontendInviteCreate(request: IncomingMessage, response: ServerResponse, context: FrontendCompatContext) {
  await requireAdmin(context.db, request);
  const token = `selfhost-${randomUUID()}`;
  sendJson(response, 201, {
    ok: true,
    invite: {
      token,
      url: `/g/${encodeURIComponent(token)}`,
      mode: 'self_host_minimal_bootstrap',
    },
  });
}

async function handleFrontendUploadUnsupported(_request: IncomingMessage, response: ServerResponse) {
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

  if (request.method === 'POST' && url.pathname === '/api/messages') {
    await handleFrontendMessageCreate(request, response, context);
    return true;
  }

  const guestToken = matchGuestBootstrap(url.pathname);
  if (request.method === 'POST' && guestToken) {
    await handleFrontendGuestBootstrap(request, response, context, guestToken);
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/invites') {
    await handleFrontendInviteCreate(request, response, context);
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/upload') {
    await handleFrontendUploadUnsupported(request, response);
    return true;
  }

  return false;
}
