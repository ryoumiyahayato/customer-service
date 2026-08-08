import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { requireCurrentAdmin } from './auth.js';
import { requireAdminSessionAccess, requireVisitorSession, type ChatSessionSummary } from './chat.js';
import type { PostgresAdapter } from './db/postgres.js';
import type { ChatMessage } from './messages.js';
import { isSafeId } from './routes.js';
import { getAdminSessionToken, isSameOriginWebSocket, parseCookies } from './security.js';

const VISITOR_COOKIE_NAME = 'support_visitor';
const MAX_WEBSOCKET_MESSAGE_BYTES = 16 * 1024;
const HEARTBEAT_INTERVAL_MS = 30 * 1000;

export type WebSocketBroadcast<TMessage extends object = ChatMessage> =
  | {
      type: 'message_created';
      sessionId: string;
      message: TMessage;
    }
  | {
      type: 'messages:read';
      sessionId: string;
      messageIds: string[];
      readAt: string | null;
    }
  | {
      type: 'session_closed';
      sessionId: string;
      session: ChatSessionSummary;
    };

export type WebSocketHub = {
  handleUpgrade: (request: IncomingMessage, socket: Duplex, head: Buffer) => Promise<void>;
  broadcastToSession: <TMessage extends object = ChatMessage>(
    sessionId: string,
    event: WebSocketBroadcast<TMessage>,
  ) => void;
  subscriberCount: (sessionId: string) => number;
};

type SocketAuth =
  | { kind: 'admin'; token: string; sessionId?: string }
  | { kind: 'visitor'; token: string; sessionId: string };

type ClientState = {
  room: string;
  alive: boolean;
  auth: SocketAuth;
};

type UpgradeBinding = {
  room: string;
  auth: SocketAuth;
};

export function createBroadcastPayload<TMessage extends object>(event: WebSocketBroadcast<TMessage>): string {
  return JSON.stringify(event);
}

function errorStatus(error: unknown) {
  if (!error || typeof error !== 'object') return 0;
  const candidate = error as { status?: unknown; statusCode?: unknown };
  return Number(candidate.status || candidate.statusCode || 0);
}

function rejectUpgrade(socket: Duplex, status: 401 | 403 | 404) {
  const reason = status === 401 ? 'Unauthorized' : status === 403 ? 'Forbidden' : 'Not Found';
  if (socket.destroyed) return;
  socket.write(
    `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\nCache-Control: no-store\r\n\r\n`,
  );
  socket.destroy();
}

function visitorCookieToken(request: IncomingMessage): string | null {
  return parseCookies(request.headers.cookie).get(VISITOR_COOKIE_NAME) || null;
}

async function authenticateUpgrade(db: PostgresAdapter, request: IncomingMessage): Promise<UpgradeBinding | null> {
  if (!isSameOriginWebSocket(request)) throw Object.assign(new Error('forbidden'), { status: 403 });
  const host = request.headers.host || 'localhost';
  const url = new URL(request.url || '/', `http://${host}`);

  if (url.pathname === '/api/ws/admin' || url.pathname === '/api/ws/staff') {
    const token = getAdminSessionToken(request.headers.cookie);
    if (!token) throw Object.assign(new Error('unauthenticated'), { status: 401 });
    await requireCurrentAdmin(db, token);
    return { room: url.pathname === '/api/ws/admin' ? 'admin-feed' : 'staff', auth: { kind: 'admin', token } };
  }

  const conversation = /^\/api\/ws\/conversations\/([^/]+)$/.exec(url.pathname);
  if (!conversation) return null;

  const sessionId = decodeURIComponent(conversation[1]);
  if (!isSafeId(sessionId)) return null;

  const adminToken = getAdminSessionToken(request.headers.cookie);
  if (adminToken) {
    const admin = await requireCurrentAdmin(db, adminToken);
    await requireAdminSessionAccess(db, admin, sessionId);
    return { room: sessionId, auth: { kind: 'admin', token: adminToken, sessionId } };
  }

  const visitorToken = visitorCookieToken(request);
  if (!visitorToken) throw Object.assign(new Error('unauthenticated'), { status: 401 });
  await requireVisitorSession(db, sessionId, visitorToken);
  return { room: sessionId, auth: { kind: 'visitor', token: visitorToken, sessionId } };
}

