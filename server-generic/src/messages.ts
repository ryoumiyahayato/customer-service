import type { PostgresAdapter } from './db/postgres.js';
import { maybeDecryptText, maybeEncryptText, type EncryptedText } from './encryption.js';
import type { EncryptionConfig } from './encryptionConfig.js';
import { HttpError, requireString } from './http.js';
import { listAttachmentsForMessages, type AttachmentMetadata } from './attachments.js';

export type ChatMessage = {
  id: string;
  sessionId: string;
  senderType: 'visitor' | 'admin' | string;
  senderId: string | null;
  body: string | null;
  messageType: string;
  readAt: string | null;
  createdAt: string;
  clientMessageId: string | null;
  deduped?: boolean;
  attachments: AttachmentMetadata[];
};

type MessageRow = {
  id: string;
  session_id: string;
  sender_type: string;
  sender_id: string | null;
  body: string | null;
  body_ciphertext: string | null;
  body_iv: string | null;
  body_tag: string | null;
  body_algorithm: string | null;
  body_key_version: string | null;
  message_type: string;
  read_at: Date | null;
  created_at: Date;
  client_message_id: string | null;
};

const MESSAGE_COLUMNS = `id, session_id, sender_type, sender_id, body, body_ciphertext, body_iv, body_tag,
  body_algorithm, body_key_version, message_type, read_at, created_at, client_message_id`;

export function normalizeMessageBody(value: unknown): string {
  const body = requireString(value, 'body').trim();
  if (!body) throw new HttpError(400, 'message_body_required');
  if (body.length > 4000) throw new HttpError(400, 'message_body_too_long');
  return body;
}

export function normalizeClientMessageId(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new HttpError(400, 'invalid_client_message_id');
  const normalized = value.trim();
  if (!normalized || normalized.length > 128 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new HttpError(400, 'invalid_client_message_id');
  }
  return normalized;
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
    senderId: row.sender_id,
    body: maybeDecryptText(encryptedBodyFromRow(row), row.body, encryption),
    messageType: row.message_type,
    readAt: toIso(row.read_at),
    createdAt: row.created_at.toISOString(),
    clientMessageId: row.client_message_id,
    attachments: [],
  };
}

export async function listSessionMessages(
  db: PostgresAdapter,
  sessionId: string,
  encryption: EncryptionConfig,
): Promise<ChatMessage[]> {
  const rows = await db.query<MessageRow>(
    `SELECT ${MESSAGE_COLUMNS}
       FROM messages
      WHERE session_id = $1
      ORDER BY created_at ASC, id ASC`,
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

async function findExistingMessage(
  client: import('pg').PoolClient,
  encryption: EncryptionConfig,
  sessionId: string,
  senderType: 'visitor' | 'admin',
  senderId: string | null,
  clientMessageId: string,
): Promise<ChatMessage | null> {
  const existing = await client.query<MessageRow>(
    `SELECT ${MESSAGE_COLUMNS}
       FROM messages
      WHERE session_id = $1
        AND sender_type = $2
        AND sender_id IS NOT DISTINCT FROM $3
        AND client_message_id = $4
      LIMIT 1`,
    [sessionId, senderType, senderId, clientMessageId],
  );
  return existing.rows[0] ? mapMessage(existing.rows[0], encryption) : null;
}

export async function createSessionMessage(
  db: PostgresAdapter,
  encryption: EncryptionConfig,
  sessionId: string,
  senderType: 'visitor' | 'admin',
  body: string,
  senderId: string | null = null,
  clientMessageIdValue: string | null = null,
): Promise<ChatMessage> {
  const normalizedBody = normalizeMessageBody(body);
  const clientMessageId = normalizeClientMessageId(clientMessageIdValue);

  return db.withTransaction(async (client) => {
    const session = await client.query<{
      status: string;
      archived_at: Date | null;
      deleted_at: Date | null;
      purged_at: Date | null;
      history_cleared_at: Date | null;
    }>(
      `SELECT status, archived_at, deleted_at, purged_at, history_cleared_at
         FROM chat_sessions
        WHERE id = $1
        FOR SHARE`,
      [sessionId],
    );
    const current = session.rows[0];
    if (!current) throw new HttpError(404, 'session_not_found');
    const normalizedStatus = current.status.toLowerCase();
    if (
      normalizedStatus === 'closed' ||
      normalizedStatus === 'archived' ||
      current.archived_at ||
      current.deleted_at ||
      current.purged_at ||
      current.history_cleared_at
    ) {
      throw new HttpError(409, 'session_ended');
    }

    if (clientMessageId) {
      const existing = await findExistingMessage(client, encryption, sessionId, senderType, senderId, clientMessageId);
      if (existing) {
        if (existing.body !== normalizedBody) throw new HttpError(409, 'client_message_id_conflict');
        return { ...existing, deduped: true };
      }
    }

    const storedBody = prepareMessageBodyForStorage(normalizedBody, encryption);
    const result = await client.query<MessageRow>(
      `INSERT INTO messages (
         session_id, sender_type, sender_id, admin_id, body, body_ciphertext, body_iv,
         body_tag, body_algorithm, body_key_version, message_type, client_message_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'text', $11)
       ON CONFLICT DO NOTHING
       RETURNING ${MESSAGE_COLUMNS}`,
      [
        sessionId,
        senderType,
        senderId,
        senderType === 'admin' ? senderId : null,
        storedBody.body,
        storedBody.bodyCiphertext,
        storedBody.bodyIv,
        storedBody.bodyTag,
        storedBody.bodyAlgorithm,
        storedBody.bodyKeyVersion,
        clientMessageId,
      ],
    );

    if (!result.rows[0] && clientMessageId) {
      const existing = await findExistingMessage(client, encryption, sessionId, senderType, senderId, clientMessageId);
      if (!existing) throw new HttpError(409, 'message_idempotency_conflict');
      if (existing.body !== normalizedBody) throw new HttpError(409, 'client_message_id_conflict');
      return { ...existing, deduped: true };
    }
    if (!result.rows[0]) throw new HttpError(409, 'message_create_conflict');

    await client.query('UPDATE chat_sessions SET updated_at = now() WHERE id = $1', [sessionId]);
    return { ...mapMessage(result.rows[0], encryption), deduped: false };
  });
}

export async function markSessionMessagesRead(
  db: PostgresAdapter,
  sessionId: string,
  readerType: 'visitor' | 'admin',
  requestedMessageIds?: string[],
): Promise<{ messageIds: string[]; readAt: string | null }> {
  const senderType = readerType === 'admin' ? 'visitor' : 'admin';
  const messageIds = requestedMessageIds === undefined
    ? null
    : [...new Set(requestedMessageIds.map((id) => id.trim()).filter(Boolean))];
  if (messageIds && messageIds.length === 0) return { messageIds: [], readAt: null };

  const requestedFilter = messageIds ? 'AND id::text = ANY($3::text[])' : '';
  const params: unknown[] = messageIds ? [sessionId, senderType, messageIds] : [sessionId, senderType];
  const rows = await db.query<{ id: string; read_at: Date }>(
    `UPDATE messages
        SET read_at = COALESCE(read_at, now()), updated_at = now()
      WHERE session_id = $1
        AND sender_type = $2
        AND read_at IS NULL
        ${requestedFilter}
      RETURNING id, read_at`,
    params,
  );
  return {
    messageIds: rows.map((row) => row.id),
    readAt: rows[0]?.read_at?.toISOString() || null,
  };
}
