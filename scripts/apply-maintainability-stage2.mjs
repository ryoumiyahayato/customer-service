#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const write = (file, content) => {
  const full = path.join(root, file);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content.replace(/^\n/, ''), 'utf8');
};
const update = (file, transform) => write(file, transform(read(file)));
const replaceRequired = (source, search, replacement, label) => {
  if (!source.includes(search)) throw new Error(`Missing replacement anchor: ${label}`);
  return source.replace(search, replacement);
};
const replaceRegexRequired = (source, pattern, replacement, label) => {
  if (!pattern.test(source)) throw new Error(`Missing regex anchor: ${label}`);
  pattern.lastIndex = 0;
  return source.replace(pattern, replacement);
};
const listFiles = (dir) => {
  const full = path.join(root, dir);
  if (!existsSync(full)) return [];
  const result = [];
  for (const name of readdirSync(full)) {
    const relative = path.join(dir, name).replaceAll('\\', '/');
    const stat = statSync(path.join(root, relative));
    if (stat.isDirectory()) result.push(...listFiles(relative));
    else result.push(relative);
  }
  return result;
};

write('src/chat/types.ts', String.raw`
import type { SessionGroup } from '../domain/sessionState';

export type { SessionGroup } from '../domain/sessionState';

export type MessageStatus = 'sending' | 'sent' | 'read' | 'failed' | 'recalled';
export type MessageType = 'text' | 'image';
export type SenderType = 'VISITOR' | 'OPERATOR';

export type ChatMessage = {
  id: string;
  sessionId: string;
  senderType: SenderType;
  senderId: string | null;
  content: string;
  messageType: MessageType;
  imagePath: string | null;
  status: MessageStatus;
  createdAt: string;
  readAt: string | null;
  isRead: boolean;
  quoteMessageId: string | null;
  clientMessageId: string | null;
  recalledAt: string | null;
  deletedAt: string | null;
  imagePurgedAt: string | null;
};

export type ChatSession = {
  id: string;
  status: string;
  visitorKey: string | null;
  userId: string | null;
  customerName: string | null;
  customerRemarkName: string | null;
  assignedOperatorId: string | null;
  archivedAt: string | null;
  deletedAt: string | null;
  purgedAt: string | null;
  historyClearedAt: string | null;
  createdAt: string;
  updatedAt: string;
  unreadCount: number;
};

export type AdminIdentity = {
  id: string;
  username: string;
  role: 'SUPER_ADMIN' | 'OPERATOR';
  mustChangePassword?: boolean;
};

export type OperatorSummary = {
  id: string;
  username: string;
  isDisabled?: boolean;
  online?: boolean;
  lastSeenAt?: string | null;
};

export type StaffMessage = {
  id: string;
  senderAdminId: string;
  senderName: string;
  content: string;
  createdAt: string;
};

export type ClearHistoryCounts = {
  messages: number;
  attachments: number;
  r2Objects: number;
};

export type ClearHistoryPlan = {
  session: ChatSession;
  counts: ClearHistoryCounts;
};

export type ChatSessionGroup = SessionGroup;
`);

write('src/chat/dto.ts', String.raw`
import type { MessageStatus, MessageType, SenderType } from './types';

export type ChatMessageDto = {
  id?: unknown;
  session_id?: unknown;
  sessionId?: unknown;
  sender_type?: unknown;
  senderType?: unknown;
  sender_id?: unknown;
  senderId?: unknown;
  content?: unknown;
  message_type?: unknown;
  messageType?: unknown;
  image_path?: unknown;
  imagePath?: unknown;
  status?: unknown;
  created_at?: unknown;
  createdAt?: unknown;
  read_at?: unknown;
  readAt?: unknown;
  is_read?: unknown;
  isRead?: unknown;
  quote_message_id?: unknown;
  quoteMessageId?: unknown;
  client_message_id?: unknown;
  clientMessageId?: unknown;
  recalled_at?: unknown;
  recalledAt?: unknown;
  deleted_at?: unknown;
  deletedAt?: unknown;
  image_purged_at?: unknown;
  imagePurgedAt?: unknown;
};

export type ChatSessionDto = {
  id?: unknown;
  status?: unknown;
  visitor_key?: unknown;
  visitorKey?: unknown;
  user_id?: unknown;
  userId?: unknown;
  customer_name?: unknown;
  customerName?: unknown;
  customer_remark_name?: unknown;
  customerRemarkName?: unknown;
  assigned_operator_id?: unknown;
  assignedOperatorId?: unknown;
  archived_at?: unknown;
  archivedAt?: unknown;
  deleted_at?: unknown;
  deletedAt?: unknown;
  purged_at?: unknown;
  purgedAt?: unknown;
  history_cleared_at?: unknown;
  historyClearedAt?: unknown;
  created_at?: unknown;
  createdAt?: unknown;
  updated_at?: unknown;
  updatedAt?: unknown;
  unread_count?: unknown;
  unreadCount?: unknown;
};

export type NormalizedMessageFields = {
  status: MessageStatus;
  messageType: MessageType;
  senderType: SenderType;
};
`);

