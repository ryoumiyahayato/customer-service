export class AttachmentRepository {
  constructor(private readonly database: D1Database) {}

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
}
