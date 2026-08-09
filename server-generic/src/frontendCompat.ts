import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  abuseSessionPart,
  abuseUsernamePart,
  sendRateLimitResponse,
  type AbuseGuard,
} from './abuseGuard.js';
import { loginAdmin, logoutAdmin, requireCurrentAdmin } from './auth.js';
import {
  listAdminChatSessions,
  requireAdminSessionAccess,
  requireAdminSessionExists,
  requireVisitorSession,
  type ChatSessionSummary,
} from './chat.js';
import type { GenericServerConfig } from './config.js';
import { hashVisitorToken } from './crypto.js';
import type { PostgresAdapter } from './db/postgres.js';
import { HttpError, optionalString, requireString } from './http.js';
import { consumeInvite, createInvite, listInvites, revokeInvite, type PublicInvite } from './invites.js';
import { createSessionMessage, listSessionMessagePage, markSessionMessagesRead, type ChatMessage } from './messages.js';
import { readJsonBody, sendJson, sendNoContent } from './response.js';
import { isSafeId } from './routes.js';
import { getAdminSessionToken, parseCookies, serializeAdminSessionCookie, serializeClearAdminSessionCookie } from './security.js';
import type { WebSocketHub } from './websocket.js';

const VISITOR_COOKIE_NAME = 'support_visitor';
const VISITOR_COOKIE_TTL = 60 * 60 * 24 * 30;
const MAX_READ_RECEIPT_MESSAGE_IDS = 500;

export const FRONTEND_COMPAT_ROUTES = [
  'POST /api/auth/login',
  'POST /api/auth/logout',
  'GET /api/auth/me',
  'GET /api/sessions',
  'GET /api/sessions/:id/messages',
  'POST /api/sessions/:id/read',
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
  // Browser compatibility uses the HttpOnly cookie first. `visitorId` is deliberately
  // not accepted as a credential so a page-visible identifier can never become auth.
  const fromCookie = parseCookies(request.headers.cookie).get(VISITOR_COOKIE_NAME) || null;
  if (fromCookie) return fromCookie;
  return optionalString(body?.visitorToken)?.trim() || null;
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
    assigned_operator_id: session.assignedOperatorId,
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

function mapFrontendSessionForVisitor(session: ChatSessionSummary) {
  return {
    id: session.id,
    status: frontendStatus(session.status),
    unread_count: 0,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
    closed_at: session.closedAt,
    archived_at: session.archivedAt,
    deleted_at: session.deletedAt,
    history_cleared_at: session.historyClearedAt,
  };
}

export function mapFrontendMessage(message: ChatMessage, clientMessageIdOverride?: string | null | number) {
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
    client_message_id: typeof clientMessageIdOverride === 'string'
      ? clientMessageIdOverride
      : message.clientMessageId ?? null,
    deduped: Boolean(message.deduped),
    attachments: message.attachments,
  };
}

function mapFrontendMessageForVisitor(message: ChatMessage, clientMessageIdOverride?: string | null | number) {
  return { ...mapFrontendMessage(message, clientMessageIdOverride), sender_id: null };
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
    source_operator_id: invite.sourceAdminId,
    sourceOperatorId: invite.sourceAdminId,
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

function matchSessionRead(pathname: string): string | null {
  const match = /^\/api\/sessions\/([^/]+)\/read$/.exec(pathname);
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

function normalizeRequestedMessageIds(value: unknown): string[] {
  if (!Array.isArray(value)) throw new HttpError(400, 'message_ids_required');
  if (value.length > MAX_READ_RECEIPT_MESSAGE_IDS) throw new HttpError(400, 'invalid_message_ids');

  const messageIds: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== 'string') throw new HttpError(400, 'invalid_message_ids');
    const id = raw.trim();
    if (!id || !isSafeId(id)) throw new HttpError(400, 'invalid_message_ids');
    if (!seen.has(id)) {
      seen.add(id);
      messageIds.push(id);
    }
  }
  return messageIds;
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
    type: 'messages:read',
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
  const admin = await requireAdmin(context.db, request);
  const sessions = await listAdminChatSessions(context.db, admin, 100);
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
  if (!admin) await requireVisitorIdentity(context.db, sessionId, request);
  else await requireAdminSessionAccess(context.db, admin, sessionId);

  const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  const page = await listSessionMessagePage(
    context.db,
    sessionId,
    context.config.encryption,
    Number(requestUrl.searchParams.get('limit') || 100),
    requestUrl.searchParams.get('after'),
    requestUrl.searchParams.get('before'),
  );
  sendJson(response, 200, {
    ok: true,
    messages: page.messages.map((message) => admin ? mapFrontendMessage(message) : mapFrontendMessageForVisitor(message)),
    nextCursor: page.nextCursor,
  });
}