write('src/chat/mappers.ts', String.raw`
import type { ChatMessageDto, ChatSessionDto } from './dto';
import type {
  ChatMessage,
  ChatSession,
  MessageStatus,
  MessageType,
  SenderType,
} from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function first(value: unknown, fallback: unknown) {
  return value === undefined ? fallback : value;
}

function requiredString(value: unknown, field: string) {
  if (typeof value !== 'string' || !value) throw new Error(`Invalid ${field}`);
  return value;
}

function optionalString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function nullableString(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function booleanValue(value: unknown) {
  return value === true || value === 1 || value === '1';
}

export function normalizeMessageStatus(value: unknown): MessageStatus {
  return value === 'sending'
    || value === 'sent'
    || value === 'read'
    || value === 'failed'
    || value === 'recalled'
    ? value
    : 'sent';
}

function normalizeSenderType(value: unknown): SenderType {
  if (value === 'OPERATOR' || value === 'VISITOR') return value;
  throw new Error('Invalid senderType');
}

function normalizeMessageType(value: unknown): MessageType {
  return value === 'image' ? 'image' : 'text';
}

export function mapChatMessageDto(dto: ChatMessageDto): ChatMessage {
  const sessionId = requiredString(first(dto.session_id, dto.sessionId), 'message.sessionId');
  return {
    id: requiredString(dto.id, 'message.id'),
    sessionId,
    senderType: normalizeSenderType(first(dto.sender_type, dto.senderType)),
    senderId: nullableString(first(dto.sender_id, dto.senderId)),
    content: optionalString(dto.content),
    messageType: normalizeMessageType(first(dto.message_type, dto.messageType)),
    imagePath: nullableString(first(dto.image_path, dto.imagePath)),
    status: normalizeMessageStatus(dto.status),
    createdAt: optionalString(first(dto.created_at, dto.createdAt)),
    readAt: nullableString(first(dto.read_at, dto.readAt)),
    isRead: booleanValue(first(dto.is_read, dto.isRead)),
    quoteMessageId: nullableString(first(dto.quote_message_id, dto.quoteMessageId)),
    clientMessageId: nullableString(first(dto.client_message_id, dto.clientMessageId)),
    recalledAt: nullableString(first(dto.recalled_at, dto.recalledAt)),
    deletedAt: nullableString(first(dto.deleted_at, dto.deletedAt)),
    imagePurgedAt: nullableString(first(dto.image_purged_at, dto.imagePurgedAt)),
  };
}

export function mapChatSessionDto(dto: ChatSessionDto): ChatSession {
  return {
    id: requiredString(dto.id, 'session.id'),
    status: optionalString(dto.status, 'PENDING'),
    visitorKey: nullableString(first(dto.visitor_key, dto.visitorKey)),
    userId: nullableString(first(dto.user_id, dto.userId)),
    customerName: nullableString(first(dto.customer_name, dto.customerName)),
    customerRemarkName: nullableString(first(dto.customer_remark_name, dto.customerRemarkName)),
    assignedOperatorId: nullableString(first(dto.assigned_operator_id, dto.assignedOperatorId)),
    archivedAt: nullableString(first(dto.archived_at, dto.archivedAt)),
    deletedAt: nullableString(first(dto.deleted_at, dto.deletedAt)),
    purgedAt: nullableString(first(dto.purged_at, dto.purgedAt)),
    historyClearedAt: nullableString(first(dto.history_cleared_at, dto.historyClearedAt)),
    createdAt: optionalString(first(dto.created_at, dto.createdAt)),
    updatedAt: optionalString(first(dto.updated_at, dto.updatedAt)),
    unreadCount: Number(first(dto.unread_count, dto.unreadCount) || 0),
  };
}

const knownKeyMap: Record<string, string> = {
  must_change_password: 'mustChangePassword',
  is_disabled: 'isDisabled',
  last_seen_at: 'lastSeenAt',
  sender_admin_id: 'senderAdminId',
  sender_name: 'senderName',
  display_name: 'displayName',
  source_operator_id: 'sourceOperatorId',
  expires_at: 'expiresAt',
  created_at: 'createdAt',
  updated_at: 'updatedAt',
};

function looksLikeMessage(value: Record<string, unknown>) {
  return Boolean(
    value.id
    && (value.session_id || value.sessionId)
    && (value.sender_type || value.senderType),
  );
}

function looksLikeSession(value: Record<string, unknown>) {
  return Boolean(
    value.id
    && typeof value.status === 'string'
    && (
      'user_id' in value
      || 'userId' in value
      || 'archived_at' in value
      || 'archivedAt' in value
      || 'assigned_operator_id' in value
      || 'assignedOperatorId' in value
      || 'unread_count' in value
      || 'unreadCount' in value
    ),
  );
}

export function normalizeApiPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeApiPayload);
  if (!isRecord(value)) return value;
  if (looksLikeMessage(value)) return mapChatMessageDto(value);
  if (looksLikeSession(value)) return mapChatSessionDto(value);

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    result[knownKeyMap[key] || key] = normalizeApiPayload(item);
  }
  return result;
}
`);

write('src/chat/events.ts', String.raw`
import type { ChatMessage, ChatSession } from './types';

export type MessageCreatedEvent = {
  type: 'message:new' | 'message_created';
  sessionId: string;
  message: ChatMessage;
  session?: ChatSession;
};

export type MessageUpdatedEvent = {
  type: 'message:updated';
  sessionId: string;
  message: ChatMessage;
};

export type MessageDeletedEvent = {
  type: 'message:deleted';
  sessionId: string;
  messageId: string;
};

export type MessagesReadEvent = {
  type: 'messages:read';
  sessionId: string;
  messageIds: string[];
  readAt: string;
};

export type SessionUpdatedEvent = {
  type: 'session:updated';
  sessionId: string;
  session: ChatSession;
};

export type SessionsChangedEvent = {
  type: 'sessions:changed';
  timestamp: number;
};

export type ChatRealtimeEvent =
  | MessageCreatedEvent
  | MessageUpdatedEvent
  | MessageDeletedEvent
  | MessagesReadEvent
  | SessionUpdatedEvent
  | SessionsChangedEvent;
`);

write('src/chat/eventParser.ts', String.raw`
import type { ChatMessageDto, ChatSessionDto } from './dto';
import type { ChatRealtimeEvent } from './events';
import { mapChatMessageDto, mapChatSessionDto } from './mappers';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value ? value : '';
}

function parseMessage(value: unknown) {
  if (!isRecord(value)) return null;
  try {
    return mapChatMessageDto(value as ChatMessageDto);
  } catch {
    return null;
  }
}

function parseSession(value: unknown) {
  if (!isRecord(value)) return null;
  try {
    return mapChatSessionDto(value as ChatSessionDto);
  } catch {
    return null;
  }
}

export function parseChatRealtimeEvent(value: unknown): ChatRealtimeEvent | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;
  const explicitSessionId = stringValue(value.sessionId) || stringValue(value.conversationId);

  if (value.type === 'message:new' || value.type === 'message_created') {
    const message = parseMessage(value.message);
    if (!message) return null;
    const sessionId = explicitSessionId || message.sessionId;
    if (!sessionId) return null;
    const session = parseSession(value.session);
    return { type: value.type, sessionId, message, ...(session ? { session } : {}) };
  }

  if (value.type === 'message:updated') {
    const message = parseMessage(value.message);
    if (!message) return null;
    const sessionId = explicitSessionId || message.sessionId;
    return sessionId ? { type: value.type, sessionId, message } : null;
  }

  if (value.type === 'message:deleted') {
    const messageId = stringValue(value.messageId);
    return explicitSessionId && messageId
      ? { type: value.type, sessionId: explicitSessionId, messageId }
      : null;
  }

  if (value.type === 'messages:read') {
    const messageIds = Array.isArray(value.messageIds)
      ? value.messageIds.filter((id): id is string => typeof id === 'string' && Boolean(id))
      : [];
    const readAt = stringValue(value.readAt);
    return explicitSessionId && readAt
      ? { type: value.type, sessionId: explicitSessionId, messageIds, readAt }
      : null;
  }

  if (value.type === 'session:updated') {
    const session = parseSession(value.session);
    if (!session) return null;
    const sessionId = explicitSessionId || session.id;
    return sessionId ? { type: value.type, sessionId, session } : null;
  }

  if (value.type === 'sessions:changed') {
    const timestamp = Number(value.timestamp ?? value.ts ?? Date.now());
    return Number.isFinite(timestamp) ? { type: value.type, timestamp } : null;
  }

  return null;
}
`);

write('src/chat/messageMerge.ts', String.raw`
import type { ChatMessage } from './types';

function isServerMessage(message: ChatMessage) {
  return !message.id.startsWith('local-')
    && message.status !== 'sending'
    && message.status !== 'failed';
}

export function preferServerMessage(current: ChatMessage, incoming: ChatMessage) {
  if (isServerMessage(current) && !isServerMessage(incoming)) return current;
  return incoming;
}

export function sortMessages(messages: ChatMessage[]) {
  return messages.slice().sort((left, right) => {
    const byTime = left.createdAt.localeCompare(right.createdAt);
    return byTime || left.id.localeCompare(right.id);
  });
}

export function mergeMessage(messages: ChatMessage[], incoming?: ChatMessage) {
  if (!incoming) return messages;
  const index = messages.findIndex((current) =>
    current.id === incoming.id
    || Boolean(
      current.clientMessageId
      && incoming.clientMessageId
      && current.clientMessageId === incoming.clientMessageId,
    ),
  );
  if (index < 0) return sortMessages([...messages, incoming]);
  const next = messages.slice();
  next[index] = preferServerMessage(messages[index], incoming);
  return sortMessages(next);
}

export function mergeMessages(messages: ChatMessage[], incoming: ChatMessage[] = []) {
  return incoming.reduce(mergeMessage, messages);
}

export function markMessageFailed(messages: ChatMessage[], id: string) {
  return messages.map((message) => message.id === id ? { ...message, status: 'failed' as const } : message);
}

export function lastServerMessageTime(messages: ChatMessage[]) {
  return messages.reduce((latest, message) => {
    if (
      !message.createdAt
      || message.id.startsWith('local-')
      || message.status === 'sending'
      || message.status === 'failed'
    ) return latest;
    return !latest || message.createdAt > latest ? message.createdAt : latest;
  }, '');
}
`);

