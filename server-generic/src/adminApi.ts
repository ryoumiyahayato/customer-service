import type { IncomingMessage, ServerResponse } from 'node:http';
import { requireCurrentAdmin } from './auth.js';
import { closeChatSession, listAdminChatSessions, requireAdminSessionExists } from './chat.js';
import type { PostgresAdapter } from './db/postgres.js';
import { HttpError } from './http.js';
import { createSessionMessage, listSessionMessages, normalizeMessageBody } from './messages.js';
import { readJsonBody, sendJson } from './response.js';
import { isSafeId } from './routes.js';
import { getAdminSessionToken } from './security.js';
import type { WebSocketHub } from './websocket.js';

async function authenticatedAdmin(request: IncomingMessage, db: PostgresAdapter) {
  return requireCurrentAdmin(db, getAdminSessionToken(request.headers.cookie));
}

export async function handleListAdminSessions(request: IncomingMessage, response: ServerResponse, db: PostgresAdapter) {
  await authenticatedAdmin(request, db);
  const sessions = await listAdminChatSessions(db);
  sendJson(response, 200, { ok: true, sessions });
}

export async function handleAdminMessages(
  request: IncomingMessage,
  response: ServerResponse,
  db: PostgresAdapter,
  hub: WebSocketHub,
  sessionId: string,
) {
  if (!isSafeId(sessionId)) throw new HttpError(404, 'session_not_found');
  const admin = await authenticatedAdmin(request, db);
  await requireAdminSessionExists(db, sessionId);

  if (request.method === 'GET') {
    const messages = await listSessionMessages(db, sessionId);
    sendJson(response, 200, { ok: true, messages });
    return;
  }

  if (request.method === 'POST') {
    const body = await readJsonBody<Record<string, unknown>>(request);
    const message = await createSessionMessage(db, sessionId, 'admin', normalizeMessageBody(body.body), admin.id);
    hub.broadcastToSession(sessionId, { type: 'message_created', sessionId, message });
    sendJson(response, 201, { ok: true, message });
    return;
  }

  throw new HttpError(405, 'method_not_allowed');
}

export async function handleCloseAdminSession(
  request: IncomingMessage,
  response: ServerResponse,
  db: PostgresAdapter,
  hub: WebSocketHub,
  sessionId: string,
) {
  if (!isSafeId(sessionId)) throw new HttpError(404, 'session_not_found');
  await authenticatedAdmin(request, db);
  const session = await closeChatSession(db, sessionId);
  hub.broadcastToSession(sessionId, { type: 'session_closed', sessionId, session });
  sendJson(response, 200, { ok: true, session });
}
