import { RESOURCE_LIMITS } from '../security/resourceLimits';

function isMissingQuotaSchema(error: unknown): boolean {
  return /no such table:\s*message_quota_reservations|no such column:\s*(message_count|message_bytes|unclaimed_attachment_count|unclaimed_attachment_bytes)/i.test(String(error));
}

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

  async insertWithQuota(message: MessageRecord) {
    const byteSize = new TextEncoder().encode(message.content || '').byteLength;
    try {
      const results = await this.database.batch([
        this.database.prepare(
          `INSERT INTO message_quota_reservations(id,session_id,byte_size,created_at)
           SELECT ?,?,?,?
             FROM sessions
            WHERE id=?
              AND deleted_at IS NULL
              AND purged_at IS NULL
              AND status IN ('PENDING','OPEN')
              AND message_count < ?
              AND message_bytes + ? <= ?`,
        ).bind(
          message.id,
          message.session_id,
          byteSize,
          message.created_at,
          message.session_id,
          RESOURCE_LIMITS.messageSessionMaxCount,
          byteSize,
          RESOURCE_LIMITS.messageSessionMaxBytes,
        ),
        this.database.prepare(
          `INSERT INTO messages(
             id,session_id,sender_type,sender_id,content,message_type,image_path,status,
             created_at,read_at,is_read,quote_message_id,recalled_at,image_purged_at,client_message_id
           )
           SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
             FROM message_quota_reservations
            WHERE id=?`,
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
          message.id,
        ),
        this.database.prepare(
          `UPDATE sessions
              SET message_count=message_count+1,
                  message_bytes=message_bytes+?
            WHERE id=?
              AND EXISTS (SELECT 1 FROM message_quota_reservations WHERE id=?)`,
        ).bind(byteSize, message.session_id, message.id),
        this.database.prepare('DELETE FROM message_quota_reservations WHERE id=?').bind(message.id),
      ]);
      return Number(results[0]?.meta?.changes || 0) === 1
        && Number(results[1]?.meta?.changes || 0) === 1;
    } catch (error) {
      // Test fixtures and pre-migration self-hosted databases can still lack
      // the reservation table.  Enforce the same cap in the conditional
      // INSERT so compatibility does not reopen an unbounded write path.
      if (!isMissingQuotaSchema(error)) throw error;
      const result = await this.database.prepare(
        `INSERT INTO messages(
           id,session_id,sender_type,sender_id,content,message_type,image_path,status,
           created_at,read_at,is_read,quote_message_id,recalled_at,image_purged_at,client_message_id
         )
         SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
           FROM sessions s
          WHERE s.id=?
            AND s.deleted_at IS NULL
            AND s.purged_at IS NULL
            AND s.status IN ('PENDING','OPEN')
            AND (SELECT COUNT(*) FROM messages m WHERE m.session_id=s.id) < ?
            AND (SELECT COALESCE(SUM(LENGTH(CAST(COALESCE(m.content,'') AS BLOB))),0)
                   FROM messages m WHERE m.session_id=s.id) + ? <= ?`,
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
        message.session_id,
        RESOURCE_LIMITS.messageSessionMaxCount,
        byteSize,
        RESOURCE_LIMITS.messageSessionMaxBytes,
      ).run();
      return Number(result?.meta?.changes || 0) === 1;
    }
  }

  async bindAttachment(message: MessageRecord, objectKey: string) {
    const reservation = await this.database.prepare(
      `SELECT id,byte_size FROM attachments
        WHERE conversation_id=? AND object_key=? AND created_by_type=? AND created_by_id=?
          AND message_id IS NULL AND deleted_at IS NULL
        LIMIT 1`,
    ).bind(message.session_id, objectKey, message.sender_type, message.sender_id).first<{ id: string; byte_size: number }>();
    if (!reservation?.id) return;
    try {
      const results = await this.database.batch([
        this.database.prepare(
          'UPDATE attachments SET message_id=?,expires_at=NULL WHERE id=? AND message_id IS NULL AND deleted_at IS NULL',
        ).bind(message.id, reservation.id),
        this.database.prepare(
          `UPDATE sessions
              SET unclaimed_attachment_count=MAX(0,COALESCE(unclaimed_attachment_count,0)-1),
                  unclaimed_attachment_bytes=MAX(0,COALESCE(unclaimed_attachment_bytes,0)-?)
            WHERE id=?
              AND EXISTS (
                SELECT 1 FROM attachments
                 WHERE id=? AND message_id=? AND deleted_at IS NULL
              )`,
        ).bind(Number(reservation.byte_size || 0), message.session_id, reservation.id, message.id),
      ]);
      if (Number(results[0]?.meta?.changes || 0) !== 1) return;
    } catch (error) {
      if (!isMissingQuotaSchema(error)) throw error;
      // The attachment claim itself is safe to complete on a legacy schema;
      // the bounded upload reservation already enforced count and bytes.
      const claimed = await this.database.prepare(
        'UPDATE attachments SET message_id=?,expires_at=NULL WHERE id=? AND message_id IS NULL AND deleted_at IS NULL',
      ).bind(message.id, reservation.id).run();
      if (Number(claimed?.meta?.changes || 0) !== 1) return;
    }
  }

  touchSession(sessionId: string, timestamp: string) {
    return this.database.prepare('UPDATE sessions SET updated_at=? WHERE id=?')
      .bind(timestamp, sessionId)
      .run();
  }
}
