export const CHAT_ROOM_SESSION_HEADER = 'x-chat-room-session-id';
export const CHAT_ROOM_PRINCIPAL_TYPE_HEADER = 'x-chat-room-principal-type';
export const CHAT_ROOM_PRINCIPAL_ID_HEADER = 'x-chat-room-principal-id';
export const CHAT_ROOM_AUTH_SESSION_HEADER = 'x-chat-room-auth-session-id';

type ConversationPrincipalType = 'admin' | 'guest';

type ConnectionMeta = {
  mode: 'room';
} | {
  mode: 'conversation';
  sessionId: string;
  principalType: ConversationPrincipalType;
  principalId: string;
  authSessionId: string;
};

type ChatRoomEnv = {
  DB: D1Database;
};

function headerValue(req: Request, name: string) {
  const value = req.headers.get(name)?.trim() || '';
  return value && value.length <= 200 ? value : '';
}

function connectionMeta(req: Request): ConnectionMeta | null {
  const sessionId = headerValue(req, CHAT_ROOM_SESSION_HEADER);
  if (!sessionId) return { mode: 'room' };

  const principalType = headerValue(req, CHAT_ROOM_PRINCIPAL_TYPE_HEADER);
  const principalId = headerValue(req, CHAT_ROOM_PRINCIPAL_ID_HEADER);
  const authSessionId = headerValue(req, CHAT_ROOM_AUTH_SESSION_HEADER);
  if ((principalType !== 'admin' && principalType !== 'guest') || !principalId || !authSessionId) return null;
  return { mode: 'conversation', sessionId, principalType, principalId, authSessionId };
}

function conversationSessionId(room: string) {
  const prefix = 'conversation:';
  if (!room.startsWith(prefix)) return '';
  return room.slice(prefix.length).trim();
}

export function withConversationRoomAccess(
  req: Request,
  sessionId: string,
  principalType: ConversationPrincipalType,
  principalId: string,
  authSessionId: string,
) {
  const headers = new Headers(req.headers);
  headers.set(CHAT_ROOM_SESSION_HEADER, sessionId);
  headers.set(CHAT_ROOM_PRINCIPAL_TYPE_HEADER, principalType);
  headers.set(CHAT_ROOM_PRINCIPAL_ID_HEADER, principalId);
  headers.set(CHAT_ROOM_AUTH_SESSION_HEADER, authSessionId);
  return new Request(req, { headers });
}

export function createChatRoomBroadcastRequest(room: string, payload: unknown) {
  const headers = new Headers({ 'content-type': 'application/json' });
  const sessionId = conversationSessionId(room);
  if (sessionId) headers.set(CHAT_ROOM_SESSION_HEADER, sessionId);
  return new Request('https://room/broadcast', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
}

export class ChatRoom {
  constructor(private state: DurableObjectState, private env: ChatRoomEnv) {}

  async fetch(req: Request) {
    const url = new URL(req.url);
    if (url.pathname === '/broadcast') {
      if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
      }
      const payload = await req.text();
      const protectedSessionId = headerValue(req, CHAT_ROOM_SESSION_HEADER);
      await this.sendToSockets(payload, protectedSessionId);
      return new Response('ok');
    }

    if (req.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const meta = connectionMeta(req);
    if (!meta) return new Response('Invalid room authorization', { status: 400 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.state.acceptWebSocket(server);
    server.serializeAttachment(meta);
    server.send(JSON.stringify({ type: 'connected', ts: Date.now() }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string') return;

    try {
      const data = JSON.parse(message);
      if (data?.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
      }
    } catch {
      ws.send(JSON.stringify({ type: 'error', error: 'Invalid JSON message' }));
    }
  }

  async webSocketClose() {}

  async webSocketError() {}

  private async canReceive(meta: ConnectionMeta | null, sessionId: string) {
    if (!meta || meta.mode !== 'conversation' || meta.sessionId !== sessionId) return false;

    if (meta.principalType === 'admin') {
      const allowed = await this.env.DB.prepare(
        `SELECT 1 AS allowed
           FROM sessions s
           JOIN admins a ON a.id=?
           JOIN admin_sessions auth ON auth.id=? AND auth.admin_id=a.id
          WHERE s.id=?
            AND COALESCE(a.is_disabled,0)=0
            AND auth.revoked_at IS NULL
            AND datetime(auth.expires_at)>datetime('now')
            AND datetime(auth.created_at)>datetime('now','-1 day')
            AND datetime(COALESCE(auth.last_seen_at,auth.created_at))>datetime('now','-30 minutes')
            AND (a.role='SUPER_ADMIN' OR (a.role='OPERATOR' AND s.assigned_operator_id=a.id))
          LIMIT 1`,
      ).bind(meta.principalId, meta.authSessionId, sessionId).first<{ allowed: number }>();
      return Boolean(allowed?.allowed);
    }

    const allowed = await this.env.DB.prepare(
      `SELECT 1 AS allowed
         FROM sessions s
         JOIN users u ON u.id=s.user_id
         JOIN visitor_sessions auth ON auth.id=? AND auth.visitor_key=u.visitor_key
        WHERE s.id=?
          AND s.user_id=?
          AND auth.revoked_at IS NULL
          AND datetime(auth.expires_at)>datetime('now')
        LIMIT 1`,
    ).bind(meta.authSessionId, sessionId, meta.principalId).first<{ allowed: number }>();
    return Boolean(allowed?.allowed);
  }

  private async sendToSockets(payload: string, protectedSessionId: string) {
    await Promise.all(this.state.getWebSockets().map(async (socket) => {
      if (protectedSessionId) {
        let allowed = false;
        try {
          allowed = await this.canReceive(
            socket.deserializeAttachment() as ConnectionMeta | null,
            protectedSessionId,
          );
        } catch (error) {
          console.error('Conversation socket authorization failed', error);
        }
        if (!allowed) {
          try {
            socket.close(1008, 'Session access revoked');
          } catch {}
          return;
        }
      }
      try {
        socket.send(payload);
      } catch {}
    }));
  }
}
