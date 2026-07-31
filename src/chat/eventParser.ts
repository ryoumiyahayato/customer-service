import type { ChatMessageDto, ChatSessionDto } from './dto.ts';
import type { ChatRealtimeEvent } from './events.ts';
import { mapChatMessageDto, mapChatSessionDto } from './mappers.ts';

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
