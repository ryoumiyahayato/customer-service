import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { requireCurrentAdmin } from './auth.js';
import { requireAdminSessionAccess, requireVisitorSession, type ChatSessionSummary } from './chat.js';
import type { PostgresAdapter } from './db/postgres.js';
import type { ChatMessage } from './messages.js';
import { isSafeId } from './routes.js';
import { getAdminSessionToken, isSameOriginWebSocket, parseCookies } from './security.js';
import { RESOURCE_LIMITS } from './resourceLimits.js';

const VISITOR_COOKIE_NAME = 'support_visitor';
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
  | { kind: 'admin'; token: string; principalId: string; authSessionId: string; sessionId?: string }
  | { kind: 'visitor'; token: string; principalId: string; authSessionId: string; sessionId: string };

type ClientState = {
  room: string;
  alive: boolean;
  auth: SocketAuth;
  connectedAt: number;
  lastActivityAt: number;
  pingWindowStartedAt: number;
  pingCount: number;
};

type UpgradeBinding = {
  room: string;
  auth: SocketAuth;
};

type UpgradeBucket = { count: number; resetAt: number };

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
    const admin = await requireCurrentAdmin(db, token);
    return {
      room: url.pathname === '/api/ws/admin' ? 'admin-feed' : 'staff',
      auth: { kind: 'admin', token, principalId: admin.id, authSessionId: token },
    };
  }

  const conversation = /^\/api\/ws\/conversations\/([^/]+)$/.exec(url.pathname);
  if (!conversation) return null;

  const sessionId = decodeURIComponent(conversation[1]);
  if (!isSafeId(sessionId)) return null;

  const adminToken = getAdminSessionToken(request.headers.cookie);
  if (adminToken) {
    const admin = await requireCurrentAdmin(db, adminToken);
    await requireAdminSessionAccess(db, admin, sessionId);
    return {
      room: sessionId,
      auth: { kind: 'admin', token: adminToken, principalId: admin.id, authSessionId: adminToken, sessionId },
    };
  }

  const visitorToken = visitorCookieToken(request);
  if (!visitorToken) throw Object.assign(new Error('unauthenticated'), { status: 401 });
  await requireVisitorSession(db, sessionId, visitorToken, 'socket');
  return {
    room: sessionId,
    auth: { kind: 'visitor', token: visitorToken, principalId: visitorToken, authSessionId: visitorToken, sessionId },
  };
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
  const server = new WebSocketServer({ noServer: true, maxPayload: RESOURCE_LIMITS.websocketMaxFrameBytes });
  const subscribers = new Map<string, Set<WebSocket>>();
  const states = new Map<WebSocket, ClientState>();
  const upgradeBuckets = new Map<string, UpgradeBucket>();

  function clientIp(request: IncomingMessage) {
    return String(request.socket.remoteAddress || 'unknown').slice(0, 120);
  }

  function upgradeAllowed(request: IncomingMessage) {
    const now = Date.now();
    const ip = clientIp(request);
    for (const [key, bucket] of upgradeBuckets) {
      if (bucket.resetAt <= now) upgradeBuckets.delete(key);
    }
    if (upgradeBuckets.size >= RESOURCE_LIMITS.websocketMaxUpgradeBuckets && !upgradeBuckets.has(ip)) return false;
    const current = upgradeBuckets.get(ip);
    const bucket = !current || current.resetAt <= now
      ? { count: 0, resetAt: now + RESOURCE_LIMITS.websocketUpgradeWindowMs }
      : current;
    if (bucket.count >= RESOURCE_LIMITS.websocketUpgradeLimit) return false;
    bucket.count += 1;
    upgradeBuckets.set(ip, bucket);
    return true;
  }

  function connectionAllowed(binding: UpgradeBinding) {
    const current = [...states.values()];
    if (current.filter((state) => state.room === binding.room).length >= RESOURCE_LIMITS.websocketMaxConnectionsPerRoom) return false;
    if (current.filter((state) => state.auth.principalId === binding.auth.principalId).length >= RESOURCE_LIMITS.websocketMaxConnectionsPerPrincipal) return false;
    if (current.filter((state) => state.auth.authSessionId === binding.auth.authSessionId).length >= RESOURCE_LIMITS.websocketMaxConnectionsPerAuthSession) return false;
    if (binding.auth.sessionId
      && current.filter((state) => state.auth.sessionId === binding.auth.sessionId).length >= RESOURCE_LIMITS.websocketMaxConnectionsPerConversation) return false;
    return true;
  }

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
      await requireVisitorSession(db, state.auth.sessionId, state.auth.token, 'socket');
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
    const timestamp = Date.now();
    states.set(socket, {
      room: binding.room,
      alive: true,
      auth: binding.auth,
      connectedAt: timestamp,
      lastActivityAt: timestamp,
      pingWindowStartedAt: timestamp,
      pingCount: 0,
    });

    socket.on('pong', () => {
      const state = states.get(socket);
      if (state) {
        state.alive = true;
        state.lastActivityAt = Date.now();
      }
    });

    socket.on('message', (data, isBinary) => {
      const state = states.get(socket);
      if (!state) return;
      const bytes = Buffer.isBuffer(data) ? data.byteLength : Buffer.byteLength(String(data));
      if (bytes > RESOURCE_LIMITS.websocketMaxFrameBytes) {
        socket.close(1009, 'message_too_large');
        return;
      }
      state.lastActivityAt = Date.now();
      if (isBinary) {
        socket.close(1003, 'binary_not_allowed');
        return;
      }
      let event: unknown;
      try { event = JSON.parse(String(data)); } catch {
        socket.close(1003, 'invalid_json');
        return;
      }
      if (!event || typeof event !== 'object' || (event as { type?: unknown }).type !== 'ping') {
        socket.close(1008, 'event_not_allowed');
        return;
      }
      const now = Date.now();
      if (now - state.pingWindowStartedAt >= 60 * 1000) {
        state.pingWindowStartedAt = now;
        state.pingCount = 0;
      }
      if (state.pingCount >= 20) {
        socket.close(1008, 'ping_rate_limited');
        return;
      }
      state.pingCount += 1;
      socket.send(JSON.stringify({ type: 'pong', ts: now }));
    });

    socket.on('close', () => unsubscribe(socket));
    socket.on('error', () => unsubscribe(socket));
  }

  const heartbeat = setInterval(() => {
    for (const set of subscribers.values()) {
      for (const socket of set) {
        const state = states.get(socket);
        if (!state || socket.readyState !== WebSocket.OPEN) continue;
        const now = Date.now();
        if (now - state.connectedAt > RESOURCE_LIMITS.websocketMaxLifetimeMs
          || now - state.lastActivityAt > RESOURCE_LIMITS.websocketIdleTimeoutMs) {
          closeRevoked(socket);
          continue;
        }
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
        if (!upgradeAllowed(request)) {
          rejectUpgrade(socket, 403);
          return;
        }
        const binding = await authenticateUpgrade(db, request);
        if (!binding) {
          rejectUpgrade(socket, 404);
          return;
        }
        if (!connectionAllowed(binding)) {
          rejectUpgrade(socket, 403);
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