write('src/chat/messageIds.ts', String.raw`
export function newClientMessageId() {
  const id = crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return `cm_${id}`;
}

export function localMessageId(clientMessageId: string) {
  return `local-${clientMessageId}`;
}
`);

write('src/chat/polling.ts', String.raw`
export function fallbackDelay(misses: number) {
  return misses < 3 ? 2000 : misses < 12 ? 5000 : 10000;
}
`);

write('src/chat/telemetry.ts', String.raw`
export function recordChatMetric(
  name: string,
  started: number,
  extra: Record<string, number | string> = {},
) {
  console.debug('[chat_metric]', name, Math.round(performance.now() - started), extra);
}
`);

write('src/chatModel.ts', String.raw`
export * from './chat/types';
export * from './chat/dto';
export * from './chat/mappers';
export * from './chat/events';
export * from './chat/eventParser';
export * from './chat/messageMerge';
export * from './chat/messageIds';
export * from './chat/polling';
export * from './chat/telemetry';
export {
  sessionBucketOf,
  sessionGroupOf,
  isSessionEnded,
} from './domain/sessionState';

import type { ChatMessage, ChatSession } from './chat/types';
import { sessionBucketOf, sessionGroupOf, isSessionEnded } from './domain/sessionState';

export function isMessageCreatedEvent(type?: string) {
  return type === 'message:new' || type === 'message_created';
}

export function messageSessionId(message?: ChatMessage | null) {
  return message?.sessionId || '';
}

export function sessionGroupForChat(session?: ChatSession | null) {
  return sessionGroupOf(session);
}

export function sessionBucketForChat(session?: ChatSession | null) {
  return sessionBucketOf(session);
}

export function sessionEndedForChat(session?: ChatSession | null) {
  return isSessionEnded(session);
}
`);

update('src/api.ts', (source) => {
  let next = source;
  next = replaceRequired(
    next,
    "import { isAbortControllerSupported, isAbortError } from './compat';",
    "import { isAbortControllerSupported, isAbortError } from './compat';\nimport { normalizeApiPayload } from './chat/mappers';",
    'api mapper import',
  );
  next = replaceRequired(
    next,
    '    const data = await parseBody(response);\n    if (!response.ok) throw new ApiError(messageForStatus(response.status, data, pathFromInput(input)), response.status, data);\n    return data;',
    "    const rawData = await parseBody(response);\n    if (!response.ok) throw new ApiError(messageForStatus(response.status, rawData, pathFromInput(input)), response.status, rawData);\n    return normalizeApiPayload(rawData);",
    'api response mapping',
  );
  return next;
});

const keyReplacements = [
  ['session_id', 'sessionId'],
  ['sender_type', 'senderType'],
  ['sender_id', 'senderId'],
  ['message_type', 'messageType'],
  ['image_path', 'imagePath'],
  ['created_at', 'createdAt'],
  ['read_at', 'readAt'],
  ['is_read', 'isRead'],
  ['quote_message_id', 'quoteMessageId'],
  ['client_message_id', 'clientMessageId'],
  ['recalled_at', 'recalledAt'],
  ['deleted_at', 'deletedAt'],
  ['image_purged_at', 'imagePurgedAt'],
  ['visitor_key', 'visitorKey'],
  ['user_id', 'userId'],
  ['customer_name', 'customerName'],
  ['customer_remark_name', 'customerRemarkName'],
  ['assigned_operator_id', 'assignedOperatorId'],
  ['archived_at', 'archivedAt'],
  ['purged_at', 'purgedAt'],
  ['history_cleared_at', 'historyClearedAt'],
  ['updated_at', 'updatedAt'],
  ['unread_count', 'unreadCount'],
  ['must_change_password', 'mustChangePassword'],
  ['is_disabled', 'isDisabled'],
  ['last_seen_at', 'lastSeenAt'],
  ['sender_admin_id', 'senderAdminId'],
  ['sender_name', 'senderName'],
  ['display_name', 'displayName'],
  ['source_operator_id', 'sourceOperatorId'],
  ['expires_at', 'expiresAt'],
];

for (const file of [...listFiles('src/admin'), ...listFiles('src/visitor')]) {
  if (!/\.(?:ts|tsx)$/.test(file)) continue;
  update(file, (source) => {
    let next = source;
    for (const [from, to] of keyReplacements) next = next.replace(new RegExp(`\\b${from}\\b`, 'g'), to);
    return next;
  });
}

update('src/admin/activeSessionGuard.ts', (source) => source
  .replace("  const item = message as { sessionId?: unknown; sessionId?: unknown } | null | undefined;\n  const sessionId = String(item?.sessionId || item?.sessionId || '');", "  const item = message as { sessionId?: unknown } | null | undefined;\n  const sessionId = String(item?.sessionId || '');"));

update('src/admin/AdminDashboard.tsx', (source) => {
  let next = source;
  next = replaceRequired(next, '  isSessionEnded,\n', '  isSessionEnded,\n  parseChatRealtimeEvent,\n  sessionGroupOf,\n', 'dashboard chat imports');
  next = replaceRegexRequired(
    next,
    /const isArchivedSession =[^\n]+\nconst sessionGroupOf = \(session\?: Session \| null\): SessionGroup \| null => \{[\s\S]*?\n\};\nconst fallbackCustomerName/,
    'const fallbackCustomerName',
    'dashboard local session group removal',
  );
  next = replaceRequired(
    next,
    "ws.onmessage = (e) => { try { const d = JSON.parse(e.data); if (d.type === 'sessions:changed') fetchSessions(); } catch {} };",
    "ws.onmessage = (e) => { try { const d = parseChatRealtimeEvent(JSON.parse(e.data)); if (d?.type === 'sessions:changed') fetchSessions(); } catch {} };",
    'dashboard admin ws parser',
  );
  next = next.replace(
    '        const d = JSON.parse(e.data);\n        const sidFromEvent',
    '        const d = parseChatRealtimeEvent(JSON.parse(e.data));\n        if (!d) return;\n        const sidFromEvent',
  );
  return next;
});

update('src/visitor/GuestChat.tsx', (source) => {
  let next = source;
  next = replaceRequired(next, '  isSessionEnded,\n', '  isSessionEnded,\n  parseChatRealtimeEvent,\n', 'guest parser import');
  next = next.replace(
    '        const d = JSON.parse(e.data);\n        if (isMessageCreatedEvent(d.type)) {',
    '        const d = parseChatRealtimeEvent(JSON.parse(e.data));\n        if (!d) return;\n        if (isMessageCreatedEvent(d.type)) {',
  );
  return next;
});

write('src/security/cookies.ts', String.raw`
export const COOKIE_NAMES = {
  admin: 'support_admin',
  visitor: 'visitor_account',
  guest: 'guest_session',
} as const;

export function readCookie(request: Request, name: string) {
  return (request.headers.get('cookie') || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

export function serializeSessionCookie(name: string, value: string, maxAge = 86400) {
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax; Secure`;
}

