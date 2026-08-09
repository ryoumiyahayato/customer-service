import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendAdminAttachment } from './attachments.js';
import { requireCurrentAdmin } from './auth.js';
import { closeChatSession, listAdminChatSessions, requireAdminSessionAccess } from './chat.js';
import type { GenericServerConfig } from './config.js';
import type { PostgresAdapter } from './db/postgres.js';
import { HttpError, optionalString } from './http.js';
import { archiveSession, clearSessionHistory, recycleSession } from './lifecycle.js';
import { createSessionMessage, listSessionMessagePage, markSessionMessagesRead, normalizeMessageBody } from './messages.js';
import { readJsonBody, sendJson } from './response.js';
import { isSafeId } from './routes.js';
import { getAdminSessionToken } from './security.js';
import type { LocalStorageAdapter } from './storage/localStorage.js';
import type { WebSocketHub } from './websocket.js';

async function authenticatedAdmin(request: IncomingMessage, db: PostgresAdapter) {
  return requireCurrentAdmin(db, getAdminSessionToken(request.headers.cookie));
}

export async function handleListAdminSessions(request: IncomingMessage, response: ServerResponse, db: PostgresAdapter) {
  const admin = await authenticatedAdmin(request, db);
  const sessions = await listAdminChatSessions(db, admin);
  sendJson(response, 200, { ok: true, sessions });
}

export async function handleAdminMessages(
  request: IncomingMessage,
  response: ServerResponse,
  config: GenericServerConfig,
  db: PostgresAdapter,
  hub: WebSocketHub,
  sessionId: string,
) {
  if (!isSafeId(sessionId)) throw new HttpError(404, 'session_not_found');
  const admin = await authenticatedAdmin(request, db);
  await requireAdminSessionAccess(db, admin, sessionId);

  if (request.method === 'GET') {
    const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    const page = await listSessionMessagePage(
      db,
      sessionId,
      config.encryption,
      Number(requestUrl.searchParams.get('limit') || 100),
      requestUrl.searchParams.get('after'),
      requestUrl.searchParams.get('before'),
    );
    sendJson(response, 200, { ok: true, ...page });
    return;
  }

  if (request.method === 'POST') {
    const body = await readJsonBody<Record<string, unknown>>(request);
    const message = await createSessionMessage(
      db,
      config.encryption,
      sessionId,
      'admin',
      normalizeMessageBody(body.body),
      admin.id,
      optionalString(body.clientMessageId) || optionalString(body.client_message_id),
      admin,
    );
    if (!message.deduped) hub.broadcastToSession(sessionId, { type: 'message_created', sessionId, message });
    sendJson(response, message.deduped ? 200 : 201, { ok: true, deduped: Boolean(message.deduped), message });
    return;
  }

  throw new HttpError(405, 'method_not_allowed');
}

export async function handleAdminRead(
  request: IncomingMessage,
  response: ServerResponse,
  db: PostgresAdapter,
  hub: WebSocketHub,
  sessionId: string,
) {
  if (!isSafeId(sessionId)) throw new HttpError(404, 'session_not_found');
  const admin = await authenticatedAdmin(request, db);
  await requireAdminSessionAccess(db, admin, sessionId);
  const body = await readJsonBody<Record<string, unknown>>(request);
  const requested = Array.isArray(body.messageIds)
    ? body.messageIds.filter((id): id is string => typeof id === 'string')
    : undefined;
  const receipt = await markSessionMessagesRead(db, sessionId, 'admin', requested);
  if (receipt.messageIds.length) hub.broadcastToSession(sessionId, { type: 'messages:read', sessionId, ...receipt });
  sendJson(response, 200, { ok: true, ...receipt });
}

export async function handleCloseAdminSession(
  request: IncomingMessage,
  response: ServerResponse,
  db: PostgresAdapter,
  hub: WebSocketHub,
  sessionId: string,
) {
  if (!isSafeId(sessionId)) throw new HttpError(404, 'session_not_found');
  const admin = await authenticatedAdmin(request, db);
  const session = await closeChatSession(db, admin, sessionId);
  hub.broadcastToSession(sessionId, { type: 'session_closed', sessionId, session });
  sendJson(response, 200, { ok: true, session });
}

export async function handleAdminSessionLifecycleAction(
  request: IncomingMessage,
  response: ServerResponse,
  db: PostgresAdapter,
  storage: LocalStorageAdapter,
  sessionId: string,
  action: string,
) {
  if (!isSafeId(sessionId)) throw new HttpError(404, 'session_not_found');
  const admin = await authenticatedAdmin(request, db);

  if (action === 'archive') {
    const session = await archiveSession(db, admin, sessionId);
    sendJson(response, 200, { ok: true, session });
    return;
  }

  if (action === 'recycle') {
    const session = await recycleSession(db, admin, sessionId);
    sendJson(response, 200, { ok: true, session });
    return;
  }

  if (action === 'clear-history') {
    const body = await readJsonBody<Record<string, unknown>>(request);
    const result = await clearSessionHistory(db, storage, sessionId, admin, body.confirm);
    sendJson(response, 200, { ok: true, result });
    return;
  }

  throw new HttpError(404, 'not_found');
}

export async function handleAdminAttachmentDownload(
  request: IncomingMessage,
  response: ServerResponse,
  config: GenericServerConfig,
  db: PostgresAdapter,
  storage: LocalStorageAdapter,
  attachmentId: string,
) {
  if (!isSafeId(attachmentId)) throw new HttpError(404, 'attachment_not_found');
  const admin = await authenticatedAdmin(request, db);
  await sendAdminAttachment(response, db, storage, config.encryption, attachmentId, admin);
}
