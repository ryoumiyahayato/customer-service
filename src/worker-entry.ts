export { ChatRoom } from './worker-presentation';
import presentationWorker from './worker-presentation';
import type { Env } from './worker';
import { hmacHex } from './security/signing';
import { jsonResponse } from './security/responseHeaders';
import { normalizeOperatorPresentation, operatorPresentationKey } from './operatorPresentation';

type WorkerModule = {
  fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
  scheduled?(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void>;
};

type InvitePresentationRow = {
  source_operator_id: string | null;
  created_by_admin_id: string;
  expires_at: string;
  revoked_at: string | null;
};

type AdminRow = {
  id: string;
  username: string;
  display_name?: string | null;
  is_disabled?: number;
};

type SettingsRow = { value_json: string };

const inner = presentationWorker as WorkerModule;
const json = (body: unknown, status = 200) => jsonResponse(body, { status });

async function readPresentation(env: Env, adminId: string) {
  const row = await env.DB.prepare('SELECT value_json FROM settings WHERE key=? LIMIT 1')
    .bind(operatorPresentationKey(adminId)).first<SettingsRow>();
  if (!row?.value_json) return normalizeOperatorPresentation(null);
  try {
    return normalizeOperatorPresentation(JSON.parse(row.value_json));
  } catch {
    return normalizeOperatorPresentation(null);
  }
}

async function handleInvitePresentation(env: Env, token: string) {
  if (!/^[a-f0-9]{40}$/.test(token)) return json({ presentation: null }, 404);
  const tokenHash = await hmacHex(env.SESSION_SECRET, `invite:${token}`);
  const invite = await env.DB.prepare(
    'SELECT source_operator_id,created_by_admin_id,expires_at,revoked_at FROM invite_links WHERE token_hash=? LIMIT 1',
  ).bind(tokenHash).first<InvitePresentationRow>();

  if (!invite) return json({ presentation: null }, 404);
  if (invite.revoked_at || invite.expires_at <= new Date().toISOString()) return json({ presentation: null });

  const presentationOwnerId = String(invite.source_operator_id || invite.created_by_admin_id || '').trim();
  if (!presentationOwnerId) return json({ presentation: null });

  const target = await env.DB.prepare(
    'SELECT id,username,display_name,is_disabled FROM admins WHERE id=? AND is_disabled=0 LIMIT 1',
  ).bind(presentationOwnerId).first<AdminRow>();
  if (!target?.id) return json({ presentation: null });

  const presentation = await readPresentation(env, target.id);
  const avatarVersion = presentation.avatarKey.split('/').pop()?.split('.')[0] || '';
  return json({
    presentation: {
      operatorId: target.id,
      displayName: String(target.display_name || target.username || '在线客服'),
      welcomeText: presentation.welcomeText,
      avatarUrl: presentation.avatarKey
        ? `/api/operator-avatar/${encodeURIComponent(target.id)}?v=${encodeURIComponent(avatarVersion)}`
        : '',
      qrBackgroundColor: presentation.qrBackgroundColor,
      qrTopText: presentation.qrTopText,
      qrBottomText: presentation.qrBottomText,
    },
  });
}

export default {
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    await inner.scheduled?.(controller, env, ctx);
  },

  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(req.url);
    const invitePresentationMatch = url.pathname.match(/^\/api\/invite-presentation\/([^/]+)$/);
    if (invitePresentationMatch && req.method === 'GET') {
      return handleInvitePresentation(env, decodeURIComponent(invitePresentationMatch[1]));
    }
    return inner.fetch(req, env, ctx);
  },
};