export function clearSessionCookie(name: string) {
  return `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`;
}
`);

write('src/security/signing.ts', String.raw`
const encoder = new TextEncoder();

export async function hmacHex(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function constantTimeEqual(leftValue: string, rightValue: string) {
  const left = encoder.encode(leftValue);
  const right = encoder.encode(rightValue);
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) diff |= (left[index] || 0) ^ (right[index] || 0);
  return diff === 0;
}

export async function signValue(secret: string, value: string) {
  return `${value}.${await hmacHex(secret, value)}`;
}

export async function verifySignedValue(secret: string, token?: string) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [value, signature] = parts;
  if (!value || !signature) return null;
  return constantTimeEqual(signature, await hmacHex(secret, value)) ? value : null;
}
`);

write('src/security/sessionTokens.ts', String.raw`
import { hmacHex } from './signing';

export function hashSessionToken(secret: string, sessionId: string) {
  return hmacHex(secret, `session:${sessionId}`);
}
`);

write('src/security/responseHeaders.ts', String.raw`
export const SECURITY_HEADERS = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https: ws: wss:; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
} as const;

export function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...SECURITY_HEADERS,
      ...(init.headers || {}),
    },
  });
}

export function withSecurityHeaders(response: Response) {
  if ((response as Response & { webSocket?: unknown }).webSocket) return response;
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
`);

write('src/security/requestLimits.ts', String.raw`
export function contentLengthExceeds(request: Request, maxBytes: number) {
  const raw = request.headers.get('content-length');
  return Boolean(raw && Number(raw) > maxBytes);
}

export async function requestStreamExceeds(request: Request, maxBytes: number) {
  if (contentLengthExceeds(request, maxBytes)) return true;
  const reader = request.clone().body?.getReader();
  if (!reader) return false;
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return false;
      total += value?.byteLength || 0;
      if (total > maxBytes) {
        await reader.cancel();
        return true;
      }
    }
  } catch {
    return false;
  }
}

export async function readJsonObjectWithinLimit(request: Request, maxBytes: number) {
  if (await requestStreamExceeds(request, maxBytes)) return { body: {}, tooLarge: true } as const;
  const value = await request.clone().json().catch(() => null);
  const body = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return { body, tooLarge: false } as const;
}
`);

write('src/security/rateLimit.ts', String.raw`
export async function consumeRateLimit(
  database: D1Database,
  key: string,
  limit: number,
  windowMs: number,
): Promise<number | null> {
  const nowMs = Date.now();
  const resetAt = nowMs + windowMs;
  await database.prepare(
    'INSERT INTO rate_limits(key,count,reset_at) VALUES(?,0,?) ON CONFLICT(key) DO NOTHING',
  ).bind(key, resetAt).run();
  const consumed = await database.prepare(
    `UPDATE rate_limits
        SET count=CASE WHEN reset_at <= ? THEN 1 ELSE count+1 END,
            reset_at=CASE WHEN reset_at <= ? THEN ? ELSE reset_at END
      WHERE key=? AND (reset_at <= ? OR count < ?)`,
  ).bind(nowMs, nowMs, resetAt, key, nowMs, limit).run();
  if (Number(consumed?.meta?.changes || 0) > 0) return null;
  const row = await database.prepare('SELECT reset_at FROM rate_limits WHERE key=?')
    .bind(key)
    .first<{ reset_at: number }>();
  return Math.max(1, Math.ceil((Number(row?.reset_at || resetAt) - nowMs) / 1000));
}
`);

write('src/http/errors.ts', String.raw`
export type DomainErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'SESSION_NOT_FOUND'
  | 'SESSION_ENDED'
  | 'SESSION_STATE_CONFLICT'
  | 'MESSAGE_NOT_FOUND'
  | 'INVALID_INPUT'
  | 'RATE_LIMITED'
  | 'ATTACHMENT_NOT_FOUND'
  | 'ATTACHMENT_INVALID_TYPE'
  | 'ATTACHMENT_TOO_LARGE'
  | 'INTERNAL_ERROR';

export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    public readonly status: number,
    message = code,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
`);

write('src/repositories/sessionRepository.ts', String.raw`
export type SessionRecord = {
  id: string;
  status: string;
  assigned_operator_id?: string | null;
  archived_at?: string | null;
  deleted_at?: string | null;
  purged_at?: string | null;
  [key: string]: unknown;
};

export class SessionRepository {
  constructor(private readonly database: D1Database) {}

  findById(sessionId: string) {
    return this.database.prepare('SELECT * FROM sessions WHERE id=?')
      .bind(sessionId)
      .first<SessionRecord>();
  }

  async assign(sessionId: string, actorId: string, timestamp: string) {
    return this.database.prepare(
      "UPDATE sessions SET assigned_operator_id=?,last_operator_id=?,status='OPEN',updated_at=? WHERE id=? AND deleted_at IS NULL AND purged_at IS NULL",
    ).bind(actorId, actorId, timestamp, sessionId).run();
  }

  async archive(sessionId: string, actorId: string, timestamp: string) {
    return this.database.prepare(
      "UPDATE sessions SET status='ARCHIVED',closed_at=COALESCE(closed_at,?),archived_at=COALESCE(archived_at,?),archived_by=?,updated_at=? WHERE id=? AND deleted_at IS NULL AND purged_at IS NULL",
    ).bind(timestamp, timestamp, actorId, timestamp, sessionId).run();
  }

  async unarchive(sessionId: string, timestamp: string) {
    return this.database.prepare(
      `UPDATE sessions
          SET archived_at=NULL,
              archived_by=NULL,
              closed_at=NULL,
              status=CASE WHEN assigned_operator_id IS NULL THEN 'PENDING' ELSE 'OPEN' END,
              updated_at=?
        WHERE id=?
          AND deleted_at IS NULL
          AND purged_at IS NULL
          AND (archived_at IS NOT NULL OR status IN ('ARCHIVED','CLOSED'))`,
    ).bind(timestamp, sessionId).run();
  }

  async moveToTrash(sessionId: string, actorId: string, timestamp: string) {
    return this.database.prepare(
      `UPDATE sessions
          SET status='ARCHIVED',
              archived_at=COALESCE(archived_at,?),
              closed_at=COALESCE(closed_at,?),
              deleted_at=?,
              deleted_by=?,
              updated_at=?
        WHERE id=? AND deleted_at IS NULL AND purged_at IS NULL`,
    ).bind(timestamp, timestamp, timestamp, actorId, timestamp, sessionId).run();
  }

  async restore(sessionId: string, timestamp: string) {
    return this.database.prepare(
      `UPDATE sessions
          SET deleted_at=NULL,
              deleted_by=NULL,
              status='ARCHIVED',
              archived_at=COALESCE(archived_at,?),
              closed_at=COALESCE(closed_at,?),
              updated_at=?
        WHERE id=? AND deleted_at IS NOT NULL AND purged_at IS NULL`,
    ).bind(timestamp, timestamp, timestamp, sessionId).run();
  }
}
`);

write('src/services/sessionService.ts', String.raw`
import {
  canArchive,
  canMoveToTrash,
  canRestore,
  canUnarchive,
  isSessionEnded,
} from '../domain/sessionState';
import { DomainError } from '../http/errors';
import { SessionRepository, type SessionRecord } from '../repositories/sessionRepository';

export type SessionAction = 'assign' | 'close' | 'archive' | 'unarchive' | 'delete' | 'restore';
export type SessionActor = { id: string; role: string };

