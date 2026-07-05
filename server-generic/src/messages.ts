import type { PostgresAdapter } from './db/postgres.js';
import { maybeDecryptText, maybeEncryptText, type EncryptedText } from './encryption.js';
import type { EncryptionConfig } from './encryptionConfig.js';
import { HttpError, requireString } from './http.js';
import { listAttachmentsForMessages, type AttachmentMetadata } from './attachments.js';

export type ChatMessage = {
  id: string;
  sessionId: string;
  senderType: 'visitor' | 'admin' | string;
  body: string | null;
  messageType: string;
  readAt: string | null;
  createdAt: string;
  attachments: AttachmentMetadata[];
};

type MessageRow = {
  id: string;
  session_id: string;
  sender_type: string;
  body: string | null;
  body_ciphertext: string | null;
  body_iv: string | null;
  body_tag: string | null;
  body_algorithm: string | null;
  body_key_version: string | null;
  message_type: string;
  read_at: Date | null;
  created_at: Date;
};

export function normalizeMessageBody(value: unknown): string {
  const body = requireString(value, 'body').trim();
  if (!body) throw new HttpError(400, 'message_body_required');
  if (body.length > 4000) throw new HttpError(400, 'message_body_too_long');
  return body;
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function encryptedBodyFromRow(row: MessageRow): EncryptedText | null {
  if (!row.body_ciphertext) return null;
  if (!row.body_iv || !row.body_tag || !row.body_algorithm || !row.body_key_version) {
    throw new Error('decryption_failed');
  }
  return {
    ciphertext: row.body_ciphertext,
    iv: row.body_iv,
    tag: row.body_tag,
    algorithm: row.body_algorithm,
    keyVersion: row.body_key_version,
  };
}

export function prepareMessageBodyForStorage(body: string, encryption: EncryptionConfig) {
  const encrypted = maybeEncryptText(body, encryption);
  return {
    body: encrypted ? null : body,
    bodyCiphertext: encrypted?.ciphertext ?? null,
    bodyIv: encrypted?.iv ?? null,
    bodyTag: encrypted?.tag ?? null,
    bodyAlgorithm: encrypted?.algorithm ?? null,
    bodyKeyVersion: encrypted?.keyVersion ?? null,
  };
}

export function mapMessage(row: MessageRow, encryption: EncryptionConfig): ChatMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    senderType: row.sender_type,
    body: maybeDecryptText(encryptedBodyFromRow(row), row.body, encryption),
    messageType: row.message_type,
    readAt: toIso(row.read_at),
    createdAt: row.created_at.toISOString(),
    attachments: [],
  };
}

export async function listSessionMessages(
  db: PostgresAdapter,
  sessionId: string,
  encryption: EncryptionConfig,
): Promise<ChatMessage[]> {
  const rows = await db.query<MessageRow>(
    `SELECT id, session_id, sender_type, body, body_ciphertext, body_iv, body_tag,
            body_algorithm, body_key_version, message_type, read_at, created_at
       FROM messages
      WHERE session_id = $1
      ORDER BY created_at ASC`,
    [sessionId],
  );
  const messages = rows.map((row) => mapMessage(row, encryption));
  const attachments = await listAttachmentsForMessages(
    db,
    messages.map((message) => message.id),
    encryption,
  );
  return messages.map((message) => ({
    ...message,
    attachments: attachments.get(message.id) || [],
  }));
}

export async function createSessionMessage(
  db: PostgresAdapter,
  encryption: EncryptionConfig,
  sessionId: string,
  senderType: 'visitor' | 'admin',
  body: string,
  adminId: string | null = null,
): Promise<ChatMessage> {
  return db.withTransaction(async (client) => {
    const session = await client.query<{ status: string }>('SELECT status FROM chat_sessions WHERE id = $1', [sessionId]);
    if (!session.rows[0]) throw new HttpError(404, 'session_not_found');
    if (session.rows[0].status === 'closed') throw new HttpError(409, 'session_closed');

    const storedBody = prepareMessageBodyForStorage(body, encryption);
    const result = await client.query<MessageRow>(
      `INSERT INTO messages (
         session_id, sender_type, sender_id, admin_id, body, body_ciphertext, body_iv,
         body_tag, body_algorithm, body_key_version, message_type
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'text')
       RETURNING id, session_id, sender_type, body, body_ciphertext, body_iv, body_tag,
                 body_algorithm, body_key_version, message_type, read_at, created_at`,
      [
        sessionId,
        senderType,
        adminId,
        adminId,
        storedBody.body,
        storedBody.bodyCiphertext,
        storedBody.bodyIv,
        storedBody.bodyTag,
        storedBody.bodyAlgorithm,
        storedBody.bodyKeyVersion,
      ],
    );

    await client.query('UPDATE chat_sessions SET updated_at = now() WHERE id = $1', [sessionId]);
    return mapMessage(result.rows[0], encryption);
  });
}
