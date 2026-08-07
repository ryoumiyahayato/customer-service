import { normalizeStoredStatus } from '../domain/sessionState.ts';
import type { ChatMessageDto, ChatSessionDto } from './dto.ts';
import type {
  ChatMessage,
  ChatSession,
  MessageStatus,
  MessageType,
  SenderType,
} from './types.ts';

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
    status: normalizeStoredStatus(typeof dto.status === 'string' ? dto.status : null),
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
    deviceLabel: nullableString(first(dto.device_label, dto.deviceLabel)),
    approximateLocation: nullableString(first(dto.approximate_location, dto.approximateLocation)),
    clientMetadataCapturedAt: nullableString(first(dto.client_metadata_captured_at, dto.clientMetadataCapturedAt)),
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