export class SessionService {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly canManage: (actor: SessionActor, session: SessionRecord) => boolean,
  ) {}

  async execute(actor: SessionActor, sessionId: string, action: SessionAction, timestamp: string) {
    const session = await this.sessions.findById(sessionId);
    if (!session) throw new DomainError('SESSION_NOT_FOUND', 404);
    if (!this.canManage(actor, session)) throw new DomainError('FORBIDDEN', 403);

    let result: D1Result<unknown>;
    if (action === 'assign') {
      if (isSessionEnded(session)) throw new DomainError('SESSION_ENDED', 409);
      result = await this.sessions.assign(sessionId, actor.id, timestamp);
    } else if (action === 'close' || action === 'archive') {
      if (!canArchive(session)) throw new DomainError('SESSION_ENDED', 409);
      result = await this.sessions.archive(sessionId, actor.id, timestamp);
    } else if (action === 'unarchive') {
      if (!canUnarchive(session)) throw new DomainError('SESSION_STATE_CONFLICT', 409);
      result = await this.sessions.unarchive(sessionId, timestamp);
    } else if (action === 'delete') {
      if (!canMoveToTrash(session)) throw new DomainError('SESSION_STATE_CONFLICT', 409);
      result = await this.sessions.moveToTrash(sessionId, actor.id, timestamp);
    } else {
      if (!canRestore(session)) throw new DomainError('SESSION_STATE_CONFLICT', 409);
      result = await this.sessions.restore(sessionId, timestamp);
    }

    if (Number(result.meta?.changes || 0) !== 1) throw new DomainError('SESSION_STATE_CONFLICT', 409);
    const updated = await this.sessions.findById(sessionId);
    if (!updated) throw new DomainError('INTERNAL_ERROR', 500);
    return updated;
  }
}
`);

write('src/repositories/messageRepository.ts', String.raw`
export type MessageRecord = {
  id: string;
  session_id: string;
  sender_type: 'VISITOR' | 'OPERATOR';
  sender_id: string;
  content: string;
  message_type: 'text' | 'image';
  image_path: string | null;
  status: string;
  created_at: string;
  read_at: string | null;
  is_read: number;
  quote_message_id: string | null;
  recalled_at: string | null;
  image_purged_at: string | null;
  client_message_id: string;
  deleted_at?: string | null;
};

export class MessageRepository {
  constructor(private readonly database: D1Database) {}

  findDuplicate(sessionId: string, senderType: string, senderId: string, clientMessageId: string) {
    return this.database.prepare(
      'SELECT * FROM messages WHERE session_id=? AND sender_type=? AND sender_id=? AND client_message_id=?',
    ).bind(sessionId, senderType, senderId, clientMessageId).first<MessageRecord>();
  }

  insert(message: MessageRecord) {
    return this.database.prepare(
      'INSERT INTO messages(id,session_id,sender_type,sender_id,content,message_type,image_path,status,created_at,read_at,is_read,quote_message_id,recalled_at,image_purged_at,client_message_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    ).bind(
      message.id,
      message.session_id,
      message.sender_type,
      message.sender_id,
      message.content,
      message.message_type,
      message.image_path,
      message.status,
      message.created_at,
      message.read_at,
      message.is_read,
      message.quote_message_id,
      message.recalled_at,
      message.image_purged_at,
      message.client_message_id,
    ).run();
  }

  bindAttachment(message: MessageRecord, objectKey: string) {
    return this.database.prepare(
      'UPDATE attachments SET message_id=? WHERE conversation_id=? AND object_key=? AND created_by_type=? AND created_by_id=? AND message_id IS NULL',
    ).bind(message.id, message.session_id, objectKey, message.sender_type, message.sender_id).run();
  }

  touchSession(sessionId: string, timestamp: string) {
    return this.database.prepare('UPDATE sessions SET updated_at=? WHERE id=?').bind(timestamp, sessionId).run();
  }
}
`);

write('src/services/messageService.ts', String.raw`
import { MessageRepository, type MessageRecord } from '../repositories/messageRepository';

export type CreateMessageInput = {
  sessionId: string;
  senderType: 'VISITOR' | 'OPERATOR';
  senderId: string;
  content: string;
  messageType: 'text' | 'image';
  imagePath: string | null;
  quoteMessageId: string | null;
  clientMessageId: string;
};

export class MessageService {
  constructor(
    private readonly messages: MessageRepository,
    private readonly idFactory: (prefix: string) => string,
    private readonly clock: () => string,
    private readonly attachmentKeyFromPath: (path?: string | null) => string,
  ) {}

  async create(input: CreateMessageInput) {
    const existing = await this.messages.findDuplicate(
      input.sessionId,
      input.senderType,
      input.senderId,
      input.clientMessageId,
    );
    if (existing) return { message: existing, deduped: true };

    const timestamp = this.clock();
    const message: MessageRecord = {
      id: this.idFactory('msg'),
      session_id: input.sessionId,
      sender_type: input.senderType,
      sender_id: input.senderId,
      content: input.content,
      message_type: input.messageType,
      image_path: input.imagePath,
      status: 'sent',
      created_at: timestamp,
      read_at: null,
      is_read: 0,
      quote_message_id: input.quoteMessageId,
      recalled_at: null,
      image_purged_at: null,
      client_message_id: input.clientMessageId,
    };

    try {
      await this.messages.insert(message);
    } catch (error) {
      const duplicate = await this.messages.findDuplicate(
        input.sessionId,
        input.senderType,
        input.senderId,
        input.clientMessageId,
      );
      if (duplicate) return { message: duplicate, deduped: true };
      throw error;
    }

    const attachmentKey = message.message_type === 'image'
      ? this.attachmentKeyFromPath(message.image_path)
      : '';
    if (attachmentKey) await this.messages.bindAttachment(message, attachmentKey);
    await this.messages.touchSession(input.sessionId, timestamp);
    return { message, deduped: false };
  }
}
`);

write('src/repositories/attachmentRepository.ts', String.raw`
export class AttachmentRepository {
  constructor(private readonly database: D1Database) {}

  insert(input: {
    id: string;
    sessionId: string;
    objectKey: string;
    mimeType: string;
    byteSize: number;
    createdAt: string;
    createdByType: 'VISITOR' | 'OPERATOR';
    createdById: string;
    expiresAt: string;
  }) {
    return this.database.prepare(
      'INSERT INTO attachments(id,message_id,conversation_id,object_key,file_name,mime_type,byte_size,created_at,created_by_type,created_by_id,expires_at,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL)',
    ).bind(
      input.id,
      null,
      input.sessionId,
      input.objectKey,
      null,
      input.mimeType,
      input.byteSize,
      input.createdAt,
      input.createdByType,
      input.createdById,
      input.expiresAt,
    ).run();
  }
}
`);

write('src/services/attachmentService.ts', String.raw`
import { DomainError } from '../http/errors';
import { AttachmentRepository } from '../repositories/attachmentRepository';

