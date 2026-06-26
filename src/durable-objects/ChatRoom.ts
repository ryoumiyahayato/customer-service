type ConnectionMeta = {
  mode: 'room' | 'global';
  role?: 'user' | 'admin';
  sessionId?: string;
};

type ChatPayload = {
  type: string;
  sessionId: string;
  content: string;
  fromRole: 'user' | 'admin';
  time: string;
};

export class ChatRoom {
  constructor(private state: DurableObjectState) {}

  async fetch(req: Request) {
    const url = new URL(req.url);
    if (url.pathname === '/broadcast') {
      const payload = await req.text();
      this.sendToSockets((meta) => meta.mode !== 'global', payload);
      return new Response('ok');
    }

    if (req.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    if (url.pathname === '/ws') {
      const role = url.searchParams.get('role');
      const sessionId = url.searchParams.get('sessionId') || '';
      if ((role !== 'user' && role !== 'admin') || !sessionId) {
        return new Response('Invalid WebSocket role or sessionId', { status: 400 });
      }
      // TODO: add admin authentication before production use
      this.state.acceptWebSocket(server);
      server.serializeAttachment({ mode: 'global', role, sessionId } satisfies ConnectionMeta);
      server.send(JSON.stringify({ type: 'connected', role, sessionId, time: new Date().toISOString() }));
      return new Response(null, { status: 101, webSocket: client });
    }

    this.state.acceptWebSocket(server);
    server.serializeAttachment({ mode: 'room' } satisfies ConnectionMeta);
    server.send(JSON.stringify({ type: 'connected', ts: Date.now() }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string') return;
    const meta = this.getMeta(ws);

    try {
      const data = JSON.parse(message);
      if (data?.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
        return;
      }

      if (meta.mode === 'global') {
        this.forwardGlobalMessage(ws, meta, data);
      }
    } catch {
      ws.send(JSON.stringify({ type: 'error', error: 'Invalid JSON message' }));
    }
  }

  async webSocketClose() {}

  async webSocketError() {}

  private forwardGlobalMessage(ws: WebSocket, meta: ConnectionMeta, data: any) {
    const sessionId = String(data?.sessionId || meta.sessionId || '');
    const content = String(data?.content || '');
    if (!sessionId || !content) {
      ws.send(JSON.stringify({ type: 'error', error: 'Message requires sessionId and content' }));
      return;
    }

    const fromRole = meta.role === 'admin' ? 'admin' : 'user';
    const payload: ChatPayload = {
      type: 'message',
      sessionId,
      content,
      fromRole,
      time: typeof data?.time === 'string' ? data.time : new Date().toISOString(),
    };
    const encoded = JSON.stringify(payload);

    if (fromRole === 'user') {
      this.sendToSockets((socketMeta, socket) => socket === ws || socketMeta.role === 'admin', encoded);
      return;
    }

    this.sendToSockets((socketMeta) => socketMeta.role === 'user' && socketMeta.sessionId === sessionId, encoded);
  }

  private sendToSockets(filter: (meta: ConnectionMeta, ws: WebSocket) => boolean, payload: string) {
    for (const socket of this.state.getWebSockets()) {
      const meta = this.getMeta(socket);
      if (!filter(meta, socket)) continue;
      try {
        socket.send(payload);
      } catch {}
    }
  }

  private getMeta(ws: WebSocket): ConnectionMeta {
    try {
      return (ws.deserializeAttachment() || { mode: 'room' }) as ConnectionMeta;
    } catch {
      return { mode: 'room' };
    }
  }
}