async function handleFrontendSessionRead(
  request: IncomingMessage,
  response: ServerResponse,
  context: FrontendCompatContext,
  sessionId: string,
) {
  if (!isSafeId(sessionId)) throw new HttpError(404, 'session_not_found');
  const body = await readJsonBody<Record<string, unknown>>(request);
  const admin = await currentAdminOrNull(context.db, request);
  if (admin) await requireAdminSessionAccess(context.db, admin, sessionId);
  else await requireVisitorIdentity(context.db, sessionId, request, body);
  const requestedMessageIds = normalizeRequestedMessageIds(body.messageIds ?? body.message_ids);
  const receipt = await markSessionMessagesRead(context.db, sessionId, admin ? 'admin' : 'visitor', requestedMessageIds);
  broadcastReadReceipt(context, sessionId, receipt.messageIds, receipt.readAt);
  sendJson(response, 200, { ok: true, ...receipt });
}

async function handleFrontendCustomerRead(
  request: IncomingMessage,
  response: ServerResponse,
  context: FrontendCompatContext,
  sessionId: string,
) {
  if (!isSafeId(sessionId)) throw new HttpError(404, 'session_not_found');
  const body = await readJsonBody<Record<string, unknown>>(request);
  await requireVisitorIdentity(context.db, sessionId, request, body);
  const requestedMessageIds = normalizeRequestedMessageIds(body.messageIds ?? body.message_ids);
  const receipt = await markSessionMessagesRead(context.db, sessionId, 'visitor', requestedMessageIds);
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
  let session: ChatSessionSummary;
  let visitorResponse = false;

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
      admin,
    );
    session = await requireAdminSessionAccess(context.db, admin, sessionId);
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
    session = await requireAdminSessionExists(context.db, sessionId);
    visitorResponse = true;
  } else {
    throw new HttpError(400, 'sender_type_required');
  }

  const frontendMessage = visitorResponse ? mapFrontendMessageForVisitor(message) : mapFrontendMessage(message);
  if (!message.deduped) {
    context.hub.broadcastToSession(sessionId, {
      type: 'message_created',
      sessionId,
      message: frontendMessage,
    });
  }
  sendJson(response, message.deduped ? 200 : 201, {
    ok: true,
    deduped: Boolean(message.deduped),
    message: frontendMessage,
    session: visitorResponse ? mapFrontendSessionForVisitor(session) : mapFrontendSession(session),
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
  const page = await listSessionMessagePage(context.db, consumed.session.id, context.config.encryption);
  sendJson(
    response,
    200,
    {
      ok: true,
      selfHostedInvite: true,
      resumed: consumed.resumed,
      visitorId: consumed.session.id,
      session: mapFrontendSessionForVisitor(consumed.session),
      messages: page.messages.map((message) => mapFrontendMessageForVisitor(message)),
      nextCursor: page.nextCursor,
    },
    { 'set-cookie': serializeVisitorCookie(consumed.visitorToken) },
  );
}

async function handleFrontendInviteCreate(request: IncomingMessage, response: ServerResponse, context: FrontendCompatContext) {
  const admin = await requireAdmin(context.db, request);
  const body = await readJsonBody<Record<string, unknown>>(request);
  const requestedSourceAdminId = (
    optionalString(body.sourceOperatorId) ||
    optionalString(body.source_operator_id) ||
    optionalString(body.sourceAdminId) ||
    optionalString(body.source_admin_id)
  )?.trim() || null;
  const result = await createInvite(context.db, admin, {
    sourceAdminId: requestedSourceAdminId,
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
  const admin = await requireAdmin(context.db, request);
  const invites = await listInvites(context.db, admin, 100);
  sendJson(response, 200, { ok: true, invites: invites.map(mapFrontendInvite) });
}

async function handleFrontendInviteRevoke(
  request: IncomingMessage,
  response: ServerResponse,
  context: FrontendCompatContext,
  inviteId: string,
) {
  const admin = await requireAdmin(context.db, request);
  if (!isSafeId(inviteId)) throw new HttpError(404, 'invite_not_found');
  const invite = await revokeInvite(context.db, admin, inviteId);
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

  const sessionReadId = matchSessionRead(url.pathname);
  if (request.method === 'POST' && sessionReadId) {
    await handleFrontendSessionRead(request, response, context, sessionReadId);
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