const allowedTypes: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export class AttachmentService {
  constructor(
    private readonly attachments: AttachmentRepository,
    private readonly uploads: R2Bucket,
    private readonly idFactory: (prefix: string) => string,
    private readonly clock: () => string,
  ) {}

  async upload(input: {
    sessionId: string;
    file: File;
    createdByType: 'VISITOR' | 'OPERATOR';
    createdById: string;
  }) {
    const extension = allowedTypes[input.file.type];
    if (!extension) throw new DomainError('ATTACHMENT_INVALID_TYPE', 400);
    if (input.file.size > 5 * 1024 * 1024) throw new DomainError('ATTACHMENT_TOO_LARGE', 413);

    const objectKey = `${crypto.randomUUID()}.${extension}`;
    await this.uploads.put(objectKey, input.file.stream(), { httpMetadata: { contentType: input.file.type } });
    const createdAt = this.clock();
    await this.attachments.insert({
      id: this.idFactory('att'),
      sessionId: input.sessionId,
      objectKey,
      mimeType: input.file.type,
      byteSize: input.file.size,
      createdAt,
      createdByType: input.createdByType,
      createdById: input.createdById,
      expiresAt: new Date(Date.parse(createdAt) + 7 * 86400000).toISOString(),
    });
    return { path: `/api/attachments/${objectKey}` };
  }
}
`);

let worker = read('src/worker.ts');
worker = replaceRequired(
  worker,
  "import { runLifecycle } from './sessionLifecycle';",
  "import { runLifecycle } from './sessionLifecycle';\nimport { canSendMessage as canSendByState, isSessionEnded } from './domain/sessionState';\nimport { DomainError } from './http/errors';\nimport { SessionRepository } from './repositories/sessionRepository';\nimport { MessageRepository } from './repositories/messageRepository';\nimport { AttachmentRepository } from './repositories/attachmentRepository';\nimport { SessionService, type SessionAction } from './services/sessionService';\nimport { MessageService } from './services/messageService';\nimport { AttachmentService } from './services/attachmentService';\nimport { COOKIE_NAMES, clearSessionCookie, readCookie, serializeSessionCookie } from './security/cookies';\nimport { constantTimeEqual, hmacHex, signValue, verifySignedValue } from './security/signing';\nimport { hashSessionToken } from './security/sessionTokens';\nimport { jsonResponse } from './security/responseHeaders';",
  'worker imports',
);
worker = worker.replace("const ADMIN_COOKIE = 'support_admin';", 'const ADMIN_COOKIE = COOKIE_NAMES.admin;');
worker = worker.replace("const VISITOR_COOKIE = 'visitor_account';", 'const VISITOR_COOKIE = COOKIE_NAMES.visitor;');
worker = worker.replace("const GUEST_COOKIE = 'guest_session';", 'const GUEST_COOKIE = COOKIE_NAMES.guest;');
worker = worker.replace("const HSTS_HEADER = 'max-age=31536000; includeSubDomains';\n", '');
worker = replaceRequired(
  worker,
  "const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { ...init, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Strict-Transport-Security': HSTS_HEADER, ...(init.headers || {}) } });",
  'const json = jsonResponse;',
  'worker json implementation',
);
worker = replaceRequired(
  worker,
  "const getCookie = (req: Request, name: string) => (req.headers.get('cookie') || '').split(';').map(x => x.trim()).find(x => x.startsWith(`${name}=`))?.slice(name.length + 1);\nconst setCookie = (name: string, value: string) => `${name}=${value}; Path=/; Max-Age=86400; HttpOnly; SameSite=Lax; Secure`;\nconst clearCookie = (name: string) => `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`;",
  'const getCookie = readCookie;\nconst setCookie = serializeSessionCookie;\nconst clearCookie = clearSessionCookie;',
  'worker cookie implementation',
);
worker = replaceRegexRequired(
  worker,
  /async function hmac\(secret: string, value: string\) \{[^\n]+\}\nasync function makeToken\(env: Env, value: string\) \{[^\n]+\}\nasync function verifyToken\(env: Env, token\?: string\) \{[^\n]+\}\nasync function tokenHash\(env: Env, value: string\) \{[^\n]+\}/,
  "async function hmac(secret: string, value: string) { return hmacHex(secret, value); }\nasync function makeToken(env: Env, value: string) { return signValue(env.SESSION_SECRET, value); }\nasync function verifyToken(env: Env, token?: string) { return verifySignedValue(env.SESSION_SECRET, token); }\nasync function tokenHash(env: Env, value: string) { return hashSessionToken(env.SESSION_SECRET, value); }",
  'worker signing implementation',
);
worker = replaceRegexRequired(
  worker,
  /function constantTimeEqual\(a: string, b: string\) \{[^\n]+\}\n/,
  '',
  'worker constant time implementation',
);
worker = replaceRequired(
  worker,
  "function sessionEnded(session?: SessionRecord | null) {\n  return Boolean(!session || session.deleted_at || session.purged_at || session.status === 'CLOSED' || session.status === 'ARCHIVED');\n}",
  "function sessionEnded(session?: SessionRecord | null) {\n  return isSessionEnded(session);\n}",
  'worker session ended delegate',
);
worker = replaceRequired(
  worker,
  'function canSendMessage(admin: Admin | null, session: SessionRecord | null) {\n  return canAccessSession(admin, session) && !sessionEnded(session);\n}',
  'function canSendMessage(admin: Admin | null, session: SessionRecord | null) {\n  return canAccessSession(admin, session) && canSendByState(session);\n}',
  'worker can send delegate',
);

worker = replaceRegexRequired(
  worker,
  /async function createMessage\(req: Request, env: Env\) \{[\s\S]*?\n\}\ntype SessionAction = 'assign' \| 'close' \| 'archive' \| 'unarchive' \| 'delete' \| 'restore';/,
  String.raw`async function createMessage(req: Request, env: Env) {
  const body = await readJson(req);
  const admin = await currentAdmin(env, req);
  const senderType: 'VISITOR' | 'OPERATOR' =
    (body.senderType || (admin ? 'OPERATOR' : 'VISITOR')) === 'OPERATOR'
      ? 'OPERATOR'
      : 'VISITOR';
  let senderId = '';
  let sessionId = String(body.sessionId || '');
  let session: SessionRecord | null = null;

  if (senderType === 'OPERATOR') {
    if (!admin) return json({ error: ERR_LOGIN_REQUIRED }, { status: 401 });
    session = await getSessionById(env, sessionId);
    if (!session) return json({ error: ERR_SESSION_NOT_FOUND }, { status: 404 });
    if (!canAccessSession(admin, session)) return json({ error: ERR_NO_SESSION_ACCESS }, { status: 403 });
    if (!canSendMessage(admin, session)) return json({ error: ERR_SESSION_ENDED }, { status: 400 });
    senderId = admin.id;
  } else {
    const guest = await currentGuestSession(env, req);
    if (!guest) return invalidInvite();
    sessionId = sessionId || guest.session.id;
    session = await getSessionById(env, sessionId);
    if (!session || guest.session.id !== session.id || guest.user.id !== session.user_id) {
      return json({ error: ERR_NO_SESSION_ACCESS }, { status: 403 });
    }
    if (sessionEnded(session)) return json({ error: ERR_SESSION_ENDED }, { status: 400 });
    senderId = guest.visitorKey;
  }

  const rawClientId = typeof body.clientMessageId === 'string' ? body.clientMessageId.trim() : '';
  const clientMessageId = rawClientId ? rawClientId.slice(0, 120) : `server:${rid('cmid')}`;
  const service = new MessageService(new MessageRepository(env.DB), rid, now, attachmentKeyFromPath);
  const result = await service.create({
    sessionId,
    senderType,
    senderId,
    clientMessageId,
    content: String(body.content || ''),
    messageType: body.messageType === 'image' ? 'image' : 'text',
    imagePath: typeof body.imagePath === 'string' ? body.imagePath : null,
    quoteMessageId: typeof body.quoteMessageId === 'string' ? body.quoteMessageId : null,
  });
  if (result.deduped) {
    return json({ message: result.message, session: sessionForAudience(session, admin), deduped: true });
  }

  session = await getSessionById(env, sessionId);
  await broadcast(env, `conversation:${sessionId}`, {
    type: 'message:new',
    conversationId: sessionId,
    message: result.message,
    session: publicGuestSession(session),
  });
  await notifyAdmins(env);
  return json({ message: result.message, session: sessionForAudience(session, admin) });
}`,
  'worker message service extraction',
);

worker = replaceRegexRequired(
  worker,
  /async function sessionAction\(req: Request, env: Env, sessionId: string, action: SessionAction\) \{[\s\S]*?\n\}\nasync function bindGuest/,
  String.raw`async function sessionAction(req: Request, env: Env, sessionId: string, action: SessionAction) {
  const admin = await requireAdmin(env, req);
  const service = new SessionService(
    new SessionRepository(env.DB),
    (actor, session) => canManageSession(actor as Admin, session as SessionRecord),
  );
  try {
    const session = await service.execute(admin, sessionId, action, now());
    await broadcast(env, `conversation:${sessionId}`, {
      type: 'session:updated',
      conversationId: sessionId,
      session: publicGuestSession(session as SessionRecord),
    });
    await notifyAdmins(env);
    return json({ ok: true, session });
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    if (error.code === 'SESSION_NOT_FOUND') return json({ error: ERR_SESSION_NOT_FOUND }, { status: error.status });
    if (error.code === 'FORBIDDEN') return json({ error: ERR_NO_SESSION_ACCESS }, { status: error.status });
    return json({ error: ERR_SESSION_ENDED, code: error.code }, { status: error.status });
  }
}
async function bindGuest`,
  'worker session service extraction',
);

worker = replaceRegexRequired(
  worker,
  /async function upload\(req: Request, env: Env\) \{[^\n]+\}\nasync function api/,
  String.raw`async function upload(req: Request, env: Env) {
  const url = new URL(req.url);
  const sessionId = String(url.searchParams.get('sessionId') || '');
  if (!sessionId) return json({ error: ERR_MISSING_SESSION }, { status: 400 });
  const session = await getSessionById(env, sessionId);
  if (!session) return json({ error: ERR_NO_SESSION_ACCESS }, { status: 403 });

  const admin = await currentAdmin(env, req);
  let createdByType: 'VISITOR' | 'OPERATOR' = 'VISITOR';
  let createdById = '';
  if (admin) {
    if (!canAccessSession(admin, session)) return json({ error: ERR_NO_SESSION_ACCESS }, { status: 403 });
    if (!canUploadAttachment(admin, session)) return json({ error: ERR_SESSION_ENDED }, { status: 400 });
    createdByType = 'OPERATOR';
    createdById = admin.id;
  } else {
    const guest = await currentGuestSession(env, req);
    if (!guest || guest.session.id !== session.id || guest.user.id !== session.user_id) {
      return json({ error: ERR_NO_SESSION_ACCESS }, { status: 403 });
    }
    if (sessionEnded(session)) return json({ error: ERR_SESSION_ENDED }, { status: 400 });
    createdById = guest.visitorKey;
  }

  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return json({ error: ERR_PICK_IMAGE }, { status: 400 });
  const service = new AttachmentService(new AttachmentRepository(env.DB), env.UPLOADS, rid, now);
  try {
    return json(await service.upload({ sessionId, file, createdByType, createdById }));
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    if (error.code === 'ATTACHMENT_INVALID_TYPE') return json({ error: ERR_IMAGE_TYPE }, { status: error.status });
    if (error.code === 'ATTACHMENT_TOO_LARGE') return json({ error: ERR_IMAGE_SIZE }, { status: error.status });
    throw error;
  }
}
async function api`,
  'worker attachment service extraction',
);

write('src/runtimeWorker.ts', worker);
write('src/worker.ts', String.raw`
export { ChatRoom } from './durable-objects/ChatRoom';
export type { Env } from './runtimeWorker';
export { default } from './runtimeWorker';
`);

for (const file of listFiles('scripts')) {
  if (!file.endsWith('.mjs') || file === 'scripts/apply-maintainability-stage2.mjs') continue;
  update(file, (source) => source.replaceAll("'src/worker.ts'", "'src/runtimeWorker.ts'"));
}

update('src/worker-secure.ts', (source) => {
  let next = source;
  next = replaceRequired(
    next,
    "import type { Env } from './worker';",
    "import type { Env } from './worker';\nimport { COOKIE_NAMES, clearSessionCookie, readCookie } from './security/cookies';\nimport { hmacHex, verifySignedValue } from './security/signing';\nimport { hashSessionToken } from './security/sessionTokens';\nimport { jsonResponse, withSecurityHeaders } from './security/responseHeaders';\nimport { contentLengthExceeds, requestStreamExceeds } from './security/requestLimits';\nimport { consumeRateLimit } from './security/rateLimit';",
    'secure imports',
  );
  next = next.replace("const ADMIN_COOKIE = 'support_admin';", 'const ADMIN_COOKIE = COOKIE_NAMES.admin;');
  next = next.replace("const VISITOR_COOKIE = 'visitor_account';", 'const VISITOR_COOKIE = COOKIE_NAMES.visitor;');
  next = next.replace("const GUEST_COOKIE = 'guest_session';", 'const GUEST_COOKIE = COOKIE_NAMES.guest;');
  next = next.replace(/const enc = new TextEncoder\(\);\n/, '');
  next = replaceRegexRequired(next, /const SECURITY_HEADERS = \{[\s\S]*?\n\};\n\nfunction json\([\s\S]*?\n\}\n\nfunction withSecurityHeaders\([\s\S]*?\n\}\n/, 'const json = jsonResponse;\n', 'secure response primitives');
  next = replaceRegexRequired(next, /async function requestStreamExceeds[\s\S]*?\n\}\n\nfunction contentLengthExceeds[\s\S]*?\n\}\n/, '', 'secure request limits');
  next = replaceRegexRequired(next, /function getCookie[\s\S]*?\n\}\n\nfunction clearCookie[\s\S]*?\n\}\n\nasync function hmac[\s\S]*?\n\}\n\nfunction constantTimeEqual[\s\S]*?\n\}\n\nasync function verifySignedId[\s\S]*?\n\}\n\nasync function tokenHash[\s\S]*?\n\}\n/, String.raw`const getCookie = readCookie;
