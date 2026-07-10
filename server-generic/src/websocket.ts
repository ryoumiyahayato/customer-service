import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { requireCurrentAdmin } from './auth.js';
import { requireAdminSessionExists, requireVisitorSession, type ChatSessionSummary } from './chat.js';
import type { PostgresAdapter } from './db/postgres.js';
import type { ChatMessage } from './messages.js';
import { isSafeId } from './routes.js';
import { getAdminSessionToken, parseCookies } from './security.js';

const VISITOR_COOKIE_NAME = 'support_visitor';
const MAX_WEBSOCKET_MESSAGE_BYTES = 16 * 1024;
const HEARTBEAT_INTERVAL_MS = 30 * 1000;

export type WebSocketBroadcast =
  | {
      type: 'message_created';
      sessionId: string;
      message: ChatMessage;
    }
  | {
      type: 'session_closed';
      sessionId: string;
      session: ChatSessionSummary;
    };

export type WebSocketHub = {
  handleUpgrade: (request: IncomingMessage, socket: Duplex, head: Buffer) => Promise<void>;
  broadcastToSession: (sessionId: string, event: WebSocketBroadcast) => void;
  subscriberCount: (sessionId: string) => number;
};

type ClientState = {
  room: string;
  alive: boolean;
};

type UpgradeBinding = {
  room: string;
};

export function createBroadcastPayload(event: WebSocketBroadcast): string {
  return JSON.stringify(event);
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
  const host = request.headers.host || 'localhost';
  const url = new URL(request.url || '/', `http://${host}`);

  if (url.pathname === '/api/ws/admin' || url.pathname === '/api/ws/staff') {
    await requireCurrentAdmin(db, getAdminSessionToken(request.headers.cookie));
    return { room: url.pathname === '/api/ws/admin' ? 'admin-feed' : 'staff' };
  }

  const conversation = /^\/api\/ws\/conversations\/([^/]+)$/.exec(url.pathname);
  if (!conversation) return null;

  const sessionId = decodeURIComponent(conversation[1]);
  if (!isSafeId(sessionId)) return null;

  const adminToken = getAdminSessionToken(request.headers.cookie);
  if (adminToken) {
    await requireCurrentAdmin(db, adminToken);
    await requireAdminSessionExists(db, sessionId);
    return { room: sessionId };
  }

  await requireVisitorSession(db, sessionId, visitorCookieToken(request));
  return { room: sessionId };
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

  function bindAuthenticatedSocket(socket: WebSocket, room: string) {
    let set = subscribers.get(room);
    if (!set) {
      set = new Set<WebSocket>();
      subscribers.set(room, set);
    }
    set.add(socket);
    states.set(socket, { room, alive: true });

    socket.on('pong', () => {
      const state = states.get(socket);
      if (state) state.alive = true;
    });

    socket.on('message', () => {
      // The URL and authenticated cookie bind the connection to exactly one room.
      // Client-driven subscribe/switch messages are intentionally unsupported.
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
          bindAuthenticatedSocket(websocket, binding.room);
        });
      } catch (error: any) {
        const status = Number(error?.status || error?.statusCode || 0);
        rejectUpgrade(socket, status === 401 ? 401 : status === 404 ? 404 : 403);
      }
    },
    broadcastToSession(sessionId, event) {
      const payload = createBroadcastPayload(event);
      for (const socket of subscribers.get(sessionId) || []) {
        if (socket.readyState === WebSocket.OPEN) socket.send(payload);
      }
    },
    subscriberCount(sessionId) {
      return subscribers.get(sessionId)?.size || 0;
    },
  };
}
