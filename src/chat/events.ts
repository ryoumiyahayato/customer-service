import type { ChatMessage, ChatSession } from './types.ts';

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