const clearCookie = clearSessionCookie;
async function hmac(secret: string, value: string) { return hmacHex(secret, value); }
async function verifySignedId(env: Env, token?: string) { return verifySignedValue(env.SESSION_SECRET, token); }
async function tokenHash(env: Env, value: string) { return hashSessionToken(env.SESSION_SECRET, value); }
`, 'secure signing primitives');
  next = replaceRegexRequired(next, /async function consumeLimit\(env: Env, key: string, limit: number, windowMs: number\) \{[\s\S]*?\n\}\n/, String.raw`async function consumeLimit(env: Env, key: string, limit: number, windowMs: number) {
  const retryAfter = await consumeRateLimit(env.DB, key, limit, windowMs);
  return retryAfter === null
    ? null
    : json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(retryAfter) } });
}
`, 'secure rate limit primitive');
  return next;
});

update('src/worker-business-hardening.ts', (source) => {
  let next = source;
  next = replaceRequired(
    next,
    "import type { Env } from './worker';",
    "import type { Env } from './worker';\nimport { COOKIE_NAMES, readCookie } from './security/cookies';\nimport { verifySignedValue } from './security/signing';\nimport { hashSessionToken } from './security/sessionTokens';\nimport { jsonResponse } from './security/responseHeaders';\nimport { readJsonObjectWithinLimit } from './security/requestLimits';\nimport { consumeRateLimit } from './security/rateLimit';",
    'business imports',
  );
  next = next.replace("const ADMIN_COOKIE = 'support_admin';", 'const ADMIN_COOKIE = COOKIE_NAMES.admin;');
  next = next.replace("const GUEST_COOKIE = 'guest_session';", 'const GUEST_COOKIE = COOKIE_NAMES.guest;');
  next = next.replace(/const enc = new TextEncoder\(\);\n/, '');
  next = replaceRegexRequired(next, /function json\(body: unknown, status = 200\) \{[\s\S]*?\n\}\n/, "function json(body: unknown, status = 200) { return jsonResponse(body, { status }); }\n", 'business response primitive');
  next = replaceRegexRequired(next, /function getCookie[\s\S]*?\n\}\n\nasync function hmac[\s\S]*?\n\}\n\nasync function verifySignedId[\s\S]*?\n\}\n\nasync function tokenHash[\s\S]*?\n\}\n/, String.raw`const getCookie = readCookie;
