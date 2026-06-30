var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/durable-objects/ChatRoom.ts
var ChatRoom = class {
  constructor(state) {
    this.state = state;
  }
  state;
  static {
    __name(this, "ChatRoom");
  }
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/broadcast") {
      const payload = await req.text();
      this.sendToSockets((meta) => meta.mode !== "global", payload);
      return new Response("ok");
    }
    if (req.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    if (url.pathname === "/ws") {
      const role = url.searchParams.get("role");
      const sessionId = url.searchParams.get("sessionId") || "";
      if (role !== "user" && role !== "admin" || !sessionId) {
        return new Response("Invalid WebSocket role or sessionId", { status: 400 });
      }
      this.state.acceptWebSocket(server);
      server.serializeAttachment({ mode: "global", role, sessionId });
      server.send(JSON.stringify({ type: "connected", role, sessionId, time: (/* @__PURE__ */ new Date()).toISOString() }));
      return new Response(null, { status: 101, webSocket: client });
    }
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ mode: "room" });
    server.send(JSON.stringify({ type: "connected", ts: Date.now() }));
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage(ws, message) {
    if (typeof message !== "string") return;
    const meta = this.getMeta(ws);
    try {
      const data = JSON.parse(message);
      if (data?.type === "ping") {
        ws.send(JSON.stringify({ type: "pong", ts: Date.now() }));
        return;
      }
      if (meta.mode === "global") {
        this.forwardGlobalMessage(ws, meta, data);
      }
    } catch {
      ws.send(JSON.stringify({ type: "error", error: "Invalid JSON message" }));
    }
  }
  async webSocketClose() {
  }
  async webSocketError() {
  }
  forwardGlobalMessage(ws, meta, data) {
    const sessionId = String(data?.sessionId || meta.sessionId || "");
    const content = String(data?.content || "");
    if (!sessionId || !content) {
      ws.send(JSON.stringify({ type: "error", error: "Message requires sessionId and content" }));
      return;
    }
    const fromRole = meta.role === "admin" ? "admin" : "user";
    const payload = {
      type: "message",
      sessionId,
      content,
      fromRole,
      time: typeof data?.time === "string" ? data.time : (/* @__PURE__ */ new Date()).toISOString()
    };
    const encoded = JSON.stringify(payload);
    if (fromRole === "user") {
      this.sendToSockets((socketMeta, socket) => socket === ws || socketMeta.role === "admin", encoded);
      return;
    }
    this.sendToSockets((socketMeta) => socketMeta.role === "user" && socketMeta.sessionId === sessionId, encoded);
  }
  sendToSockets(filter, payload) {
    for (const socket of this.state.getWebSockets()) {
      const meta = this.getMeta(socket);
      if (!filter(meta, socket)) continue;
      try {
        socket.send(payload);
      } catch {
      }
    }
  }
  getMeta(ws) {
    try {
      return ws.deserializeAttachment() || { mode: "room" };
    } catch {
      return { mode: "room" };
    }
  }
};

// src/worker.ts
var INVITE_TTL_MS = 24 * 60 * 60 * 1e3;
var DOMAIN = "vx9qn7zr.org";
function nullResponse(status) {
  return new Response(null, {
    status,
    headers: { "cache-control": "no-store" }
  });
}
__name(nullResponse, "nullResponse");
var enc = new TextEncoder();
function isValidHex40(s) {
  return /^[0-9a-f]{40}$/i.test(s);
}
__name(isValidHex40, "isValidHex40");
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const hostname = url.hostname;
    const pathname = url.pathname;
    if (pathname.startsWith("/api/")) {
      if (hostname !== DOMAIN && hostname.endsWith("." + DOMAIN)) {
        return nullResponse(404);
      }
    }
    if (hostname !== DOMAIN && hostname.endsWith("." + DOMAIN)) {
      const subdomain = hostname.slice(0, -DOMAIN.length - 1);
      if (subdomain !== "" && !isValidHex40(subdomain)) {
        return nullResponse(404);
      }
      if (isValidHex40(subdomain)) {
        const inviteId = subdomain.toLowerCase();
        const invite = await env.DB.prepare("SELECT id, created_at, deleted_at FROM invites WHERE id = ?").bind(inviteId).first().catch(() => null);
        if (!invite || invite.deleted_at !== null) {
          return nullResponse(410);
        }
        try {
          const age = Date.now() - (/* @__PURE__ */ new Date(invite.created_at + "Z")).getTime();
          if (isNaN(age) || age > INVITE_TTL_MS) {
            return nullResponse(410);
          }
        } catch {
          return nullResponse(410);
        }
        const session = await env.DB.prepare("SELECT id, status FROM chat_sessions WHERE invite_id = ? AND status = 'active'").bind(inviteId).first().catch(() => null);
      } else {
        return nullResponse(404);
      }
    }
    try {
      return await env.ASSETS.fetch(request);
    } catch (e) {
      return nullResponse(404);
    }
  }
};
export {
  ChatRoom,
  worker_default as default
};
//# sourceMappingURL=worker.js.map
