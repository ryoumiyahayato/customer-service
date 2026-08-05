import assert from 'node:assert/strict';
import test from 'node:test';
import { parseChatRealtimeEvent } from '../../src/chat/eventParser.ts';

const message = {
  id: 'msg_1',
  session_id: 'sess_1',
  sender_type: 'VISITOR',
  sender_id: 'visitor_1',
  content: 'hello',
  message_type: 'text',
  status: 'sent',
  created_at: '2026-07-31T00:00:00.000Z',
};

const session = {
  id: 'sess_1',
  status: 'OPEN',
  assigned_operator_id: 'admin_1',
};

test('parses supported realtime payload and rejects malformed payloads', () => {
  const event = parseChatRealtimeEvent({
    type: 'message:new',
    conversationId: 'sess_1',
    message,
  });
  assert.equal(event?.type, 'message:new');
  assert.equal(event?.sessionId, 'sess_1');
  assert.equal(event?.message.sessionId, 'sess_1');
  assert.equal(parseChatRealtimeEvent({}), null);
  assert.equal(parseChatRealtimeEvent({ type: 'message:new' }), null);
  assert.equal(
    parseChatRealtimeEvent({ type: 'messages:read', sessionId: 'sess_1' }),
    null,
  );
});

test('rejects conflicting room, message and session identities', () => {
  assert.equal(parseChatRealtimeEvent({
    type: 'message:new',
    sessionId: 'sess_1',
    conversationId: 'sess_2',
    message,
  }), null);
  assert.equal(parseChatRealtimeEvent({
    type: 'message:new',
    conversationId: 'sess_2',
    message,
  }), null);
  assert.equal(parseChatRealtimeEvent({
    type: 'message:new',
    conversationId: 'sess_1',
    message,
    session: { ...session, id: 'sess_2' },
  }), null);
  assert.equal(parseChatRealtimeEvent({
    type: 'session:updated',
    conversationId: 'sess_2',
    session,
  }), null);
});

test('requires meaningful read and session-list event payloads', () => {
  assert.equal(parseChatRealtimeEvent({
    type: 'messages:read',
    sessionId: 'sess_1',
    messageIds: [],
    readAt: '2026-07-31T00:00:00.000Z',
  }), null);
  assert.equal(parseChatRealtimeEvent({ type: 'sessions:changed' }), null);
  assert.equal(parseChatRealtimeEvent({ type: 'sessions:changed', ts: 1 })?.timestamp, 1);
});
