export { ChatRoom } from './worker-entry';
import entryWorker from './worker-entry';
import type { Env } from './worker';
import { activeAdminSession } from './security/adminSession';
import { isSameOriginWrite } from './security/requestOrigin';
import { consumeRateLimit } from './security/rateLimit';
import { readJsonObjectWithinLimit, requestStreamExceeds } from './security/requestLimits';
import { jsonResponse, withSecurityHeaders } from './security/responseHeaders';
import { hmacHex } from './security/signing';
import { readOperatorPolicy } from './security/operatorPolicy';
import { MessageRepository, type MessageRecord } from './repositories/messageRepository';
import { AttachmentRepository } from './repositories/attachmentRepository';
import { MessageService } from './services/messageService';
import { createChatRoomBroadcastRequest } from './durable-objects/ChatRoom';
import {
  PRESET_IMAGE_MAX_BYTES,
  PRESET_MESSAGE_MAX_ITEMS,
  PRESET_TEXT_MAX_LENGTH,
  countOperatorPresetMessages,
  listOperatorPresetMessages,
  nextOperatorPresetPosition,
  normalizeOperatorPresetPositions,
  operatorPresetMessageById,
  type OperatorPresetMessage,
} from './operatorPresetMessages';

type WorkerModule = {
  fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
  scheduled?(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void>;
};

type AdminIdentity = {
  id: string;
  role: 'SUPER_ADMIN' | 'OPERATOR';
};

type InviteOwnerRow = {
  source_operator_id: string | null;
  created_by_admin_id: string;
};

type OwnerRow = {
  id: string;
  role: 'SUPER_ADMIN' | 'OPERATOR';
  is_disabled: number;
};

type GuestBootstrapPayload = {
  session?: { id?: unknown };
  messages?: MessageRecord[];
  [key: string]: unknown;
};

const inner = entryWorker as WorkerModule;
const JSON_MAX_BYTES = 32 * 1024;
const IMAGE_REQUEST_MAX_BYTES = PRESET_IMAGE_MAX_BYTES + 96 * 1024;
const GUEST_CONSUME_PATH = /^\/api\/guest\/([a-f0-9]{40})$/i;
const ITEM_PATH = /^\/api\/admins\/preset-messages\/([^/]+)$/;
const IMAGE_PATH = /^\/api\/admins\/preset-messages\/image\/([^/]+)$/;

function json(body: unknown, status = 200) {
  return jsonResponse(body, { status });
}

function rid(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

function attachmentKeyFromPath(path?: string | null) {
  if (!path || !path.startsWith('/api/attachments/')) return '';
  const raw = path.slice('/api/attachments/'.length);
  if (!raw || raw.includes('/') || raw.includes('?') || raw.includes('#')) return '';
  try {
    const decoded = decodeURIComponent(raw);
    return decoded && !/[\\/\u0000-\u001f\u007f]/.test(decoded) ? decoded : '';
  } catch {
    return '';
  }
}

async function currentAdmin(env: Env, req: Request): Promise<AdminIdentity | null> {
  const active = await activeAdminSession(env, req);
  return active ? { id: active.id, role: active.role } : null;
}

async function requireAdmin(env: Env, req: Request) {
  const admin = await currentAdmin(env, req);
  return admin || null;
}

async function writeLimited(env: Env, req: Request, adminId: string) {
  const ip = req.headers.get('cf-connecting-ip') || 'unknown';
  const retryAfter = await consumeRateLimit(env.DB, `preset:${adminId}:${ip}`.slice(0, 240), 40, 60 * 1000);
  return retryAfter === null ? null : json({ error: 'rate_limited', retryAfter }, 429);
}

function imageExtension(type: string) {
  if (type === 'image/jpeg') return 'jpg';
  if (type === 'image/png') return 'png';
  if (type === 'image/webp') return 'webp';
  return '';
}

function publicMessage(item: OperatorPresetMessage) {
  return {
    id: item.id,
    position: item.position,
    messageType: item.messageType,
    content: item.content,
    imageUrl: item.messageType === 'image'
      ? `/api/admins/preset-messages/image/${encodeURIComponent(item.id)}?v=${encodeURIComponent(item.updatedAt)}`
      : '',
  };
}

async function handleList(req: Request, env: Env) {
  const admin = await requireAdmin(env, req);
  if (!admin) return json({ error: 'unauthenticated' }, 401);
  return json({ messages: (await listOperatorPresetMessages(env.DB, admin.id)).map(publicMessage) });
}

async function handleAddText(req: Request, env: Env) {
  if (!isSameOriginWrite(req)) return json({ error: 'forbidden' }, 403);
  const admin = await requireAdmin(env, req);
  if (!admin) return json({ error: 'unauthenticated' }, 401);
  const limited = await writeLimited(env, req, admin.id);
  if (limited) return limited;
  const parsed = await readJsonObjectWithinLimit(req, JSON_MAX_BYTES);
  if (parsed.tooLarge) return json({ error: 'request_too_large' }, 413);
  if (String(parsed.body.messageType || 'text') !== 'text') return json({ error: 'invalid_message_type' }, 400);
  const content = typeof parsed.body.content === 'string' ? parsed.body.content.trim() : '';
  if (!content || Array.from(content).length > PRESET_TEXT_MAX_LENGTH) return json({ error: 'invalid_text' }, 400);
  if (await countOperatorPresetMessages(env.DB, admin.id) >= PRESET_MESSAGE_MAX_ITEMS) return json({ error: 'preset_limit_reached' }, 409);
  const id = rid('preset');
  const at = new Date().toISOString();
  const position = await nextOperatorPresetPosition(env.DB, admin.id);
  await env.DB.prepare(
    `INSERT INTO operator_preset_messages(id,admin_id,position,message_type,content,image_object_key,image_mime_type,image_byte_size,created_at,updated_at)
     VALUES(?,?,?,'text',?,NULL,NULL,NULL,?,?)`,
  ).bind(id, admin.id, position, content, at, at).run();
  const item = await operatorPresetMessageById(env.DB, admin.id, id);
  return json({ message: item ? publicMessage(item) : null }, 201);
}

async function handleEditText(req: Request, env: Env, id: string) {
  if (!isSameOriginWrite(req)) return json({ error: 'forbidden' }, 403);
  const admin = await requireAdmin(env, req);
  if (!admin) return json({ error: 'unauthenticated' }, 401);
  const limited = await writeLimited(env, req, admin.id);
  if (limited) return limited;
  const current = await operatorPresetMessageById(env.DB, admin.id, id);
  if (!current) return json({ error: 'preset_not_found' }, 404);
  if (current.messageType !== 'text') return json({ error: 'preset_not_editable' }, 400);
  const parsed = await readJsonObjectWithinLimit(req, JSON_MAX_BYTES);
  if (parsed.tooLarge) return json({ error: 'request_too_large' }, 413);
  const content = typeof parsed.body.content === 'string' ? parsed.body.content.trim() : '';
  if (!content || Array.from(content).length > PRESET_TEXT_MAX_LENGTH) return json({ error: 'invalid_text' }, 400);
  await env.DB.prepare('UPDATE operator_preset_messages SET content=?,updated_at=? WHERE admin_id=? AND id=?')
    .bind(content, new Date().toISOString(), admin.id, id).run();
  const item = await operatorPresetMessageById(env.DB, admin.id, id);
  return json({ message: item ? publicMessage(item) : null });
}

async function handleDelete(req: Request, env: Env, ctx: ExecutionContext, id: string) {
  if (!isSameOriginWrite(req)) return json({ error: 'forbidden' }, 403);
  const admin = await requireAdmin(env, req);
  if (!admin) return json({ error: 'unauthenticated' }, 401);
  const limited = await writeLimited(env, req, admin.id);
  if (limited) return limited;
  const current = await operatorPresetMessageById(env.DB, admin.id, id);
  if (!current) return json({ error: 'preset_not_found' }, 404);
  await env.DB.prepare('DELETE FROM operator_preset_messages WHERE admin_id=? AND id=?').bind(admin.id, id).run();
  const remaining = await countOperatorPresetMessages(env.DB, admin.id);
  if (remaining > 0) await normalizeOperatorPresetPositions(env.DB, admin.id);
  if (current.imageObjectKey) ctx.waitUntil(env.UPLOADS.delete(current.imageObjectKey).catch(() => {}));
  return json({ ok: true });
}

async function handleOrder(req: Request, env: Env) {
  if (!isSameOriginWrite(req)) return json({ error: 'forbidden' }, 403);
  const admin = await requireAdmin(env, req);
  if (!admin) return json({ error: 'unauthenticated' }, 401);
  const limited = await writeLimited(env, req, admin.id);
  if (limited) return limited;
  const parsed = await readJsonObjectWithinLimit(req, JSON_MAX_BYTES);
  if (parsed.tooLarge) return json({ error: 'request_too_large' }, 413);
  const ids = Array.isArray(parsed.body.ids) ? parsed.body.ids.map(value => String(value || '')) : [];
  if (ids.length > PRESET_MESSAGE_MAX_ITEMS) return json({ error: 'invalid_preset_order' }, 400);
  try {
    const messages = await normalizeOperatorPresetPositions(env.DB, admin.id, ids);
    return json({ messages: messages.map(publicMessage) });
  } catch {
    return json({ error: 'invalid_preset_order' }, 400);
  }
}

async function handleAddImage(req: Request, env: Env) {
  if (!isSameOriginWrite(req)) return json({ error: 'forbidden' }, 403);
  const admin = await requireAdmin(env, req);
  if (!admin) return json({ error: 'unauthenticated' }, 401);
  if (admin.role === 'OPERATOR' && !(await readOperatorPolicy(env.DB, admin.id)).canUploadImages) {
    return json({ error: 'operator_permission_denied', capability: 'canUploadImages' }, 403);
  }
  const limited = await writeLimited(env, req, admin.id);
  if (limited) return limited;
  if (await countOperatorPresetMessages(env.DB, admin.id) >= PRESET_MESSAGE_MAX_ITEMS) return json({ error: 'preset_limit_reached' }, 409);
  if (await requestStreamExceeds(req, IMAGE_REQUEST_MAX_BYTES)) return json({ error: 'image_too_large' }, 413);
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return json({ error: 'image_required' }, 400);
  const ext = imageExtension(file.type);
  if (!ext) return json({ error: 'image_type_not_supported' }, 400);
  if (file.size <= 0 || file.size > PRESET_IMAGE_MAX_BYTES) return json({ error: 'image_too_large' }, 413);

  const id = rid('preset');
  const key = `operator-presets/${admin.id}/${crypto.randomUUID().replace(/-/g, '')}.${ext}`;
  const at = new Date().toISOString();
  const position = await nextOperatorPresetPosition(env.DB, admin.id);
  await env.UPLOADS.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
  try {
    await env.DB.prepare(
      `INSERT INTO operator_preset_messages(id,admin_id,position,message_type,content,image_object_key,image_mime_type,image_byte_size,created_at,updated_at)
       VALUES(?,?,?,'image','',?,?,?,?,?)`,
    ).bind(id, admin.id, position, key, file.type, file.size, at, at).run();
  } catch (error) {
    await env.UPLOADS.delete(key).catch(() => {});
    throw error;
  }
  const item = await operatorPresetMessageById(env.DB, admin.id, id);
  return json({ message: item ? publicMessage(item) : null }, 201);
}

async function handleImage(req: Request, env: Env, id: string) {
  const admin = await requireAdmin(env, req);
  if (!admin) return json({ error: 'unauthenticated' }, 401);
  const item = await operatorPresetMessageById(env.DB, admin.id, id);
  if (!item || item.messageType !== 'image' || !item.imageObjectKey.startsWith(`operator-presets/${admin.id}/`)) {
    return withSecurityHeaders(new Response('Not found', { status: 404 }));
  }
  const object = await env.UPLOADS.get(item.imageObjectKey);
  if (!object) return withSecurityHeaders(new Response('Not found', { status: 404 }));
  return withSecurityHeaders(new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType || item.imageMimeType || 'application/octet-stream',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  }));
}

