import assert from 'node:assert/strict';
import test from 'node:test';

const { mergeMessage } = await import('../../src/chat/messageMerge.ts');

function message(overrides = {}) {
  return {
    id: 'local-1',
    sessionId: 'sess-1',
    senderType: 'VISITOR',
    senderId: null,
    content: '你好',
    messageType: 'text',
    imagePath: null,
    status: 'sending',
    createdAt: '2026-08-08T10:00:00.000Z',
    readAt: null,
    isRead: false,
    quoteMessageId: null,
    clientMessageId: 'client-1',
    recalledAt: null,
    deletedAt: null,
    imagePurgedAt: null,
    ...overrides,
  };
}

test('sanitized server acknowledgement replaces the optimistic visitor message', () => {
  const optimistic = message();
  const authoritative = message({
    id: 'msg-1',
    senderId: null,
    status: 'sent',
    createdAt: '2026-08-08T10:00:01.000Z',
  });
  const merged = mergeMessage([optimistic], authoritative);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'msg-1');
  assert.equal(merged[0].status, 'sent');
  assert.equal(merged[0].senderId, null);
});

test('a hidden internal sender id also cannot duplicate the same visitor client message', () => {
  const optimistic = message();
  const authoritative = message({ id: 'msg-2', senderId: 'visitor_internal_secret', status: 'sent' });
  const merged = mergeMessage([optimistic], authoritative);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'msg-2');
});

test('two real principals with different sender ids are not merged', () => {
  const left = message({ id: 'msg-a', senderId: 'visitor-a', status: 'sent' });
  const right = message({ id: 'msg-b', senderId: 'visitor-b', status: 'sent' });
  const merged = mergeMessage([left], right);
  assert.equal(merged.length, 2);
});
