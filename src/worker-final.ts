export { ChatRoom } from './worker-entry';
import worker from './worker-entry';
import type { Env } from './worker';
import { COOKIE_NAMES, readCookie } from './security/cookies';
import { verifySignedValue } from './security/signing';
import { hashSessionToken } from './security/sessionTokens';
import { jsonResponse } from './security/responseHeaders';

type WorkerModule = {
  fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
  scheduled?(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void>;
};

type SettingsRow = { value_json: string };
const inner = worker as WorkerModule;

async function currentOperatorId(env: Env, req: Request) {
  const signed = readCookie(req, COOKIE_NAMES.admin);
  const sessionId = await verifySignedValue(env.SESSION_SECRET, signed);
  if (!sessionId) return '';
  const row = await env.DB.prepare(
    `SELECT a.id,a.role
       FROM admin_sessions s
       JOIN admins a ON a.id=s.admin_id
      WHERE s.id=? AND s.token_hash=? AND s.revoked_at IS NULL
        AND datetime(s.expires_at)>datetime('now')
        AND datetime(s.created_at)>datetime('now','-1 day')
        AND datetime(COALESCE(s.last_seen_at,s.created_at))>datetime('now','-30 minutes')
        AND COALESCE(a.is_disabled,0)=0
      LIMIT 1`,
  ).bind(sessionId, await hashSessionToken(env.SESSION_SECRET, sessionId)).first<{ id: string; role: string }>();
  return row?.role === 'OPERATOR' ? String(row.id || '') : '';
}

async function staffChatAllowed(env: Env, operatorId: string) {
  if (!operatorId) return true;
  const row = await env.DB.prepare('SELECT value_json FROM settings WHERE key=? LIMIT 1')
    .bind(`operator_policy:${operatorId}`).first<SettingsRow>();
  if (!row?.value_json) return true;
  try {
    const policy = JSON.parse(row.value_json) as { canUseStaffChat?: unknown };
    return policy.canUseStaffChat !== false;
  } catch {
    return true;
  }
}

export default {
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    await inner.scheduled?.(controller, env, ctx);
  },

  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(req.url);
    if (url.pathname === '/api/ws/staff') {
      const operatorId = await currentOperatorId(env, req);
      if (operatorId && !(await staffChatAllowed(env, operatorId))) {
        return jsonResponse({ error: 'operator_permission_denied', capability: 'canUseStaffChat' }, { status: 403 });
      }
    }
    return inner.fetch(req, env, ctx);
  },
};
