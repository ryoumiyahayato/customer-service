import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mapChatMessageDto,
  mapChatSessionDto,
  normalizeApiPayload,
} from '../../src/chat/mappers.ts';

const rawMessage = {
  id: 'msg_1',
  session_id: 'sess_1',
  sender_type: 'VISITOR',
  sender_id: 'visitor_1',
  content: 'hello',
  message_type: 'text',
  image_path: null,
  status: 'sent',
  created_at: '2026-07-31T00:00:00.000Z',
  is_read: 0,
};

test('maps legacy message DTO to one camelCase domain model', () => {
  assert.deepEqual(mapChatMessageDto(rawMessage), {
    id: 'msg_1',
    sessionId: 'sess_1',
    senderType: 'VISITOR',
    senderId: 'visitor_1',
    content: 'hello',
    messageType: 'text',
    imagePath: null,
    status: 'sent',
    createdAt: '2026-07-31T00:00:00.000Z',
    readAt: null,
    isRead: false,
    quoteMessageId: null,
    clientMessageId: null,
    recalledAt: null,
    deletedAt: null,
    imagePurgedAt: null,
  });
});

test('maps legacy session DTO and normalizes nested API payloads', () => {
  const session = mapChatSessionDto({
    id: 'sess_1',
    status: 'OPEN',
    assigned_operator_id: 'admin_1',
    unread_count: 2,
  });
  assert.equal(session.assignedOperatorId, 'admin_1');
  assert.equal(session.unreadCount, 2);
  const payload = normalizeApiPayload({ messages: [rawMessage], session });
  assert.equal(payload.messages[0].sessionId, 'sess_1');
});
