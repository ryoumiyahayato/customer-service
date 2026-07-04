import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import type { ChatSessionSummary } from './chat.js';
import type { ChatMessage } from './messages.js';
import { isSafeId } from './routes.js';

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
  handleUpgrade: (request: IncomingMessage, socket: Duplex, head: Buffer) => void;
  broadcastToSession: (sessionId: string, event: WebSocketBroadcast) => void;
  subscriberCount: (sessionId: string) => number;
};

type ClientState = {
  sessionId: string | null;
};

export function createBroadcastPayload(event: WebSocketBroadcast): string {
  return JSON.stringify(event);
}

function rawDataToBuffer(raw: RawData): Buffer {
  if (Buffer.isBuffer(raw)) return raw;
  if (Array.isArray(raw)) return Buffer.concat(raw);
  return Buffer.from(raw);
}

export function createWebSocketHub(): WebSocketHub {
  const server = new WebSocketServer({ noServer: true });
  const subscribers = new Map<string, Set<WebSocket>>();
  const states = new WeakMap<WebSocket, ClientState>();

  function unsubscribe(socket: WebSocket) {
    const state = states.get(socket);
    if (!state?.sessionId) return;
    const set = subscribers.get(state.sessionId);
    set?.delete(socket);
    if (set && set.size === 0) subscribers.delete(state.sessionId);
    state.sessionId = null;
  }

  function subscribe(socket: WebSocket, sessionId: string) {
    unsubscribe(socket);
    let set = subscribers.get(sessionId);
    if (!set) {
      set = new Set<WebSocket>();
      subscribers.set(sessionId, set);
    }
    set.add(socket);
    states.set(socket, { sessionId });
    socket.send(JSON.stringify({ type: 'subscribed', sessionId }));
  }

  server.on('connection', (socket) => {
    states.set(socket, { sessionId: null });

    socket.on('message', (raw) => {
      const buffer = rawDataToBuffer(raw);
      if (buffer.length > 16 * 1024) {
        socket.close(1009, 'message_too_large');
        return;
      }

      try {
        const payload = JSON.parse(buffer.toString('utf8')) as { type?: unknown; sessionId?: unknown };
        if (payload.type === 'subscribe' && typeof payload.sessionId === 'string' && isSafeId(payload.sessionId)) {
          subscribe(socket, payload.sessionId);
          return;
        }
        socket.send(JSON.stringify({ type: 'error', error: 'unsupported_message' }));
      } catch {
        socket.send(JSON.stringify({ type: 'error', error: 'invalid_json' }));
      }
    });

    socket.on('close', () => {
      unsubscribe(socket);
      states.delete(socket);
    });
  });

  return {
    handleUpgrade(request, socket, head) {
      server.handleUpgrade(request, socket, head, (websocket) => {
        server.emit('connection', websocket, request);
      });
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
