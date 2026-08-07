export { ChatRoom } from './worker-entry';
import worker from './worker-entry';
import type { Env } from './worker';
import { COOKIE_NAMES, readCookie } from './security/cookies';
import { verifySignedValue } from './security/signing';
import { hashSessionToken } from './security/sessionTokens';
import { jsonResponse } from './security/responseHeaders';
import { withStaffRoomAccess } from './durable-objects/ChatRoom';

type WorkerModule = {
  fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
  scheduled?(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void>;
};

type SettingsRow = { value_json: string };
type StaffAdminContext = {
  id: string;
  role: 'SUPER_ADMIN' | 'OPERATOR';
  sessionId: string;
};

const inner = worker as WorkerModule;

function isLocalDevHost(host: string) {
  let normalized = String(host || '').toLowerCase();
  if (normalized.startsWith('[')) normalized = normalized.slice(1).split(']')[0];
  else if (normalized.indexOf(':') === normalized.lastIndexOf(':') && normalized.includes(':')) normalized = normalized.slice(0, normalized.lastIndexOf(':'));
  return normalized === 'localhost' || normalized.endsWith('.localhost') || normalized === '127.0.0.1' || normalized === '0.0.0.0' || normalized === '::1';
}

function isSameOriginWebSocket(req: Request) {
  const url = new URL(req.url);
  const origin = req.headers.get('origin');
  if (origin) {
    try { return new URL(origin).origin === url.origin; } catch { return false; }
  }
  return isLocalDevHost(url.hostname) || isLocalDevHost(req.headers.get('host') || '');
}

async function currentStaffAdmin(env: Env, req: Request): Promise<StaffAdminContext | null> {
  const signed = readCookie(req, COOKIE_NAMES.admin);
  const sessionId = await verifySignedValue(env.SESSION_SECRET, signed);
  if (!sessionId) return null;
  const row = await env.DB.prepare(
    `SELECT a.id,a.role,s.id session_id
       FROM admin_sessions s
       JOIN admins a ON a.id=s.admin_id
      WHERE s.id=? AND s.token_hash=? AND s.revoked_at IS NULL
        AND datetime(s.expires_at)>datetime('now')
        AND datetime(s.created_at)>datetime('now','-1 day')
        AND datetime(COALESCE(s.last_seen_at,s.created_at))>datetime('now','-30 minutes')
        AND COALESCE(a.is_disabled,0)=0
        AND a.role IN ('SUPER_ADMIN','OPERATOR')
      LIMIT 1`,
  ).bind(sessionId, await hashSessionToken(env.SESSION_SECRET, sessionId)).first<{ id: string; role: 'SUPER_ADMIN' | 'OPERATOR'; session_id: string }>();
  return row?.id ? { id: row.id, role: row.role, sessionId: row.session_id } : null;
}

async function staffChatAllowed(env: Env, admin: StaffAdminContext) {
  if (admin.role === 'SUPER_ADMIN') return true;
  const row = await env.DB.prepare('SELECT value_json FROM settings WHERE key=? LIMIT 1')
    .bind(`operator_policy:${admin.id}`).first<SettingsRow>();
  if (!row?.value_json) return true;
  try {
    const policy = JSON.parse(row.value_json) as { canUseStaffChat?: unknown };
    return policy.canUseStaffChat !== false;
  } catch {
    return true;
  }
}

async function openStaffSocket(req: Request, env: Env) {
  if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    return new Response('Expected WebSocket', { status: 426 });
  }
  if (!isSameOriginWebSocket(req)) {
    return jsonResponse({ error: 'forbidden' }, { status: 403 });
  }
  const admin = await currentStaffAdmin(env, req);
  if (!admin) return jsonResponse({ error: 'unauthenticated' }, { status: 401 });
  if (!(await staffChatAllowed(env, admin))) {
    return jsonResponse({ error: 'operator_permission_denied', capability: 'canUseStaffChat' }, { status: 403 });
  }
  const stub = env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName('staff'));
  return stub.fetch(withStaffRoomAccess(req as unknown as Request, admin.id, admin.sessionId));
}

export default {
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    await inner.scheduled?.(controller, env, ctx);
  },

  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(req.url);
    if (url.pathname === '/api/ws/staff') return openStaffSocket(req, env);
    return inner.fetch(req, env, ctx);
  },
};
