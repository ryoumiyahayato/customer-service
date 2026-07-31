import type { ChatMessage } from './types.ts';

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
