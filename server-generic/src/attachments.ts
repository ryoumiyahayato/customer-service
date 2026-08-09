import type { IncomingMessage, ServerResponse } from 'node:http';
import type { GenericServerConfig } from './config.js';
import type { PostgresAdapter } from './db/postgres.js';
import { maybeDecryptText, maybeEncryptText, type EncryptedText } from './encryption.js';
import type { EncryptionConfig } from './encryptionConfig.js';
import { HttpError } from './http.js';
import { sendText } from './response.js';
import type { LocalStorageAdapter } from './storage/localStorage.js';
import { normalizeContentType } from './storage/contentType.js';
import { generateAttachmentStorageKey, sanitizeDisplayFilename } from './storage/storageKeys.js';
import { isSuperAdmin, type AdminIdentity } from './sessions.js';
import { RESOURCE_LIMITS } from './resourceLimits.js';

export type AttachmentMetadata = {
  id: string;
  messageId: string;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: string;
};

type AttachmentRow = {
  id: string;
  message_id: string;
  storage_key: string;
  filename: string | null;
  filename_ciphertext: string | null;
  filename_iv: string | null;
  filename_tag: string | null;
  filename_algorithm: string | null;
  filename_key_version: string | null;
  mime_type: string | null;
  size_bytes: string | number;
  created_at: Date;
};

function encryptedFilenameFromRow(row: AttachmentRow): EncryptedText | null {
  if (!row.filename_ciphertext) return null;
  if (!row.filename_iv || !row.filename_tag || !row.filename_algorithm || !row.filename_key_version) {
    throw new Error('decryption_failed');
  }
  return {
    ciphertext: row.filename_ciphertext,
    iv: row.filename_iv,
    tag: row.filename_tag,
    algorithm: row.filename_algorithm,
    keyVersion: row.filename_key_version,
  };
}

export function prepareAttachmentFilenameForStorage(filename: string, encryption: EncryptionConfig) {
  const encrypted = maybeEncryptText(filename, encryption);
  return {
    filename: encrypted ? null : filename,
    filenameCiphertext: encrypted?.ciphertext ?? null,
    filenameIv: encrypted?.iv ?? null,
    filenameTag: encrypted?.tag ?? null,
    filenameAlgorithm: encrypted?.algorithm ?? null,
    filenameKeyVersion: encrypted?.keyVersion ?? null,
    metadataEncryptedAt: encrypted ? new Date() : null,
  };
}

function displayFilename(row: AttachmentRow, encryption: EncryptionConfig) {
  return maybeDecryptText(encryptedFilenameFromRow(row), row.filename, encryption) || 'attachment';
}

function mapAttachment(row: AttachmentRow, encryption: EncryptionConfig): AttachmentMetadata {
  return {
    id: row.id,
    messageId: row.message_id,
    filename: displayFilename(row, encryption),
    mimeType: row.mime_type || 'application/octet-stream',
    size: Number(row.size_bytes || 0),
    createdAt: row.created_at.toISOString(),
  };
}

function filenameFromRequest(request: IncomingMessage, url: URL): string {
  const header = request.headers['x-filename'];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  return sanitizeDisplayFilename(fromHeader || url.searchParams.get('filename'));
}

async function readUploadBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) throw new HttpError(413, 'upload_too_large');
    chunks.push(buffer);
  }

  if (size === 0) throw new HttpError(400, 'empty_upload');
  return Buffer.concat(chunks);
}

