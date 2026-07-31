import {
  isSessionEnded as sessionStateEnded,
  sessionBucketOf,
  sessionGroupOf,
  type SessionGroup,
} from './domain/sessionState';

export type { SessionGroup } from './domain/sessionState';
export { sessionBucketOf, sessionGroupOf } from './domain/sessionState';

export type ChatMessage = {
  id: string;
  session_id: string;
  sessionId?: string;
  sender_type: 'VISITOR' | 'OPERATOR';
  sender_id: string | null;
  content: string;
  message_type: 'text' | 'image';
  image_path?: string | null;
  status: string;
  created_at: string;
  read_at?: string | null;
  is_read?: number | boolean;
  quote_message_id?: string | null;
  client_message_id?: string | null;
  recalled_at?: string | null;
  deleted_at?: string | null;
  image_purged_at?: string | null;
};

export type ChatSession = {
  id: string;
  status: string;
  visitor_key?: string | null;
  user_id?: string | null;
  customer_name?: string | null;
  customer_remark_name?: string | null;
  assigned_operator_id?: string | null;
  archived_at?: string | null;
  deleted_at?: string | null;
  purged_at?: string | null;
  history_cleared_at?: string | null;
  created_at?: string;
  updated_at?: string;
  unread_count?: number;
};

export type AdminIdentity = {
  id: string;
  username: string;
  role: 'SUPER_ADMIN' | 'OPERATOR';
  must_change_password?: number | boolean;
};

export type OperatorSummary = {
  id: string;
  username: string;
  is_disabled?: number | boolean;
  online?: boolean;
  last_seen_at?: string | null;
};

export type StaffMessage = {
  id: string;
  sender_admin_id: string;
  sender_name: string;
  content: string;
  created_at: string;
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

type RealtimeEventCommon = {
  sessionId?: string;
  conversationId?: string;
  session?: ChatSession;
  message?: ChatMessage;
  messageId?: string;
  messageIds?: string[];
  readAt?: string;
  timestamp?: number;
};

export type MessageCreatedEvent = RealtimeEventCommon & {
  type: 'message:new' | 'message_created';
  message: ChatMessage;
};

export type MessageUpdatedEvent = RealtimeEventCommon & {
  type: 'message:updated';
  message: ChatMessage;
};

export type MessageDeletedEvent = RealtimeEventCommon & {
  type: 'message:deleted';
  messageId: string;
};

export type MessagesReadEvent = RealtimeEventCommon & {
  type: 'messages:read';
  messageIds: string[];
  readAt: string;
};

export type SessionUpdatedEvent = RealtimeEventCommon & {
  type: 'session:updated';
  session: ChatSession;
};

export type SessionsChangedEvent = RealtimeEventCommon & {
  type: 'sessions:changed';
};

export type ChatRealtimeEvent =
  | MessageCreatedEvent
  | MessageUpdatedEvent
  | MessageDeletedEvent
  | MessagesReadEvent
  | SessionUpdatedEvent
  | SessionsChangedEvent;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function parseChatMessage(value: unknown): ChatMessage | null {
  if (!isRecord(value)) return null;
  const id = optionalString(value.id);
  const sessionId = optionalString(value.session_id) || optionalString(value.sessionId);
  const senderType = value.sender_type === 'OPERATOR' ? 'OPERATOR' : value.sender_type === 'VISITOR' ? 'VISITOR' : null;
  if (!id || !sessionId || !senderType) return null;

  return {
    id,
    session_id: sessionId,
    sessionId: optionalString(value.sessionId),
    sender_type: senderType,
    sender_id: nullableString(value.sender_id),
    content: typeof value.content === 'string' ? value.content : '',
    message_type: value.message_type === 'image' ? 'image' : 'text',
    image_path: nullableString(value.image_path),
    status: typeof value.status === 'string' ? value.status : 'sent',
    created_at: typeof value.created_at === 'string' ? value.created_at : '',
    read_at: nullableString(value.read_at),
    is_read: typeof value.is_read === 'boolean' || typeof value.is_read === 'number' ? value.is_read : false,
    quote_message_id: nullableString(value.quote_message_id),
    client_message_id: nullableString(value.client_message_id),
    recalled_at: nullableString(value.recalled_at),
    deleted_at: nullableString(value.deleted_at),
    image_purged_at: nullableString(value.image_purged_at),
  };
}

function parseChatSession(value: unknown): ChatSession | null {
  if (!isRecord(value)) return null;
  const id = optionalString(value.id);
  if (!id) return null;
  return {
    id,
    status: typeof value.status === 'string' ? value.status : 'PENDING',
    visitor_key: nullableString(value.visitor_key),
    user_id: nullableString(value.user_id),
    customer_name: nullableString(value.customer_name),
    customer_remark_name: nullableString(value.customer_remark_name),
    assigned_operator_id: nullableString(value.assigned_operator_id),
    archived_at: nullableString(value.archived_at),
    deleted_at: nullableString(value.deleted_at),
    purged_at: nullableString(value.purged_at),
    history_cleared_at: nullableString(value.history_cleared_at),
    created_at: optionalString(value.created_at),
    updated_at: optionalString(value.updated_at),
    unread_count: typeof value.unread_count === 'number' ? value.unread_count : undefined,
  };
}

export function parseChatRealtimeEvent(value: unknown): ChatRealtimeEvent | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;
  const common: RealtimeEventCommon = {
    sessionId: optionalString(value.sessionId),
    conversationId: optionalString(value.conversationId),
    timestamp: typeof value.timestamp === 'number' ? value.timestamp : undefined,
  };

  if (value.type === 'message:new' || value.type === 'message_created') {
    const message = parseChatMessage(value.message);
    if (!message) return null;
    const session = parseChatSession(value.session);
    return { ...common, type: value.type, message, ...(session ? { session } : {}) };
  }

  if (value.type === 'message:updated') {
    const message = parseChatMessage(value.message);
    return message ? { ...common, type: value.type, message } : null;
  }

  if (value.type === 'message:deleted') {
    const messageId = optionalString(value.messageId);
    return messageId ? { ...common, type: value.type, messageId } : null;
  }

  if (value.type === 'messages:read') {
    const messageIds = Array.isArray(value.messageIds)
      ? value.messageIds.filter((id): id is string => typeof id === 'string' && Boolean(id))
      : [];
    const readAt = optionalString(value.readAt);
    return readAt ? { ...common, type: value.type, messageIds, readAt } : null;
  }

  if (value.type === 'session:updated') {
    const session = parseChatSession(value.session);
    return session ? { ...common, type: value.type, session } : null;
  }

  if (value.type === 'sessions:changed') {
    return { ...common, type: value.type };
  }

  return null;
}

