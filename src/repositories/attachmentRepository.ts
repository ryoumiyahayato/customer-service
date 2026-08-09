import { DomainError } from '../http/errors';
import { RESOURCE_LIMITS } from '../security/resourceLimits';

function isMissingQuotaSchema(error: unknown): boolean {
  return /no such column:\s*(unclaimed_attachment_count|unclaimed_attachment_bytes)|no such table:\s*message_quota_reservations/i.test(String(error));
}

export class AttachmentRepository {
  constructor(private readonly database: D1Database) {}

  async reserve(input: {
    id: string;
    sessionId: string;
    objectKey: string;
    mimeType: string;
    byteSize: number;
    createdAt: string;
    createdByType: 'VISITOR' | 'OPERATOR';
    createdById: string;
    expiresAt: string;
  }) {
    const insertStatement = () => this.database.prepare(
      `INSERT INTO attachments(
         id,message_id,conversation_id,object_key,file_name,mime_type,byte_size,created_at,
         created_by_type,created_by_id,expires_at,deleted_at
       )
       SELECT ?,NULL,s.id,?,NULL,?,?,?,?,?,?,NULL
         FROM sessions s
        WHERE s.id=?
          AND s.deleted_at IS NULL
          AND s.purged_at IS NULL
          AND s.archived_at IS NULL
          AND s.status IN ('PENDING','OPEN')
          AND (SELECT COUNT(*) FROM attachments
                 WHERE conversation_id=s.id AND message_id IS NULL AND deleted_at IS NULL
                   AND expires_at>?) < ?
          AND (SELECT COALESCE(SUM(byte_size),0) FROM attachments
                 WHERE conversation_id=s.id AND message_id IS NULL AND deleted_at IS NULL
                   AND expires_at>?) + ? <= ?`,
    ).bind(
      input.id,
      input.objectKey,
      input.mimeType,
      input.byteSize,
      input.createdAt,
      input.createdByType,
      input.createdById,
      input.expiresAt,
      input.sessionId,
      input.createdAt,
      RESOURCE_LIMITS.unclaimedAttachmentMaxCount,
      input.createdAt,
      input.byteSize,
      RESOURCE_LIMITS.unclaimedAttachmentMaxBytes,
    );

    try {
      const results = await this.database.batch([
        insertStatement(),
        this.database.prepare(
          `UPDATE sessions
              SET unclaimed_attachment_count=COALESCE(unclaimed_attachment_count,0)+1,
                  unclaimed_attachment_bytes=COALESCE(unclaimed_attachment_bytes,0)+?
            WHERE id=?
              AND EXISTS (SELECT 1 FROM attachments WHERE id=? AND message_id IS NULL AND deleted_at IS NULL)`,
        ).bind(input.byteSize, input.sessionId, input.id),
      ]);
      if (Number(results[0]?.meta?.changes || 0) !== 1) {
        throw new DomainError('ATTACHMENT_QUOTA_EXCEEDED', 429);
      }
      return;
    } catch (error) {
      if (!(error instanceof Error) || !isMissingQuotaSchema(error)) throw error;
      // A pre-0015 database has no accounting columns.  The conditional
      // INSERT still enforces both quotas atomically from the attachment
      // rows, while preserving compatibility until the append-only migration
      // is applied.
      try {
        await this.database.prepare('DELETE FROM attachments WHERE id=? AND message_id IS NULL AND deleted_at IS NULL')
          .bind(input.id).run();
      } catch {
        // Best effort cleanup before the legacy conditional insert.
      }
      const legacy = await insertStatement().run();
      if (Number(legacy?.meta?.changes || 0) === 1) return;
    }
    {
      throw new DomainError('ATTACHMENT_QUOTA_EXCEEDED', 429);
    }
  }

  insert(input: {
    id: string;
    sessionId: string;
    objectKey: string;
    mimeType: string;
    byteSize: number;
    createdAt: string;
    createdByType: 'VISITOR' | 'OPERATOR';
    createdById: string;
    expiresAt: string;
  }) {
    return this.database.prepare(
      'INSERT INTO attachments(id,message_id,conversation_id,object_key,file_name,mime_type,byte_size,created_at,created_by_type,created_by_id,expires_at,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL)',
    ).bind(
      input.id,
      null,
      input.sessionId,
      input.objectKey,
      null,
      input.mimeType,
      input.byteSize,
      input.createdAt,
      input.createdByType,
      input.createdById,
      input.expiresAt,
    ).run();
  }

  releaseReservation(id: string) {
    return (async () => {
      try {
        return await this.database.batch([
          this.database.prepare(
            `UPDATE sessions
                SET unclaimed_attachment_count=MAX(0,COALESCE(unclaimed_attachment_count,0)-1),
                    unclaimed_attachment_bytes=MAX(0,COALESCE(unclaimed_attachment_bytes-COALESCE((SELECT byte_size FROM attachments WHERE id=? AND message_id IS NULL AND deleted_at IS NULL),0),0))
              WHERE id=(SELECT conversation_id FROM attachments WHERE id=? AND message_id IS NULL AND deleted_at IS NULL)`,
          ).bind(id, id),
          this.database.prepare('DELETE FROM attachments WHERE id=? AND message_id IS NULL AND deleted_at IS NULL').bind(id),
        ]);
      } catch (error) {
        if (!(error instanceof Error) || !isMissingQuotaSchema(error)) throw error;
        await this.database.prepare('DELETE FROM attachments WHERE id=? AND message_id IS NULL AND deleted_at IS NULL').bind(id).run();
        return [];
      }
    })();
  }
}
