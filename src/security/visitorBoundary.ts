type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function pick(source: RecordValue, keys: string[]) {
  const target: RecordValue = {};
  for (const key of keys) if (key in source) target[key] = source[key];
  return target;
}

export function sanitizeVisitorSession(value: unknown) {
  if (!isRecord(value)) return value;
  return {
    ...pick(value, [
      'id', 'status', 'created_at', 'createdAt', 'updated_at', 'updatedAt',
      'history_cleared_at', 'historyClearedAt',
    ]),
    unread_count: 0,
  };
}

export function sanitizeVisitorMessage(value: unknown) {
  if (!isRecord(value)) return value;
  const safe = pick(value, [
    'id', 'session_id', 'sessionId', 'sender_type', 'senderType', 'content', 'body',
    'message_type', 'messageType', 'image_path', 'imagePath', 'status', 'created_at',
    'createdAt', 'read_at', 'readAt', 'is_read', 'isRead', 'quote_message_id',
    'quoteMessageId', 'recalled_at', 'recalledAt', 'deleted_at', 'deletedAt',
    'image_purged_at', 'imagePurgedAt', 'client_message_id', 'clientMessageId', 'deduped',
  ]);
  // Sender principal ids are authorization data, not visitor UI data.
  if ('sender_id' in value) safe.sender_id = null;
  if ('senderId' in value) safe.senderId = null;
  return safe;
}

function sanitizePresentation(value: unknown) {
  if (!isRecord(value)) return value;
  return pick(value, ['displayName', 'welcomeText', 'avatarUrl']);
}

export function sanitizeVisitorPayload(value: unknown) {
  if (!isRecord(value)) return value;
  const output: RecordValue = { ...value };

  // These are internal ownership/authentication records and must never cross the public visitor boundary.
  for (const key of [
    'user', 'account', 'visitorId', 'visitorToken', 'visitorKey', 'operatorId',
    'sourceOperatorId', 'source_operator_id', 'createdByAdminId', 'created_by_admin_id',
  ]) delete output[key];

  if ('session' in output) output.session = sanitizeVisitorSession(output.session);
  if (Array.isArray(output.sessions)) output.sessions = output.sessions.map(sanitizeVisitorSession);
  if (Array.isArray(output.messages)) output.messages = output.messages.map(sanitizeVisitorMessage);
  if ('message' in output) output.message = sanitizeVisitorMessage(output.message);
  if ('presentation' in output) output.presentation = sanitizePresentation(output.presentation);
  return output;
}

export function sanitizeVisitorRealtimePayload(value: unknown) {
  if (!isRecord(value)) return value;
  const safe = pick(value, [
    'type', 'conversationId', 'sessionId', 'messageId', 'messageIds', 'readAt', 'senderType', 'ts',
  ]);
  if ('message' in value) safe.message = sanitizeVisitorMessage(value.message);
  if ('session' in value) safe.session = sanitizeVisitorSession(value.session);
  return safe;
}

export async function hardenVisitorJsonResponse(response: Response) {
  if ((response as Response & { webSocket?: unknown }).webSocket) return response;
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('application/json')) return response;
  const payload = await response.clone().json().catch(() => null);
  if (!payload) return response;
  const headers = new Headers(response.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.delete('Content-Length');
  return new Response(JSON.stringify(sanitizeVisitorPayload(payload)), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function uploadedImageMagicMatches(req: Request) {
  const form = await req.clone().formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return true;
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (file.type === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (file.type === 'image/png') {
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return bytes.length >= sig.length && sig.every((byte, index) => bytes[index] === byte);
  }
  if (file.type === 'image/webp') {
    return bytes.length >= 12
      && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
      && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  }
  return false;
}
