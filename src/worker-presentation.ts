export { ChatRoom } from './worker-business-hardening';
import businessWorker from './worker-business-hardening';
import type { Env } from './worker';
import { createChatRoomBroadcastRequest } from './durable-objects/ChatRoom';
import { hmacHex } from './security/signing';
import { consumeRateLimit } from './security/rateLimit';
import { readJsonObjectWithinLimit, requestStreamExceeds } from './security/requestLimits';
import { jsonResponse, withSecurityHeaders } from './security/responseHeaders';
import { activeAdminSession } from './security/adminSession';
import { isSameOriginWrite } from './security/requestOrigin';
import {
  normalizeOperatorPresentation,
  readOperatorPresentation,
  writeOperatorPresentation,
  type OperatorPresentation,
} from './operatorPresentation';

type WorkerModule = {
  fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
  scheduled?(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void>;
};

type AdminIdentity = {
  id: string;
  username: string;
  role: 'SUPER_ADMIN' | 'OPERATOR';
  is_disabled?: number;
};

type OperatorRow = AdminIdentity & { display_name?: string | null };

const inner = businessWorker as WorkerModule;
const JSON_MAX_BYTES = 16 * 1024;
const AVATAR_REQUEST_MAX_BYTES = 2 * 1024 * 1024 + 64 * 1024;
const AVATAR_FILE_MAX_BYTES = 2 * 1024 * 1024;
const STAFF_CHAT_CLEAR_CONFIRMATION = 'CLEAR_STAFF_CHAT';

function json(body: unknown, status = 200) { return jsonResponse(body, { status }); }

const sameOriginWrite = isSameOriginWrite;

async function currentAdmin(env: Env, req: Request): Promise<AdminIdentity | null> {
  const active = await activeAdminSession(env, req);
  return active ? { id: active.id, username: active.username, role: active.role, is_disabled: 0 } : null;
}

async function targetOperator(env: Env, req: Request): Promise<OperatorRow | Response> {
  const admin = await currentAdmin(env, req);
  if (!admin) return json({ error: 'unauthenticated' }, 401);
  const requested = new URL(req.url).searchParams.get('operatorId')?.trim() || admin.id;
  if (requested !== admin.id && admin.role !== 'SUPER_ADMIN') return json({ error: 'forbidden' }, 403);
  const target = await env.DB.prepare(
    'SELECT id,username,display_name,role,is_disabled FROM admins WHERE id=? LIMIT 1',
  ).bind(requested).first<OperatorRow>();
  if (!target?.id || target.is_disabled) return json({ error: 'operator_not_found' }, 404);
  return target;
}

async function presentationRateLimit(env: Env, req: Request) {
  const ip = req.headers.get('cf-connecting-ip') || 'unknown';
  const key = `presentation:${ip}:${new URL(req.url).pathname}`.slice(0, 240);
  const retryAfter = await consumeRateLimit(env.DB, key, 30, 60 * 1000);
  return retryAfter === null ? null : json({ error: 'rate_limited', retryAfter }, 429);
}

async function readPresentation(env: Env, adminId: string) {
  return readOperatorPresentation(env.DB, adminId);
}

async function writePresentation(env: Env, adminId: string, value: OperatorPresentation) {
  await writeOperatorPresentation(env.DB, adminId, value);
}

function publicPresentation(target: OperatorRow, presentation: OperatorPresentation) {
  const avatarVersion = presentation.avatarKey.split('/').pop()?.split('.')[0] || '';
  return {
    operatorId: target.id,
    displayName: String(target.display_name || target.username || '在线客服'),
    welcomeText: presentation.welcomeText,
    avatarUrl: presentation.avatarKey ? `/api/operator-avatar/${encodeURIComponent(target.id)}?v=${encodeURIComponent(avatarVersion)}` : '',
    qrBackgroundColor: presentation.qrBackgroundColor,
    qrTopText: presentation.qrTopText,
    qrBottomText: presentation.qrBottomText,
  };
}

async function handlePresentationGet(req: Request, env: Env) {
  const target = await targetOperator(env, req);
  if (target instanceof Response) return target;
  return json({ presentation: publicPresentation(target, await readPresentation(env, target.id)) });
}

async function handlePresentationPut(req: Request, env: Env) {
  if (!sameOriginWrite(req)) return json({ error: 'forbidden' }, 403);
  const limited = await presentationRateLimit(env, req);
  if (limited) return limited;
  const target = await targetOperator(env, req);
  if (target instanceof Response) return target;
  const parsed = await readJsonObjectWithinLimit(req, JSON_MAX_BYTES);
  if (parsed.tooLarge) return json({ error: 'request_too_large' }, 413);
  const current = await readPresentation(env, target.id);
  const next = normalizeOperatorPresentation({
    ...current,
    ...parsed.body,
    avatarKey: current.avatarKey,
  });
  await writePresentation(env, target.id, next);
  return json({ presentation: publicPresentation(target, next) });
}

function avatarExtension(type: string) {
  if (type === 'image/jpeg') return 'jpg';
  if (type === 'image/png') return 'png';
  if (type === 'image/webp') return 'webp';
  return '';
}

async function handleAvatarUpload(req: Request, env: Env, ctx: ExecutionContext) {
  if (!sameOriginWrite(req)) return json({ error: 'forbidden' }, 403);
  const limited = await presentationRateLimit(env, req);
  if (limited) return limited;
  const target = await targetOperator(env, req);
  if (target instanceof Response) return target;
  if (await requestStreamExceeds(req, AVATAR_REQUEST_MAX_BYTES)) return json({ error: 'avatar_too_large' }, 413);
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return json({ error: 'avatar_required' }, 400);
  const ext = avatarExtension(file.type);
  if (!ext) return json({ error: 'avatar_type_not_supported' }, 400);
  if (file.size <= 0 || file.size > AVATAR_FILE_MAX_BYTES) return json({ error: 'avatar_too_large' }, 413);

  const current = await readPresentation(env, target.id);
  const key = `operator-avatars/${target.id}/${crypto.randomUUID().replace(/-/g, '')}.${ext}`;
  await env.UPLOADS.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
  const next = normalizeOperatorPresentation({ ...current, avatarKey: key });
  try {
    await writePresentation(env, target.id, next);
  } catch (error) {
    await env.UPLOADS.delete(key).catch(() => {});
    throw error;
  }
  if (current.avatarKey && current.avatarKey !== key) ctx.waitUntil(env.UPLOADS.delete(current.avatarKey).catch(() => {}));
  return json({ presentation: publicPresentation(target, next) });
}

async function handleAvatarDelete(req: Request, env: Env, ctx: ExecutionContext) {
  if (!sameOriginWrite(req)) return json({ error: 'forbidden' }, 403);
  const limited = await presentationRateLimit(env, req);
  if (limited) return limited;
  const target = await targetOperator(env, req);
  if (target instanceof Response) return target;
  const current = await readPresentation(env, target.id);
  const next = normalizeOperatorPresentation({ ...current, avatarKey: '' });
  await writePresentation(env, target.id, next);
  if (current.avatarKey) ctx.waitUntil(env.UPLOADS.delete(current.avatarKey).catch(() => {}));
  return json({ presentation: publicPresentation(target, next) });
}

async function handlePublicAvatar(env: Env, adminId: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(adminId)) return withSecurityHeaders(new Response('Not found', { status: 404 }));
  const presentation = await readPresentation(env, adminId);
  if (!presentation.avatarKey || !presentation.avatarKey.startsWith(`operator-avatars/${adminId}/`)) {
    return withSecurityHeaders(new Response('Not found', { status: 404 }));
  }
  const object = await env.UPLOADS.get(presentation.avatarKey);
  if (!object) return withSecurityHeaders(new Response('Not found', { status: 404 }));
  return withSecurityHeaders(new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
      'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  }));
}

async function handleInvitePresentation(env: Env, token: string) {
  if (!/^[a-f0-9]{40}$/.test(token)) return json({ presentation: null }, 404);
  const tokenHash = await hmacHex(env.SESSION_SECRET, `invite:${token}`);
  const invite = await env.DB.prepare(
    'SELECT source_operator_id,expires_at,revoked_at FROM invite_links WHERE token_hash=? LIMIT 1',
  ).bind(tokenHash).first<{ source_operator_id: string | null; expires_at: string; revoked_at: string | null }>();
  if (!invite || invite.revoked_at || invite.expires_at <= new Date().toISOString() || !invite.source_operator_id) {
    return json({ presentation: null }, invite ? 200 : 404);
  }
  const target = await env.DB.prepare(
    'SELECT id,username,display_name,role,is_disabled FROM admins WHERE id=? AND is_disabled=0 LIMIT 1',
  ).bind(invite.source_operator_id).first<OperatorRow>();
  if (!target?.id) return json({ presentation: null });
  return json({ presentation: publicPresentation(target, await readPresentation(env, target.id)) });
}

async function handleStaffChatClear(req: Request, env: Env) {
  if (!sameOriginWrite(req)) return json({ error: 'forbidden' }, 403);
  const admin = await currentAdmin(env, req);
  if (!admin) return json({ error: 'unauthenticated' }, 401);
  if (admin.role !== 'SUPER_ADMIN') return json({ error: 'forbidden' }, 403);

  const ip = req.headers.get('cf-connecting-ip') || 'unknown';
  const retryAfter = await consumeRateLimit(env.DB, `staff-clear:${admin.id}:${ip}`.slice(0, 240), 3, 10 * 60 * 1000);
  if (retryAfter !== null) return json({ error: 'rate_limited', retryAfter }, 429);

  const parsed = await readJsonObjectWithinLimit(req, JSON_MAX_BYTES);
  if (parsed.tooLarge) return json({ error: 'request_too_large' }, 413);
  if (parsed.body.confirm !== STAFF_CHAT_CLEAR_CONFIRMATION) return json({ error: 'invalid_confirmation' }, 400);

  const countRow = await env.DB.prepare('SELECT COUNT(*) count FROM staff_messages').first<{ count: number }>();
  const deleted = Number(countRow?.count || 0);
  await env.DB.prepare('DELETE FROM staff_messages').run();
  const clearedAt = new Date().toISOString();
  try {
    await env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName('staff')).fetch(createChatRoomBroadcastRequest('staff', {
      type: 'staff:cleared',
      clearedAt,
      clearedBy: admin.id,
    }));
  } catch (error) {
    console.error('Failed to broadcast staff chat clear event', error);
  }
  return json({ ok: true, deleted, clearedAt });
}

export default {
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    await inner.scheduled?.(controller, env, ctx);
  },

  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(req.url);
    if (url.pathname === '/api/admins/presentation' && req.method === 'GET') return handlePresentationGet(req, env);
    if (url.pathname === '/api/admins/presentation' && req.method === 'PUT') return handlePresentationPut(req, env);
    if (url.pathname === '/api/admins/presentation/avatar' && req.method === 'POST') return handleAvatarUpload(req, env, ctx);
    if (url.pathname === '/api/admins/presentation/avatar' && req.method === 'DELETE') return handleAvatarDelete(req, env, ctx);
    if (url.pathname === '/api/staff-chat' && req.method === 'DELETE') return handleStaffChatClear(req, env);
    const avatarMatch = url.pathname.match(/^\/api\/operator-avatar\/([^/]+)$/);
    if (avatarMatch && req.method === 'GET') return handlePublicAvatar(env, decodeURIComponent(avatarMatch[1]));
    const invitePresentationMatch = url.pathname.match(/^\/api\/invite-presentation\/([^/]+)$/);
    if (invitePresentationMatch && req.method === 'GET') return handleInvitePresentation(env, decodeURIComponent(invitePresentationMatch[1]));
    return inner.fetch(req, env, ctx);
  },
};
