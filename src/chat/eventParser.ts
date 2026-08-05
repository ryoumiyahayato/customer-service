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

function explicitSessionIdOf(value: Record<string, unknown>) {
  const sessionId = stringValue(value.sessionId);
  const conversationId = stringValue(value.conversationId);
  if (sessionId && conversationId && sessionId !== conversationId) return null;
  return sessionId || conversationId;
}

export function parseChatRealtimeEvent(value: unknown): ChatRealtimeEvent | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;
  const explicitSessionId = explicitSessionIdOf(value);
  if (explicitSessionId === null) return null;

  if (value.type === 'message:new' || value.type === 'message_created') {
    const message = parseMessage(value.message);
    if (!message) return null;
    if (explicitSessionId && explicitSessionId !== message.sessionId) return null;
    const sessionId = explicitSessionId || message.sessionId;
    if (!sessionId) return null;
    const session = parseSession(value.session);
    if (value.session !== undefined && !session) return null;
    if (session && session.id !== sessionId) return null;
    return { type: value.type, sessionId, message, ...(session ? { session } : {}) };
  }

  if (value.type === 'message:updated') {
    const message = parseMessage(value.message);
    if (!message) return null;
    if (explicitSessionId && explicitSessionId !== message.sessionId) return null;
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
    return explicitSessionId && readAt && messageIds.length > 0
      ? { type: value.type, sessionId: explicitSessionId, messageIds, readAt }
      : null;
  }

  if (value.type === 'session:updated') {
    const session = parseSession(value.session);
    if (!session) return null;
    if (explicitSessionId && explicitSessionId !== session.id) return null;
    const sessionId = explicitSessionId || session.id;
    return sessionId ? { type: value.type, sessionId, session } : null;
  }

  if (value.type === 'sessions:changed') {
    const rawTimestamp = value.timestamp ?? value.ts;
    if (rawTimestamp === undefined || rawTimestamp === null || rawTimestamp === '') return null;
    const timestamp = Number(rawTimestamp);
    return Number.isFinite(timestamp) ? { type: value.type, timestamp } : null;
  }

  return null;
}
