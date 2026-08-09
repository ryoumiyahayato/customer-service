import { RESOURCE_LIMITS } from '../security/resourceLimits';

export const CHAT_ROOM_SESSION_HEADER = 'x-chat-room-session-id';
export const CHAT_ROOM_PRINCIPAL_TYPE_HEADER = 'x-chat-room-principal-type';
export const CHAT_ROOM_PRINCIPAL_ID_HEADER = 'x-chat-room-principal-id';
export const CHAT_ROOM_AUTH_SESSION_HEADER = 'x-chat-room-auth-session-id';
export const CHAT_ROOM_STAFF_PRINCIPAL_HEADER = 'x-chat-room-staff-principal-id';
export const CHAT_ROOM_STAFF_AUTH_SESSION_HEADER = 'x-chat-room-staff-auth-session-id';
export const CHAT_ROOM_STAFF_BROADCAST_HEADER = 'x-chat-room-staff-broadcast';
export const CHAT_ROOM_ADMIN_FEED_PRINCIPAL_HEADER = 'x-chat-room-admin-feed-principal-id';
export const CHAT_ROOM_ADMIN_FEED_AUTH_SESSION_HEADER = 'x-chat-room-admin-feed-auth-session-id';
export const CHAT_ROOM_ADMIN_FEED_BROADCAST_HEADER = 'x-chat-room-admin-feed-broadcast';

type ConversationPrincipalType = 'admin' | 'guest';

