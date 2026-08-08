import type { ChatMessage, MessageStatus } from './types.ts';

function isServerMessage(message: ChatMessage) {
  return !message.id.startsWith('local-')
    && message.status !== 'sending'
    && message.status !== 'failed';
}

function sameClientIdentity(left: ChatMessage, right: ChatMessage) {
  if (!left.clientMessageId
    || !right.clientMessageId
    || left.clientMessageId !== right.clientMessageId
    || left.sessionId !== right.sessionId
    || left.senderType !== right.senderType) return false;

  // Visitor responses deliberately strip internal sender principal ids. A null/omitted
  // sender id therefore cannot make the optimistic and authoritative copies distinct.
  if (left.senderId && right.senderId && left.senderId !== right.senderId) return false;
  return true;
}

function isOptimisticMessage(message: ChatMessage) {
  return message.id.startsWith('local-') || message.status === 'sending' || message.status === 'failed';
}

function closeEnough(left: string, right: string, thresholdMs = 15_000) {
  const leftTime = Date.parse(left || '');
  const rightTime = Date.parse(right || '');
  return Number.isFinite(leftTime)
    && Number.isFinite(rightTime)
    && Math.abs(leftTime - rightTime) <= thresholdMs;
}

function sameLegacyOptimisticPayload(left: ChatMessage, right: ChatMessage) {
  // This fallback exists only for a stale/legacy public edge that may omit clientMessageId.
  // If both ids exist and disagree, they are intentionally distinct messages.
  if (left.clientMessageId && right.clientMessageId) return false;
  const leftOptimistic = isOptimisticMessage(left);
  const rightOptimistic = isOptimisticMessage(right);
  if (leftOptimistic === rightOptimistic) return false;
  const server = leftOptimistic ? right : left;
  if (!isServerMessage(server)) return false;
  if (left.sessionId !== right.sessionId || left.senderType !== right.senderType) return false;
  if (left.senderId && right.senderId && left.senderId !== right.senderId) return false;
  if (left.messageType !== right.messageType) return false;
  if ((left.content || '') !== (right.content || '')) return false;
  if ((left.imagePath || '') !== (right.imagePath || '')) return false;
  if ((left.quoteMessageId || '') !== (right.quoteMessageId || '')) return false;
  return closeEnough(left.createdAt, right.createdAt);
}

function laterTimestamp(left: string | null, right: string | null) {
  if (!left) return right;
  if (!right) return left;
  return left >= right ? left : right;
}

function statusRank(status: MessageStatus) {
  if (status === 'recalled') return 4;
  if (status === 'read') return 3;
  if (status === 'sent') return 2;
  if (status === 'failed') return 1;
  return 0;
}

function advancedStatus(left: MessageStatus, right: MessageStatus) {
  return statusRank(left) >= statusRank(right) ? left : right;
}

function mergeServerMessages(current: ChatMessage, incoming: ChatMessage) {
  const currentIsTerminal = Boolean(current.deletedAt || current.recalledAt || current.status === 'recalled');
  const incomingIsTerminal = Boolean(incoming.deletedAt || incoming.recalledAt || incoming.status === 'recalled');
  const base = currentIsTerminal && !incomingIsTerminal ? current : incoming;
  return {
    ...base,
    status: advancedStatus(current.status, incoming.status),
    isRead: current.isRead || incoming.isRead,
    readAt: laterTimestamp(current.readAt, incoming.readAt),
    recalledAt: laterTimestamp(current.recalledAt, incoming.recalledAt),
    deletedAt: laterTimestamp(current.deletedAt, incoming.deletedAt),
    imagePurgedAt: laterTimestamp(current.imagePurgedAt, incoming.imagePurgedAt),
  };
}

export function preferServerMessage(current: ChatMessage, incoming: ChatMessage) {
  if (isServerMessage(current) && !isServerMessage(incoming)) return current;
  if (isServerMessage(current) && isServerMessage(incoming)) {
    return mergeServerMessages(current, incoming);
  }
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
  let index = messages.findIndex((current) =>
    current.id === incoming.id || sameClientIdentity(current, incoming),
  );

  if (index < 0) {
    const fallbackMatches = messages
      .map((current, currentIndex) => sameLegacyOptimisticPayload(current, incoming) ? currentIndex : -1)
      .filter(currentIndex => currentIndex >= 0);
    // Never guess when repeated identical messages create more than one plausible pending copy.
    if (fallbackMatches.length === 1) index = fallbackMatches[0];
  }

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
  const latest = messages.reduce((currentLatest, message) => {
    if (
      !message.createdAt
      || message.id.startsWith('local-')
      || message.status === 'sending'
      || message.status === 'failed'
    ) return currentLatest;
    return !currentLatest || message.createdAt > currentLatest ? message.createdAt : currentLatest;
  }, '');
  if (!latest) return '';
  const timestamp = Date.parse(latest);
  return Number.isFinite(timestamp) ? new Date(timestamp - 1).toISOString() : latest;
}
