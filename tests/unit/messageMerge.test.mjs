import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeMessage } from '../../src/chat/messageMerge.ts';

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