type ConnectionMeta = {
  mode: 'room';
} | {
  mode: 'staff';
  principalId: string;
  authSessionId: string;
} | {
  mode: 'admin-feed';
  principalId: string;
  authSessionId: string;
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

type StaffAccessRow = {
  role: string;
  can_use_staff_chat: number | null;
};

function headerValue(req: Request, name: string) {
  const value = req.headers.get(name)?.trim() || '';
  return value && value.length <= 200 ? value : '';
}

function connectionMeta(req: Request): ConnectionMeta | null {
  const adminFeedPrincipalId = headerValue(req, CHAT_ROOM_ADMIN_FEED_PRINCIPAL_HEADER);
  const adminFeedAuthSessionId = headerValue(req, CHAT_ROOM_ADMIN_FEED_AUTH_SESSION_HEADER);
  if (adminFeedPrincipalId || adminFeedAuthSessionId) {
    if (!adminFeedPrincipalId || !adminFeedAuthSessionId) return null;
    return { mode: 'admin-feed', principalId: adminFeedPrincipalId, authSessionId: adminFeedAuthSessionId };
  }

  const staffPrincipalId = headerValue(req, CHAT_ROOM_STAFF_PRINCIPAL_HEADER);
  const staffAuthSessionId = headerValue(req, CHAT_ROOM_STAFF_AUTH_SESSION_HEADER);
  if (staffPrincipalId || staffAuthSessionId) {
    if (!staffPrincipalId || !staffAuthSessionId) return null;
    return { mode: 'staff', principalId: staffPrincipalId, authSessionId: staffAuthSessionId };
  }

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

function safeGuestMessage(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const source = value as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  const keys = [
    'id', 'session_id', 'sessionId', 'sender_type', 'senderType', 'content', 'body',
    'message_type', 'messageType', 'image_path', 'imagePath', 'status', 'created_at',
    'createdAt', 'read_at', 'readAt', 'is_read', 'isRead', 'quote_message_id',
    'quoteMessageId', 'recalled_at', 'recalledAt', 'deleted_at', 'deletedAt',
    'image_purged_at', 'imagePurgedAt', 'client_message_id', 'clientMessageId',
    'attachments', 'deduped',
  ];
  for (const key of keys) if (key in source) safe[key] = source[key];
  if ('sender_id' in source) safe.sender_id = null;
  if ('senderId' in source) safe.senderId = null;
  return safe;
}

function safeGuestSession(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const source = value as Record<string, unknown>;
  const safe: Record<string, unknown> = { unread_count: 0 };
  for (const key of ['id', 'status', 'created_at', 'createdAt', 'updated_at', 'updatedAt', 'history_cleared_at', 'historyClearedAt']) {
    if (key in source) safe[key] = source[key];
  }
  return safe;
}

export function sanitizeGuestSocketPayload(payload: string) {
  try {
    const value = JSON.parse(payload) as Record<string, unknown>;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return payload;
    const safe = { ...value };
    if ('message' in safe) safe.message = safeGuestMessage(safe.message);
    if ('session' in safe) safe.session = safeGuestSession(safe.session);
    if (Array.isArray(safe.messages)) safe.messages = safe.messages.map(safeGuestMessage);
    return JSON.stringify(safe);
  } catch {
    return payload;
  }
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

export function withStaffRoomAccess(req: Request, principalId: string, authSessionId: string) {
  const headers = new Headers(req.headers);
  headers.set(CHAT_ROOM_STAFF_PRINCIPAL_HEADER, principalId);
  headers.set(CHAT_ROOM_STAFF_AUTH_SESSION_HEADER, authSessionId);
  return new Request(req, { headers });
}

export function withAdminFeedAccess(req: Request, principalId: string, authSessionId: string) {
  const headers = new Headers(req.headers);
  headers.set(CHAT_ROOM_ADMIN_FEED_PRINCIPAL_HEADER, principalId);
  headers.set(CHAT_ROOM_ADMIN_FEED_AUTH_SESSION_HEADER, authSessionId);
  return new Request(req, { headers });
}

export function createChatRoomBroadcastRequest(room: string, payload: unknown) {
  const headers = new Headers({ 'content-type': 'application/json' });
  const sessionId = conversationSessionId(room);
  if (sessionId) headers.set(CHAT_ROOM_SESSION_HEADER, sessionId);
  if (room === 'staff') headers.set(CHAT_ROOM_STAFF_BROADCAST_HEADER, '1');
  if (room === 'admin-feed') headers.set(CHAT_ROOM_ADMIN_FEED_BROADCAST_HEADER, '1');
  return new Request('https://room/broadcast', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
}

export class ChatRoom {
  private readonly socketTimes = new Map<WebSocket, { connectedAt: number; lastActivityAt: number }>();
  private readonly pingWindows = new Map<WebSocket, { startedAt: number; count: number }>();

  constructor(private state: DurableObjectState, private env: ChatRoomEnv) {}

  private connectionAllowed(meta: ConnectionMeta) {
    const sockets = this.state.getWebSockets();
    if (sockets.length >= RESOURCE_LIMITS.websocket.maxConnectionsPerSharedRoom) return false;
    const principal = 'principalId' in meta ? meta.principalId : '';
    const authSessionId = 'authSessionId' in meta ? meta.authSessionId : '';
    const sessionId = meta.mode === 'conversation' ? meta.sessionId : '';
    const samePrincipal = sockets.filter((socket) => {
      const current = socket.deserializeAttachment() as ConnectionMeta | null;
      return Boolean(current && principal && 'principalId' in current && current.principalId === principal);
    }).length;
    const sameAuthSession = sockets.filter((socket) => {
      const current = socket.deserializeAttachment() as ConnectionMeta | null;
      return Boolean(current && authSessionId && 'authSessionId' in current && current.authSessionId === authSessionId);
    }).length;
    const sameConversation = sockets.filter((socket) => {
      const current = socket.deserializeAttachment() as ConnectionMeta | null;
      return Boolean(current && sessionId && current.mode === 'conversation' && current.sessionId === sessionId);
    }).length;
    if (samePrincipal >= RESOURCE_LIMITS.websocket.maxConnectionsPerPrincipal
      || sameAuthSession >= RESOURCE_LIMITS.websocket.maxConnectionsPerAuthSession
      || sameConversation >= RESOURCE_LIMITS.websocket.maxConnectionsPerConversation) return false;
    if ((meta.mode === 'admin-feed' || meta.mode === 'staff')
      && sockets.length >= RESOURCE_LIMITS.websocket.maxConnectionsPerSharedRoom) return false;
    return true;
  }

  private async scheduleSweep() {
    await this.state.storage.setAlarm(Date.now() + 30_000).catch(() => {});
  }

  async alarm() {
    const nowMs = Date.now();
    for (const socket of this.state.getWebSockets()) {
      const times = this.socketTimes.get(socket);
      if (!times || nowMs - times.connectedAt > RESOURCE_LIMITS.websocket.maxLifetimeMs
        || nowMs - times.lastActivityAt > RESOURCE_LIMITS.websocket.idleTimeoutMs) {
        try { socket.close(1000, 'connection_limit'); } catch {}
        this.socketTimes.delete(socket);
      }
    }
    if (this.state.getWebSockets().length) await this.scheduleSweep();
  }

  async fetch(req: Request) {
    const url = new URL(req.url);
    if (url.pathname === '/broadcast') {
      if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
      }
      const payload = await req.text();
      const protectedSessionId = headerValue(req, CHAT_ROOM_SESSION_HEADER);
      const protectStaff = headerValue(req, CHAT_ROOM_STAFF_BROADCAST_HEADER) === '1';
      const protectAdminFeed = headerValue(req, CHAT_ROOM_ADMIN_FEED_BROADCAST_HEADER) === '1';
      await this.sendToSockets(payload, protectedSessionId, protectStaff, protectAdminFeed);
      return new Response('ok');
    }

    if (req.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const meta = connectionMeta(req);
    if (!meta) return new Response('Invalid room authorization', { status: 400 });
    if (!this.connectionAllowed(meta)) return new Response('Connection limit exceeded', { status: 429 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.state.acceptWebSocket(server);
    server.serializeAttachment(meta);
    const timestamp = Date.now();
    this.socketTimes.set(server, { connectedAt: timestamp, lastActivityAt: timestamp });
    await this.scheduleSweep();
    server.send(JSON.stringify({ type: 'connected', ts: Date.now() }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const bytes = typeof message === 'string' ? new TextEncoder().encode(message).byteLength : message.byteLength;
    if (bytes > RESOURCE_LIMITS.websocket.maxFrameBytes) {
      try { ws.close(1009, 'message_too_large'); } catch {}
      return;
    }
    const times = this.socketTimes.get(ws);
    if (times) times.lastActivityAt = Date.now();
    if (typeof message !== 'string') return;

    try {
      const data = JSON.parse(message);
      if (data?.type === 'ping') {
        const current = this.pingWindows.get(ws) || { startedAt: Date.now(), count: 0 };
        const pingWindow = Date.now() - current.startedAt >= 60 * 1000
          ? { startedAt: Date.now(), count: 0 }
          : current;
        if (pingWindow.count >= RESOURCE_LIMITS.websocket.pingLimit) {
          try { ws.close(1008, 'ping_rate_limited'); } catch {}
          return;
        }
        pingWindow.count += 1;
        this.pingWindows.set(ws, pingWindow);
        ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
      } else {
        try { ws.close(1008, 'event_not_allowed'); } catch {}
      }
    } catch {
      try { ws.close(1003, 'invalid_json'); } catch {}
    }
  }

  async webSocketClose(ws: WebSocket) { this.socketTimes.delete(ws); this.pingWindows.delete(ws); }

  async webSocketError(ws: WebSocket) { this.socketTimes.delete(ws); this.pingWindows.delete(ws); }

  private async canReceiveStaff(meta: ConnectionMeta | null) {
    if (!meta || meta.mode !== 'staff') return false;
    const row = await this.env.DB.prepare(
      `SELECT a.role,p.can_use_staff_chat
         FROM admins a
         JOIN admin_sessions auth ON auth.id=? AND auth.admin_id=a.id
         LEFT JOIN operator_policies p ON p.admin_id=a.id
        WHERE a.id=?
          AND COALESCE(a.is_disabled,0)=0
          AND auth.revoked_at IS NULL
          AND datetime(auth.expires_at)>datetime('now')
          AND datetime(auth.created_at)>datetime('now','-1 day')
          AND datetime(COALESCE(auth.last_seen_at,auth.created_at))>datetime('now','-30 minutes')
        LIMIT 1`,
    ).bind(meta.authSessionId, meta.principalId).first<StaffAccessRow>();
    if (!row) return false;
    if (row.role === 'SUPER_ADMIN') return true;
    if (row.role !== 'OPERATOR') return false;
    return row.can_use_staff_chat === 1;
  }

  private async canReceiveAdminFeed(meta: ConnectionMeta | null) {
    if (!meta || meta.mode !== 'admin-feed') return false;
    const row = await this.env.DB.prepare(
      `SELECT 1 AS allowed
         FROM admins a
         JOIN admin_sessions auth ON auth.id=? AND auth.admin_id=a.id
        WHERE a.id=?
          AND COALESCE(a.is_disabled,0)=0
          AND auth.revoked_at IS NULL
          AND datetime(auth.expires_at)>datetime('now')
          AND datetime(auth.created_at)>datetime('now','-1 day')
          AND datetime(COALESCE(auth.last_seen_at,auth.created_at))>datetime('now','-30 minutes')
        LIMIT 1`,
    ).bind(meta.authSessionId, meta.principalId).first<{ allowed: number }>();
    return Boolean(row?.allowed);
  }

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

    const bindings = [meta.authSessionId, sessionId, meta.principalId];
    try {
      const allowed = await this.env.DB.prepare(
        `SELECT 1 AS allowed
           FROM sessions s
           JOIN users u ON u.id=s.user_id
           JOIN visitor_sessions auth ON auth.id=? AND auth.visitor_key=u.visitor_key
          WHERE s.id=?
            AND s.user_id=?
            AND s.deleted_at IS NULL
            AND s.purged_at IS NULL
            AND s.archived_at IS NULL
            AND s.history_cleared_at IS NULL
            AND s.status NOT IN ('CLOSED','ARCHIVED')
            AND auth.revoked_at IS NULL
            AND datetime(auth.expires_at)>datetime('now')
          LIMIT 1`,
      ).bind(...bindings).first<{ allowed: number }>();
      return Boolean(allowed?.allowed);
    } catch (error) {
      // Unit/legacy databases may predate history_cleared_at.  The migrated
      // schema uses the stricter query; the compatibility branch still
      // retains the terminal-state and token-revocation checks.
      if (!/history_cleared_at/i.test(String(error))) throw error;
      const allowed = await this.env.DB.prepare(
        `SELECT 1 AS allowed
           FROM sessions s
           JOIN users u ON u.id=s.user_id
           JOIN visitor_sessions auth ON auth.id=? AND auth.visitor_key=u.visitor_key
          WHERE s.id=?
            AND s.user_id=?
            AND s.deleted_at IS NULL
            AND s.purged_at IS NULL
            AND s.archived_at IS NULL
            AND s.status NOT IN ('CLOSED','ARCHIVED')
            AND auth.revoked_at IS NULL
            AND datetime(auth.expires_at)>datetime('now')
          LIMIT 1`,
      ).bind(...bindings).first<{ allowed: number }>();
      return Boolean(allowed?.allowed);
    }
  }

  private async sendToSockets(payload: string, protectedSessionId: string, protectStaff: boolean, protectAdminFeed: boolean) {
    await Promise.all(this.state.getWebSockets().map(async (socket) => {
      const meta = socket.deserializeAttachment() as ConnectionMeta | null;
      if (protectAdminFeed) {
        let allowed = false;
        try { allowed = await this.canReceiveAdminFeed(meta); } catch (error) { console.error('Admin feed socket authorization failed', error); }
        if (!allowed) {
          try { socket.close(1008, 'Admin feed access revoked'); } catch {}
          return;
        }
      } else if (protectStaff) {
        let allowed = false;
        try {
          allowed = await this.canReceiveStaff(meta);
        } catch (error) {
          console.error('Staff socket authorization failed', error);
        }
        if (!allowed) {
          try {
            socket.close(1008, 'Staff access revoked');
          } catch {}
          return;
        }
      } else if (protectedSessionId) {
        let allowed = false;
        try {
          allowed = await this.canReceive(meta, protectedSessionId);
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
        const outgoing = meta?.mode === 'conversation' && meta.principalType === 'guest'
          ? sanitizeGuestSocketPayload(payload)
          : payload;
        socket.send(outgoing);
      } catch {}
    }));
  }
}