async function verifySignedId(env: Env, token?: string) { return verifySignedValue(env.SESSION_SECRET, token); }
async function tokenHash(env: Env, value: string) { return hashSessionToken(env.SESSION_SECRET, value); }
`, 'business signing primitives');
  next = replaceRegexRequired(next, /function requestBodyTooLarge[\s\S]*?\n\}\n\nfunction jsonObject[\s\S]*?\n\}\n\nasync function readJsonWithinLimit[\s\S]*?\n\}\n/, "async function readJsonWithinLimit(req: Request) { return readJsonObjectWithinLimit(req, JSON_REQUEST_MAX_BYTES); }\n", 'business request limits');
  next = replaceRegexRequired(next, /async function mutationRateLimit\(env: Env, req: Request\) \{[\s\S]*?\n\}\n/, String.raw`async function mutationRateLimit(env: Env, req: Request) {
  const ip = req.headers.get('cf-connecting-ip') || 'unknown';
  const path = new URL(req.url).pathname;
  const key = `hardening:${ip}:${path}`.slice(0, 240);
  const retryAfter = await consumeRateLimit(env.DB, key, 20, 60 * 1000);
  return retryAfter === null ? null : json({ error: 'rate_limited', retryAfter }, 429);
}
`, 'business rate limit primitive');
  return next;
});

write('tests/unit/chatMappers.test.mjs', String.raw`
import assert from 'node:assert/strict';
import test from 'node:test';
import { mapChatMessageDto, mapChatSessionDto, normalizeApiPayload } from '../../src/chat/mappers.ts';

const rawMessage = {
  id: 'msg_1', session_id: 'sess_1', sender_type: 'VISITOR', sender_id: 'visitor_1',
  content: 'hello', message_type: 'text', image_path: null, status: 'sent',
  created_at: '2026-07-31T00:00:00.000Z', is_read: 0,
};

test('maps legacy message DTO to one camelCase domain model', () => {
  assert.deepEqual(mapChatMessageDto(rawMessage), {
    id: 'msg_1', sessionId: 'sess_1', senderType: 'VISITOR', senderId: 'visitor_1',
    content: 'hello', messageType: 'text', imagePath: null, status: 'sent',
    createdAt: '2026-07-31T00:00:00.000Z', readAt: null, isRead: false,
    quoteMessageId: null, clientMessageId: null, recalledAt: null, deletedAt: null, imagePurgedAt: null,
  });
});

test('maps legacy session DTO and normalizes nested API payloads', () => {
  const session = mapChatSessionDto({ id: 'sess_1', status: 'OPEN', assigned_operator_id: 'admin_1', unread_count: 2 });
  assert.equal(session.assignedOperatorId, 'admin_1');
  assert.equal(session.unreadCount, 2);
  const payload = normalizeApiPayload({ messages: [rawMessage], session });
  assert.equal(payload.messages[0].sessionId, 'sess_1');
});
`);

write('tests/unit/chatEvents.test.mjs', String.raw`
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseChatRealtimeEvent } from '../../src/chat/eventParser.ts';

const message = {
  id: 'msg_1', session_id: 'sess_1', sender_type: 'VISITOR', sender_id: 'visitor_1',
  content: 'hello', message_type: 'text', status: 'sent', created_at: '2026-07-31T00:00:00.000Z',
};

test('parses supported realtime payload and rejects malformed payloads', () => {
  const event = parseChatRealtimeEvent({ type: 'message:new', conversationId: 'sess_1', message });
  assert.equal(event?.type, 'message:new');
  assert.equal(event?.sessionId, 'sess_1');
  assert.equal(event?.message.sessionId, 'sess_1');
  assert.equal(parseChatRealtimeEvent({}), null);
  assert.equal(parseChatRealtimeEvent({ type: 'message:new' }), null);
  assert.equal(parseChatRealtimeEvent({ type: 'messages:read', sessionId: 'sess_1' }), null);
});
`);

write('tests/unit/messageMerge.test.mjs', String.raw`
import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeMessage } from '../../src/chat/messageMerge.ts';

const base = {
  id: 'msg_1', sessionId: 'sess_1', senderType: 'VISITOR', senderId: 'visitor_1', content: 'ok',
  messageType: 'text', imagePath: null, status: 'sent', createdAt: '2026-07-31T00:00:00.000Z',
  readAt: null, isRead: false, quoteMessageId: null, clientMessageId: 'cm_1', recalledAt: null,
  deletedAt: null, imagePurgedAt: null,
};

test('does not let a local pending copy overwrite a server message', () => {
  const pending = { ...base, id: 'local-cm_1', status: 'sending' };
  assert.deepEqual(mergeMessage([base], pending), [base]);
});

test('replaces a failed optimistic message with the server result', () => {
  const failed = { ...base, id: 'local-cm_1', status: 'failed' };
  assert.deepEqual(mergeMessage([failed], base), [base]);
});
`);

update('package.json', (source) => {
  const pkg = JSON.parse(source);
  pkg.type = 'module';
  pkg.scripts['check:static-contracts'] = 'node scripts/check-session-lifecycle.mjs';
  pkg.scripts['test:unit'] = 'node --experimental-strip-types --test tests/unit/*.test.mjs';
  pkg.scripts['test:integration'] = 'node --experimental-sqlite --test tests/integration/*.test.mjs';
  pkg.scripts.test = 'npm run test:unit && npm run test:integration';
  return `${JSON.stringify(pkg, null, 2)}\n`;
});

update('.github/workflows/productization-validation.yml', (source) => source
  .replace('run: npm run check-session-lifecycle-static', 'run: npm run check:static-contracts')
  .replace('name: Root unit behavior tests\n        run: npm run test:unit', 'name: Root unit tests\n        run: npm run test:unit\n\n      - name: Root SQLite integration tests\n        run: npm run test:integration')
  .replace('name: Root unit behavior tests\n        run: npm run test:unit', 'name: Root unit tests\n        run: npm run test:unit\n\n      - name: Root SQLite integration tests\n        run: npm run test:integration'));

if (existsSync(path.join(root, '.github/workflows/apply-maintainability-stage2.yml'))) {
  rmSync(path.join(root, '.github/workflows/apply-maintainability-stage2.yml'));
}
rmSync(path.join(root, 'scripts/apply-maintainability-stage2.mjs'));

console.log('Maintainability stage 2 transformation completed.');
