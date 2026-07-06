type ConnectionMeta = {
  mode: 'room';
};

export class ChatRoom {
  constructor(private state: DurableObjectState) {}

  async fetch(req: Request) {
    const url = new URL(req.url);
    if (url.pathname === '/broadcast') {
      if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
      }
      const payload = await req.text();
      this.sendToSockets(payload);
      return new Response('ok');
    }

    if (req.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.state.acceptWebSocket(server);
    server.serializeAttachment({ mode: 'room' } satisfies ConnectionMeta);
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

  private sendToSockets(payload: string) {
    for (const socket of this.state.getWebSockets()) {
      try {
        socket.send(payload);
      } catch {}
    }
  }
}