export async function createVisitorAttachment(
  config: GenericServerConfig,
  db: PostgresAdapter,
  storage: LocalStorageAdapter,
  request: IncomingMessage,
  url: URL,
  sessionId: string,
): Promise<AttachmentMetadata> {
  const mimeType = normalizeContentType(request.headers['content-type']);
  const filename = filenameFromRequest(request, url);
  const body = await readUploadBody(request, config.maxUploadSize);
  const storageKey = generateAttachmentStorageKey(mimeType);
  const storedFilename = prepareAttachmentFilenameForStorage(filename, config.encryption);
  const reservation = await db.withTransaction(async (client) => {
    const session = await client.query<{ status: string; archived_at: Date | null; deleted_at: Date | null; history_cleared_at: Date | null }>(
      `SELECT status,archived_at,deleted_at,history_cleared_at
         FROM chat_sessions WHERE id=$1 FOR UPDATE`,
      [sessionId],
    );
    const current = session.rows[0];
    const ended = !current || ['closed', 'archived'].includes(String(current.status).toLowerCase())
      || current.archived_at || current.deleted_at || current.history_cleared_at;
    if (ended) throw new HttpError(409, 'session_ended');
    const usage = await client.query<{ count: string; bytes: string }>(
      `SELECT COUNT(*)::text AS count,COALESCE(SUM(size_bytes),0)::text AS bytes
         FROM attachments a JOIN messages m ON m.id=a.message_id
        WHERE m.session_id=$1 AND a.deleted_at IS NULL AND a.expires_at > now()`,
      [sessionId],
    );
    if (Number(usage.rows[0]?.count || 0) >= RESOURCE_LIMITS.unclaimedAttachmentMaxCount
      || Number(usage.rows[0]?.bytes || 0) + body.length > RESOURCE_LIMITS.unclaimedAttachmentMaxBytes) {
      throw new HttpError(429, 'attachment_quota_exceeded');
    }
    const message = await client.query<{ id: string }>(
      `INSERT INTO messages (session_id, sender_type, body, message_type)
       VALUES ($1, 'visitor', NULL, 'attachment')
       RETURNING id`,
      [sessionId],
    );
    const attachment = await client.query<AttachmentRow>(
      `INSERT INTO attachments (
         message_id, storage_key, filename, filename_ciphertext, filename_iv,
         filename_tag, filename_algorithm, filename_key_version, metadata_encrypted_at,
         mime_type, size_bytes, expires_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now()+interval '10 minutes')
       RETURNING id, message_id, storage_key, filename, filename_ciphertext, filename_iv,
                 filename_tag, filename_algorithm, filename_key_version, mime_type, size_bytes, created_at`,
      [
        message.rows[0].id,
        storageKey,
        storedFilename.filename,
        storedFilename.filenameCiphertext,
        storedFilename.filenameIv,
        storedFilename.filenameTag,
        storedFilename.filenameAlgorithm,
        storedFilename.filenameKeyVersion,
        storedFilename.metadataEncryptedAt,
        mimeType,
        body.length,
      ],
    );
    await client.query(
      `UPDATE chat_sessions
          SET unclaimed_attachment_count=COALESCE(unclaimed_attachment_count,0)+1,
              unclaimed_attachment_bytes=COALESCE(unclaimed_attachment_bytes,0)+$2,
              message_count=COALESCE(message_count,0)+1,
              updated_at=now()
        WHERE id=$1`,
      [sessionId, body.length],
    ).catch(async (error) => {
      if (!/column|does not exist/i.test(String(error))) throw error;
      await client.query('UPDATE chat_sessions SET updated_at=now() WHERE id=$1', [sessionId]);
    });
    return { messageId: message.rows[0].id, attachment: mapAttachment(attachment.rows[0], config.encryption) };
  });

  try {
    await storage.writeObject(storageKey, body);
    await db.withTransaction(async (client) => {
      await client.query(
        `UPDATE attachments SET expires_at=NULL
          WHERE id=$1 AND deleted_at IS NULL AND expires_at IS NOT NULL`,
        [reservation.attachment.id],
      );
      await client.query(
        `UPDATE chat_sessions
            SET unclaimed_attachment_count=GREATEST(0,COALESCE(unclaimed_attachment_count,0)-1),
                unclaimed_attachment_bytes=GREATEST(0,COALESCE(unclaimed_attachment_bytes,0)-$2),
                updated_at=now()
          WHERE id=$1`,
        [sessionId, body.length],
      ).catch(async (error) => {
        if (!/column|does not exist/i.test(String(error))) throw error;
        await client.query('UPDATE chat_sessions SET updated_at=now() WHERE id=$1', [sessionId]);
      });
    });
    return reservation.attachment;
  } catch (error) {
    try {
      await db.withTransaction(async (client) => {
        await client.query(
          `INSERT INTO attachment_cleanup_jobs(attachment_id,chat_session_id,storage_key,next_attempt_at,created_at,updated_at)
           SELECT a.id,m.session_id,a.storage_key,now(),now(),now()
             FROM attachments a JOIN messages m ON m.id=a.message_id
            WHERE a.message_id=$1
           ON CONFLICT(storage_key) DO UPDATE SET completed_at=NULL,last_error=NULL,next_attempt_at=EXCLUDED.next_attempt_at,updated_at=EXCLUDED.updated_at`,
          [reservation.messageId],
        );
        await client.query('UPDATE attachments SET deleted_at=now() WHERE message_id=$1', [reservation.messageId]);
        await client.query(
          `UPDATE chat_sessions
              SET unclaimed_attachment_count=GREATEST(0,COALESCE(unclaimed_attachment_count,0)-1),
                  unclaimed_attachment_bytes=GREATEST(0,COALESCE(unclaimed_attachment_bytes,0)-$2),
                  updated_at=now()
            WHERE id=$1`,
          [sessionId, body.length],
        ).catch(async (counterError) => {
          if (!/column|does not exist/i.test(String(counterError))) throw counterError;
          await client.query('UPDATE chat_sessions SET updated_at=now() WHERE id=$1', [sessionId]);
        });
        await client.query('DELETE FROM messages WHERE id=$1', [reservation.messageId]);
      });
    } catch (cleanupError) {
      console.error('attachment reservation cleanup failed', { messageId: reservation.messageId, error: String(cleanupError) });
    }
    throw error;
  }
}

