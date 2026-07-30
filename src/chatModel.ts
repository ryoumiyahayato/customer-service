export type SessionGroup = 'active' | 'archived' | 'trash';

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

export type ChatRealtimeEvent = {
  type?: string;
  sessionId?: string;
  session?: ChatSession;
  message?: ChatMessage;
  messageId?: string;
  messageIds?: string[];
  readAt?: string;
};

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

export function mergeMessage(messages: ChatMessage[], message?: ChatMessage) {
  if (!message) return messages;
  const index = messages.findIndex((current) =>
    (message.id && current.id === message.id)
    || (message.client_message_id && current.client_message_id === message.client_message_id)
  );
  if (index < 0) return [...messages, message];
  const next = messages.slice();
  next[index] = message;
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
  return Boolean(
    !session
    || session.deleted_at
    || session.purged_at
    || session.status === 'CLOSED'
    || session.status === 'ARCHIVED',
  );
}