export function newClientMessageId() {
  const id = crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return `cm_${id}`;
}

export function localMessageId(clientMessageId: string) {
  return `local-${clientMessageId}`;
}

export function isMessageCreatedEvent(type?: string) {
  return type === 'message:new' || type === 'message_created';
}

export function messageSessionId(message?: ChatMessage | null) {
  return String(message?.session_id || message?.sessionId || '');
}

function isServerMessage(message: ChatMessage) {
  return !message.id.startsWith('local-')
    && message.status !== 'sending'
    && message.status !== 'failed';
}

function preferServerMessage(current: ChatMessage, incoming: ChatMessage) {
  if (isServerMessage(current) && !isServerMessage(incoming)) return current;
  return incoming;
}

export function mergeMessage(messages: ChatMessage[], message?: ChatMessage) {
  if (!message) return messages;
  const index = messages.findIndex((current) =>
    (message.id && current.id === message.id)
    || (message.client_message_id && current.client_message_id === message.client_message_id)
  );
  if (index < 0) return [...messages, message];
  const next = messages.slice();
  next[index] = preferServerMessage(messages[index], message);
  return next;
}

export function mergeMessages(messages: ChatMessage[], incoming: ChatMessage[] = []) {
  return incoming.reduce(mergeMessage, messages);
}

export function markMessageFailed(messages: ChatMessage[], id: string) {
  return messages.map((message) => message.id === id ? { ...message, status: 'failed' } : message);
}

export function lastServerMessageTime(messages: ChatMessage[]) {
  return messages.reduce((latest, message) => {
    if (
      !message.created_at
      || message.id.startsWith('local-')
      || message.status === 'sending'
      || message.status === 'failed'
    ) {
      return latest;
    }
    return !latest || message.created_at > latest ? message.created_at : latest;
  }, '');
}

export function fallbackDelay(misses: number) {
  return misses < 3 ? 2000 : misses < 12 ? 5000 : 10000;
}

export function recordChatMetric(
  name: string,
  started: number,
  extra: Record<string, number | string> = {},
) {
  console.debug('[chat_metric]', name, Math.round(performance.now() - started), extra);
}

export function isSessionEnded(session?: ChatSession | null) {
  return sessionStateEnded(session);
}

export function sessionGroupForChat(session?: ChatSession | null): SessionGroup | null {
  return sessionGroupOf(session);
}

export function sessionBucketForChat(session?: ChatSession | null) {
  return sessionBucketOf(session);
}