export async function listAttachmentsForMessages(db: PostgresAdapter, messageIds: string[], encryption: EncryptionConfig) {
  if (messageIds.length === 0) return new Map<string, AttachmentMetadata[]>();
  const rows = await db.query<AttachmentRow>(
    `SELECT a.id, a.message_id, a.storage_key, a.filename, a.filename_ciphertext, a.filename_iv,
            a.filename_tag, a.filename_algorithm, a.filename_key_version, a.mime_type, a.size_bytes, a.created_at
       FROM attachments a
       JOIN messages m ON m.id=a.message_id
      WHERE a.message_id = ANY($1::uuid[])
        AND a.deleted_at IS NULL
        AND m.deleted_at IS NULL
        AND m.recalled_at IS NULL
      ORDER BY a.created_at ASC`,
    [messageIds],
  );
  const byMessage = new Map<string, AttachmentMetadata[]>();
  for (const row of rows) {
    const list = byMessage.get(row.message_id) || [];
    list.push(mapAttachment(row, encryption));
    byMessage.set(row.message_id, list);
  }
  return byMessage;
}

async function findVisitorAttachment(db: PostgresAdapter, sessionId: string, attachmentId: string) {
  const rows = await db.query<AttachmentRow>(
    `SELECT attachments.id, attachments.message_id, attachments.storage_key, attachments.filename,
            attachments.filename_ciphertext, attachments.filename_iv, attachments.filename_tag,
            attachments.filename_algorithm, attachments.filename_key_version,
            attachments.mime_type, attachments.size_bytes, attachments.created_at
       FROM attachments
       JOIN messages ON messages.id = attachments.message_id
       WHERE attachments.id = $1
         AND messages.session_id = $2
         AND attachments.deleted_at IS NULL
         AND messages.deleted_at IS NULL
         AND messages.recalled_at IS NULL
      LIMIT 1`,
    [attachmentId, sessionId],
  );
  if (!rows[0]) throw new HttpError(404, 'attachment_not_found');
  return rows[0];
}

async function findAdminAttachment(db: PostgresAdapter, attachmentId: string, admin: AdminIdentity) {
  const rows = await db.query<AttachmentRow>(
    `SELECT attachments.id, attachments.message_id, attachments.storage_key, attachments.filename,
            attachments.filename_ciphertext, attachments.filename_iv, attachments.filename_tag,
            attachments.filename_algorithm, attachments.filename_key_version,
            attachments.mime_type, attachments.size_bytes, attachments.created_at
       FROM attachments
       JOIN messages ON messages.id = attachments.message_id
       JOIN chat_sessions ON chat_sessions.id = messages.session_id
       WHERE attachments.id = $1
         AND attachments.deleted_at IS NULL
         AND messages.deleted_at IS NULL
         AND messages.recalled_at IS NULL
        AND ($2::boolean OR chat_sessions.assigned_operator_id = $3)
      LIMIT 1`,
    [attachmentId, isSuperAdmin(admin), admin.id],
  );
  if (!rows[0]) throw new HttpError(404, 'attachment_not_found');
  return rows[0];
}

async function sendAttachment(
  response: ServerResponse,
  storage: LocalStorageAdapter,
  row: AttachmentRow,
  encryption: EncryptionConfig,
) {
  try {
    await storage.statObject(row.storage_key);
  } catch {
    throw new HttpError(404, 'attachment_not_found');
  }
  const filename = sanitizeDisplayFilename(displayFilename(row, encryption));
  response.writeHead(200, {
    'content-type': row.mime_type || 'application/octet-stream',
    'content-disposition': `attachment; filename="${filename.replace(/"/g, '_')}"`,
    'cache-control': 'no-store',
  });

  const stream = storage.readObjectStream(row.storage_key);
  stream.on('error', () => {
    if (!response.headersSent) sendText(response, 404, 'Not found');
    else response.destroy();
  });
  stream.pipe(response);
}

export async function sendVisitorAttachment(
  response: ServerResponse,
  db: PostgresAdapter,
  storage: LocalStorageAdapter,
  encryption: EncryptionConfig,
  sessionId: string,
  attachmentId: string,
) {
  const attachment = await findVisitorAttachment(db, sessionId, attachmentId);
  await sendAttachment(response, storage, attachment, encryption);
}

export async function sendAdminAttachment(
  response: ServerResponse,
  db: PostgresAdapter,
  storage: LocalStorageAdapter,
  encryption: EncryptionConfig,
  attachmentId: string,
  admin: AdminIdentity,
) {
  const attachment = await findAdminAttachment(db, attachmentId, admin);
  await sendAttachment(response, storage, attachment, encryption);
}

export async function deleteAttachmentFilesForSession(
  db: PostgresAdapter,
  storage: LocalStorageAdapter,
  sessionId: string,
): Promise<number> {
  const rows = await db.query<Pick<AttachmentRow, 'storage_key'>>(
    `SELECT attachments.storage_key
       FROM attachments
       JOIN messages ON messages.id = attachments.message_id
      WHERE messages.session_id = $1
        AND attachments.deleted_at IS NULL`,
    [sessionId],
  );

  for (const row of rows) {
    await storage.deleteObject(row.storage_key);
  }

  return rows.length;
}