function sanitizeVisitorBroadcastPayload(payload: string) {
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return payload;
    const message = parsed.message;
    if (message && typeof message === 'object' && !Array.isArray(message)) {
      parsed.message = { ...(message as Record<string, unknown>), senderId: null, sender_id: null };
    }
    const session = parsed.session;
    if (session && typeof session === 'object' && !Array.isArray(session)) {
      const source = session as Record<string, unknown>;
      parsed.session = {
        id: source.id,
        status: source.status,
        createdAt: source.createdAt,
        updatedAt: source.updatedAt,
        closedAt: source.closedAt,
        archivedAt: source.archivedAt,
        deletedAt: source.deletedAt,
        historyClearedAt: source.historyClearedAt,
      };
    }
    return JSON.stringify(parsed);
  } catch {
    return payload;
  }
}

export function createWebSocketHub(db: PostgresAdapter): WebSocketHub {
  const server = new WebSocketServer({ noServer: true, maxPayload: MAX_WEBSOCKET_MESSAGE_BYTES });
  const subscribers = new Map<string, Set<WebSocket>>();
  const states = new WeakMap<WebSocket, ClientState>();

  function unsubscribe(socket: WebSocket) {
    const state = states.get(socket);
    if (!state) return;
    const set = subscribers.get(state.room);
    set?.delete(socket);
    if (set && set.size === 0) subscribers.delete(state.room);
    states.delete(socket);
  }

  async function remainsAuthorized(state: ClientState) {
    try {
      if (state.auth.kind === 'admin') {
        const admin = await requireCurrentAdmin(db, state.auth.token);
        if (state.auth.sessionId) await requireAdminSessionAccess(db, admin, state.auth.sessionId);
        return true;
      }
      await requireVisitorSession(db, state.auth.sessionId, state.auth.token);
      return true;
    } catch {
      return false;
    }
  }

  function closeRevoked(socket: WebSocket) {
    try { socket.close(1008, 'access_revoked'); } catch { socket.terminate(); }
  }

  function bindAuthenticatedSocket(socket: WebSocket, binding: UpgradeBinding) {
    let set = subscribers.get(binding.room);
    if (!set) {
      set = new Set<WebSocket>();
      subscribers.set(binding.room, set);
    }
    set.add(socket);
    states.set(socket, { room: binding.room, alive: true, auth: binding.auth });

    socket.on('pong', () => {
      const state = states.get(socket);
      if (state) state.alive = true;
    });

    socket.on('message', () => {
      socket.close(1008, 'client_messages_not_supported');
    });

    socket.on('close', () => unsubscribe(socket));
    socket.on('error', () => unsubscribe(socket));
  }

  const heartbeat = setInterval(() => {
    for (const set of subscribers.values()) {
      for (const socket of set) {
        const state = states.get(socket);
        if (!state || socket.readyState !== WebSocket.OPEN) continue;
        if (!state.alive) {
          socket.terminate();
          continue;
        }
        void remainsAuthorized(state).then((allowed) => {
          if (!allowed && socket.readyState === WebSocket.OPEN) closeRevoked(socket);
        });
        state.alive = false;
        socket.ping();
      }
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();

  return {
    async handleUpgrade(request, socket, head) {
      try {
        const binding = await authenticateUpgrade(db, request);
        if (!binding) {
          rejectUpgrade(socket, 404);
          return;
        }
        server.handleUpgrade(request, socket, head, (websocket) => {
          bindAuthenticatedSocket(websocket, binding);
        });
      } catch (error) {
        const status = errorStatus(error);
        rejectUpgrade(socket, status === 401 ? 401 : status === 404 ? 404 : 403);
      }
    },
    broadcastToSession(sessionId, event) {
      const payload = createBroadcastPayload(event);
      for (const socket of subscribers.get(sessionId) || []) {
        const state = states.get(socket);
        if (!state || socket.readyState !== WebSocket.OPEN) continue;
        void remainsAuthorized(state).then((allowed) => {
          if (!allowed) {
            if (socket.readyState === WebSocket.OPEN) closeRevoked(socket);
            return;
          }
          if (socket.readyState !== WebSocket.OPEN) return;
          socket.send(state.auth.kind === 'visitor' ? sanitizeVisitorBroadcastPayload(payload) : payload);
        });
      }
    },
    subscriberCount(sessionId) {
      return subscribers.get(sessionId)?.size || 0;
    },
  };
}