async function notifyAdmins(env: Env) {
  try {
    await env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName('admin-feed')).fetch(createChatRoomBroadcastRequest('admin-feed', {
      type: 'sessions:changed',
      ts: Date.now(),
    }));
  } catch (error) {
    console.error('preset admin-feed notification failed', error);
  }
}

async function cleanupUnboundClone(env: Env, objectKey: string) {
  try {
    await env.DB.prepare('DELETE FROM attachments WHERE object_key=? AND message_id IS NULL').bind(objectKey).run();
  } catch {
    // Best effort cleanup for legacy D1 fixtures.
  }
  try {
    await env.UPLOADS.delete(objectKey);
  } catch {
    // Best effort cleanup for the copied preset object.
  }
}

async function deliverPresetMessages(env: Env, response: Response, token: string) {
  if (!response.ok) return response;
  const payload = await response.clone().json().catch(() => null) as GuestBootstrapPayload | null;
  const sessionId = typeof payload?.session?.id === 'string' ? payload.session.id : '';
  if (!sessionId || !payload) return response;
  const applied = await env.DB.prepare('SELECT session_id FROM operator_preset_applications WHERE session_id=? LIMIT 1')
    .bind(sessionId).first<{ session_id: string }>();
  if (applied?.session_id) return response;

  const tokenHash = await hmacHex(env.SESSION_SECRET, `invite:${token}`);
  const invite = await env.DB.prepare(
    'SELECT source_operator_id,created_by_admin_id FROM invite_links WHERE token_hash=? AND consumed_session_id=? LIMIT 1',
  ).bind(tokenHash, sessionId).first<InviteOwnerRow>();
  const ownerId = String(invite?.source_operator_id || invite?.created_by_admin_id || '').trim();
  if (!ownerId) return response;
  const owner = await env.DB.prepare('SELECT id,role,is_disabled FROM admins WHERE id=? LIMIT 1')
    .bind(ownerId).first<OwnerRow>();
  if (!owner?.id || owner.is_disabled) return response;

  const presets = await listOperatorPresetMessages(env.DB, ownerId);
  const imageAllowed = owner.role !== 'OPERATOR' || (await readOperatorPolicy(env.DB, ownerId)).canUploadImages;
  const messageRepo = new MessageRepository(env.DB);
  const attachmentRepo = new AttachmentRepository(env.DB);
  const baseMs = Date.now();

  for (let index = 0; index < presets.length; index += 1) {
    const preset = presets[index];
    if (preset.messageType === 'image' && !imageAllowed) continue;
    const clientMessageId = `preset:${preset.id}`;
    const existing = await messageRepo.findDuplicate(sessionId, 'OPERATOR', ownerId, clientMessageId);
    if (existing) continue;
    const clock = () => new Date(baseMs + index).toISOString();
    const service = new MessageService(messageRepo, rid, clock, attachmentKeyFromPath);

    if (preset.messageType === 'text') {
      await service.create({
        sessionId,
        senderType: 'OPERATOR',
        senderId: ownerId,
        content: preset.content,
        messageType: 'text',
        imagePath: null,
        quoteMessageId: null,
        clientMessageId,
      });
      continue;
    }

    const source = await env.UPLOADS.get(preset.imageObjectKey);
    if (!source) {
      console.error('preset image missing', { presetId: preset.id, ownerId });
      continue;
    }
    const ext = imageExtension(preset.imageMimeType || objectContentType(source)) || 'bin';
    const objectKey = `${crypto.randomUUID().replace(/-/g, '')}.${ext}`;
    const createdAt = clock();
    await env.UPLOADS.put(objectKey, source.body, {
      httpMetadata: { contentType: preset.imageMimeType || objectContentType(source) || 'application/octet-stream' },
    });
    try {
      await attachmentRepo.insert({
        id: rid('att'),
        sessionId,
        objectKey,
        mimeType: preset.imageMimeType || objectContentType(source) || 'application/octet-stream',
        byteSize: preset.imageByteSize || Number(source.size || 0),
        createdAt,
        createdByType: 'OPERATOR',
        createdById: ownerId,
        expiresAt: new Date(Date.parse(createdAt) + 7 * 86400000).toISOString(),
      });
      const result = await service.create({
        sessionId,
        senderType: 'OPERATOR',
        senderId: ownerId,
        content: '',
        messageType: 'image',
        imagePath: `/api/attachments/${encodeURIComponent(objectKey)}`,
        quoteMessageId: null,
        clientMessageId,
      });
      if (result.deduped) await cleanupUnboundClone(env, objectKey);
    } catch (error) {
      await cleanupUnboundClone(env, objectKey);
      throw error;
    }
  }

  const appliedAt = new Date().toISOString();
  await env.DB.prepare(
    'INSERT OR IGNORE INTO operator_preset_applications(session_id,owner_admin_id,applied_at) VALUES(?,?,?)',
  ).bind(sessionId, ownerId, appliedAt).run();
  await env.DB.prepare(
    `UPDATE messages SET is_read=1,status=CASE WHEN status='sent' THEN 'read' ELSE status END,read_at=COALESCE(read_at,?)
      WHERE session_id=? AND sender_type='OPERATOR' AND sender_id=? AND client_message_id LIKE 'preset:%'`,
  ).bind(appliedAt, sessionId, ownerId).run();
  const messages = await env.DB.prepare('SELECT * FROM messages WHERE session_id=? ORDER BY created_at,id')
    .bind(sessionId).all<MessageRecord>();
  payload.messages = messages.results || [];
  await notifyAdmins(env);

  const headers = new Headers(response.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  headers.delete('Content-Length');
  return new Response(JSON.stringify(payload), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function objectContentType(object: R2ObjectBody) {
  return String(object.httpMetadata?.contentType || '');
}

function presetDeliveryFailure(response: Response) {
  const headers = new Headers(response.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  headers.delete('Content-Length');
  return new Response(JSON.stringify({ error: 'preset_delivery_failed' }), { status: 503, headers });
}

export default {
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    await inner.scheduled?.(controller, env, ctx);
  },

  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(req.url);
    const method = req.method.toUpperCase();

    if (url.pathname === '/api/admins/preset-messages' && method === 'GET') return handleList(req, env);
    if (url.pathname === '/api/admins/preset-messages' && method === 'POST') return handleAddText(req, env);
    if (url.pathname === '/api/admins/preset-messages/image' && method === 'POST') return handleAddImage(req, env);
    if (url.pathname === '/api/admins/preset-messages/order' && method === 'PUT') return handleOrder(req, env);
    const imageMatch = url.pathname.match(IMAGE_PATH);
    if (imageMatch && method === 'GET') return handleImage(req, env, decodeURIComponent(imageMatch[1]));
    const itemMatch = url.pathname.match(ITEM_PATH);
    if (itemMatch && method === 'PATCH') return handleEditText(req, env, decodeURIComponent(itemMatch[1]));
    if (itemMatch && method === 'DELETE') return handleDelete(req, env, ctx, decodeURIComponent(itemMatch[1]));

    const response = await inner.fetch(req, env, ctx);
    const guestMatch = url.pathname.match(GUEST_CONSUME_PATH);
    if (guestMatch && method === 'POST' && response.ok) {
      try {
        return await deliverPresetMessages(env, response, guestMatch[1].toLowerCase());
      } catch (error) {
        console.error('preset delivery failed', error);
        return presetDeliveryFailure(response);
      }
    }
    return response;
  },
};
