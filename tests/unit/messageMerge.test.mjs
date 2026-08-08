import assert from 'node:assert/strict';
import test from 'node:test';
import { lastServerMessageTime, mergeMessage } from '../../src/chat/messageMerge.ts';

const serverMessage = {
  id: 'msg_1',
  sessionId: 'sess_1',
  senderType: 'VISITOR',
  senderId: 'visitor_1',
  content: 'ok',
  messageType: 'text',
  imagePath: null,
  status: 'sent',
  createdAt: '2026-07-31T00:00:00.000Z',
  readAt: null,
  isRead: false,
  quoteMessageId: null,
  clientMessageId: 'cm_1',
  recalledAt: null,
  deletedAt: null,
  imagePurgedAt: null,
};

test('does not let a local pending copy overwrite a server message', () => {
  const pending = { ...serverMessage, id: 'local-cm_1', status: 'sending' };
  assert.deepEqual(mergeMessage([serverMessage], pending), [serverMessage]);
});

test('replaces a failed optimistic message with the server result', () => {
  const failed = { ...serverMessage, id: 'local-cm_1', status: 'failed' };
  assert.deepEqual(mergeMessage([failed], serverMessage), [serverMessage]);
});

test('reconciles one legacy server response that omitted clientMessageId', () => {
  const pending = {
    ...serverMessage,
    id: 'local-cm_legacy',
    senderId: null,
    status: 'sending',
    clientMessageId: 'cm_legacy',
    createdAt: '2026-07-31T00:00:05.000Z',
  };
  const legacyServer = {
    ...serverMessage,
    id: 'msg_legacy',
    senderId: null,
    clientMessageId: null,
    createdAt: '2026-07-31T00:00:06.000Z',
  };
  assert.deepEqual(mergeMessage([pending], legacyServer), [legacyServer]);
});

test('does not guess when two identical pending messages could match a legacy response', () => {
  const pendingOne = {
    ...serverMessage,
    id: 'local-cm_a',
    senderId: null,
    status: 'sending',
    clientMessageId: 'cm_a',
    createdAt: '2026-07-31T00:00:05.000Z',
  };
  const pendingTwo = {
    ...pendingOne,
    id: 'local-cm_b',
    clientMessageId: 'cm_b',
    createdAt: '2026-07-31T00:00:06.000Z',
  };
  const legacyServer = {
    ...serverMessage,
    id: 'msg_legacy',
    senderId: null,
    clientMessageId: null,
    createdAt: '2026-07-31T00:00:07.000Z',
  };
  assert.equal(mergeMessage([pendingOne, pendingTwo], legacyServer).length, 3);
});

test('does not merge legacy-looking payloads outside the optimistic time window', () => {
  const pending = {
    ...serverMessage,
    id: 'local-cm_legacy',
    senderId: null,
    status: 'sending',
    clientMessageId: 'cm_legacy',
    createdAt: '2026-07-31T00:00:00.000Z',
  };
  const laterServer = {
    ...serverMessage,
    id: 'msg_later',
    senderId: null,
    clientMessageId: null,
    createdAt: '2026-07-31T00:00:20.001Z',
  };
  assert.equal(mergeMessage([pending], laterServer).length, 2);
});

test('does not merge equal client ids across sessions or senders', () => {
  const otherSession = { ...serverMessage, id: 'msg_2', sessionId: 'sess_2' };
  const otherSender = { ...serverMessage, id: 'msg_3', senderId: 'visitor_2' };
  assert.equal(mergeMessage([serverMessage], otherSession).length, 2);
  assert.equal(mergeMessage([serverMessage], otherSender).length, 2);
});

test('does not regress read, recall, delete or image purge state from stale server data', () => {
  const terminal = {
    ...serverMessage,
    content: '已撤回',
    status: 'recalled',
    isRead: true,
    readAt: '2026-07-31T00:01:00.000Z',
    recalledAt: '2026-07-31T00:02:00.000Z',
    deletedAt: '2026-07-31T00:03:00.000Z',
    imagePurgedAt: '2026-07-31T00:04:00.000Z',
  };
  const stale = { ...serverMessage, content: 'original' };
  assert.deepEqual(mergeMessage([terminal], stale), [terminal]);
});

test('uses an overlapping polling cursor so equal timestamps are re-fetched and deduplicated', () => {
  assert.equal(lastServerMessageTime([serverMessage]), '2026-07-30T23:59:59.999Z');
});
