import type { IncomingMessage, ServerResponse } from 'node:http';
import type { GenericServerConfig } from './config.js';
import { createVisitorAttachment, sendVisitorAttachment } from './attachments.js';
import { createVisitorSession, requireVisitorSession } from './chat.js';
import type { PostgresAdapter } from './db/postgres.js';
import { HttpError } from './http.js';
import { createSessionMessage, listSessionMessages, normalizeMessageBody } from './messages.js';
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
  await requireVisitorSession(db, sessionId, getVisitorToken(request.headers));
  const attachment = await createVisitorAttachment(config, db, storage, request, url, sessionId);
  hub.broadcastToSession(sessionId, {
    type: 'message_created',
    sessionId,
    message: {
      id: attachment.messageId,
      sessionId,
      senderType: 'visitor',
      body: null,
      messageType: 'attachment',
      readAt: null,
      createdAt: attachment.createdAt,
      attachments: [attachment],
    },
  });
  sendJson(response, 201, { ok: true, attachment });
}

export async function handleVisitorAttachmentDownload(
  request: IncomingMessage,
  response: ServerResponse,
  db: PostgresAdapter,
  storage: LocalStorageAdapter,
  sessionId: string,
  attachmentId: string,
) {
  if (!isSafeId(sessionId) || !isSafeId(attachmentId)) throw new HttpError(404, 'attachment_not_found');
  await requireVisitorSession(db, sessionId, getVisitorToken(request.headers));
  await sendVisitorAttachment(response, db, storage, sessionId, attachmentId);
}

export async function handleVisitorMessages(
  request: IncomingMessage,
  response: ServerResponse,
  db: PostgresAdapter,
  hub: WebSocketHub,
  sessionId: string,
) {
  if (!isSafeId(sessionId)) throw new HttpError(404, 'session_not_found');
  await requireVisitorSession(db, sessionId, getVisitorToken(request.headers));

  if (request.method === 'GET') {
    const messages = await listSessionMessages(db, sessionId);
    sendJson(response, 200, { ok: true, messages });
    return;
  }

  if (request.method === 'POST') {
    const body = await readJsonBody<Record<string, unknown>>(request);
    const message = await createSessionMessage(db, sessionId, 'visitor', normalizeMessageBody(body.body));
    hub.broadcastToSession(sessionId, { type: 'message_created', sessionId, message });
    sendJson(response, 201, { ok: true, message });
    return;
  }

  throw new HttpError(405, 'method_not_allowed');
}
