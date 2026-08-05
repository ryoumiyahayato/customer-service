export type MessageRecord = {
  id: string;
  session_id: string;
  sender_type: 'VISITOR' | 'OPERATOR';
  sender_id: string;
  content: string;
  message_type: 'text' | 'image';
  image_path: string | null;
  status: string;
  created_at: string;
  read_at: string | null;
  is_read: number;
  quote_message_id: string | null;
  recalled_at: string | null;
  image_purged_at: string | null;
  client_message_id: string;
  deleted_at?: string | null;
};

export class MessageRepository {
  constructor(private readonly database: D1Database) {}

  findDuplicate(sessionId: string, senderType: string, senderId: string, clientMessageId: string) {
    return this.database.prepare(
      'SELECT * FROM messages WHERE session_id=? AND sender_type=? AND sender_id=? AND client_message_id=?',
    ).bind(sessionId, senderType, senderId, clientMessageId).first<MessageRecord>();
  }

  insert(message: MessageRecord) {
    return this.database.prepare(
      'INSERT INTO messages(id,session_id,sender_type,sender_id,content,message_type,image_path,status,created_at,read_at,is_read,quote_message_id,recalled_at,image_purged_at,client_message_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    ).bind(
      message.id,
      message.session_id,
      message.sender_type,
      message.sender_id,
      message.content,
      message.message_type,
      message.image_path,
      message.status,
      message.created_at,
      message.read_at,
      message.is_read,
      message.quote_message_id,
      message.recalled_at,
      message.image_purged_at,
      message.client_message_id,
    ).run();
  }

  bindAttachment(message: MessageRecord, objectKey: string) {
    return this.database.prepare(
      'UPDATE attachments SET message_id=? WHERE conversation_id=? AND object_key=? AND created_by_type=? AND created_by_id=? AND message_id IS NULL',
    ).bind(message.id, message.session_id, objectKey, message.sender_type, message.sender_id).run();
  }

  touchSession(sessionId: string, timestamp: string) {
    return this.database.prepare('UPDATE sessions SET updated_at=? WHERE id=?')
      .bind(timestamp, sessionId)
      .run();
  }
}
