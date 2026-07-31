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
  isSessionEnded,
  sessionBucketOf,
  sessionGroupOf,
} from './domain/sessionState';

import type { ChatMessage, ChatSession } from './chat/types';
import { sessionBucketOf, sessionGroupOf } from './domain/sessionState';

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
