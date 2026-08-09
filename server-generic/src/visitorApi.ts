import type { IncomingMessage, ServerResponse } from 'node:http';
import type { GenericServerConfig } from './config.js';
import { createVisitorAttachment, sendVisitorAttachment } from './attachments.js';
import { createVisitorSession, requireVisitorSession } from './chat.js';
import { hashVisitorToken } from './crypto.js';
import type { PostgresAdapter } from './db/postgres.js';
import { HttpError, optionalString } from './http.js';
import { createSessionMessage, listSessionMessagePage, markSessionMessagesRead, normalizeMessageBody } from './messages.js';
import { readJsonBody, sendJson } from './response.js';
import { isSafeId } from './routes.js';
import { getVisitorToken } from './security.js';
import type { LocalStorageAdapter } from './storage/localStorage.js';
import type { WebSocketHub } from './websocket.js';

export async function handleCreateVisitorSession(request: IncomingMessage, response: ServerResponse, db: PostgresAdapter) {
  const body = await readJsonBody<Record<string, unknown>>(request);
  const result = await createVisitorSession(db, body);
  sendJson(response, 201, { ok: true, session: result.session, visitorToken: result.visitorToken });
}

export async function handleCreateVisitorAttachment(
  config: GenericServerConfig,
  request: IncomingMessage,
  response: ServerResponse,
  db: PostgresAdapter,
  storage: LocalStorageAdapter,
  hub: WebSocketHub,
  url: URL,
  sessionId: string,
) {
  if (!isSafeId(sessionId)) throw new HttpError(404, 'session_not_found');
  await requireVisitorSession(db, sessionId, getVisitorToken(request.headers), 'upload');
  const attachment = await createVisitorAttachment(config, db, storage, request, url, sessionId);
  hub.broadcastToSession(sessionId, {
    type: 'message_created',
    sessionId,
    message: {
      id: attachment.messageId,
      sessionId,
      senderType: 'visitor',
      senderId: null,
      body: null,
      messageType: 'attachment',
      readAt: null,
      createdAt: attachment.createdAt,
      clientMessageId: null,
      attachments: [attachment],
    },
  });
  sendJson(response, 201, { ok: true, attachment });
}

export async function handleVisitorAttachmentDownload(
  request: IncomingMessage,
  response: ServerResponse,
  config: GenericServerConfig,
  db: PostgresAdapter,
  storage: LocalStorageAdapter,
  sessionId: string,
  attachmentId: string,
) {
  if (!isSafeId(sessionId) || !isSafeId(attachmentId)) throw new HttpError(404, 'attachment_not_found');
  await requireVisitorSession(db, sessionId, getVisitorToken(request.headers), 'read');
  await sendVisitorAttachment(response, db, storage, config.encryption, sessionId, attachmentId);
}

export async function handleVisitorMessages(
  request: IncomingMessage,
  response: ServerResponse,
  config: GenericServerConfig,
  db: PostgresAdapter,
  hub: WebSocketHub,
  sessionId: string,
) {
  if (!isSafeId(sessionId)) throw new HttpError(404, 'session_not_found');
  const visitorToken = getVisitorToken(request.headers);
  await requireVisitorSession(db, sessionId, visitorToken, request.method === 'POST' ? 'write' : 'read');

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
      'visitor',
      normalizeMessageBody(body.body),
      visitorToken ? hashVisitorToken(visitorToken) : null,
      optionalString(body.clientMessageId) || optionalString(body.client_message_id),
    );
    if (!message.deduped) hub.broadcastToSession(sessionId, { type: 'message_created', sessionId, message });
    sendJson(response, message.deduped ? 200 : 201, { ok: true, deduped: Boolean(message.deduped), message });
    return;
  }

  throw new HttpError(405, 'method_not_allowed');
}

export async function handleVisitorRead(
  request: IncomingMessage,
  response: ServerResponse,
  db: PostgresAdapter,
  hub: WebSocketHub,
  sessionId: string,
) {
  if (!isSafeId(sessionId)) throw new HttpError(404, 'session_not_found');
  const visitorToken = getVisitorToken(request.headers);
  await requireVisitorSession(db, sessionId, visitorToken, 'read');
  const body = await readJsonBody<Record<string, unknown>>(request);
  const requested = Array.isArray(body.messageIds)
    ? body.messageIds.filter((id): id is string => typeof id === 'string')
    : undefined;
  const receipt = await markSessionMessagesRead(db, sessionId, 'visitor', requested);
  if (receipt.messageIds.length) hub.broadcastToSession(sessionId, { type: 'messages:read', sessionId, ...receipt });
  sendJson(response, 200, { ok: true, ...receipt });
}
