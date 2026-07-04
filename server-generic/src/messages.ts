import type { PostgresAdapter } from './db/postgres.js';
import { HttpError, requireString } from './http.js';

export type ChatMessage = {
  id: string;
  sessionId: string;
  senderType: 'visitor' | 'admin' | string;
  body: string | null;
  messageType: string;
  readAt: string | null;
  createdAt: string;
};

type MessageRow = {
  id: string;
  session_id: string;
  sender_type: string;
  body: string | null;
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

export function mapMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    senderType: row.sender_type,
    body: row.body,
    messageType: row.message_type,
    readAt: toIso(row.read_at),
    createdAt: row.created_at.toISOString(),
  };
}

export async function listSessionMessages(db: PostgresAdapter, sessionId: string): Promise<ChatMessage[]> {
  const rows = await db.query<MessageRow>(
    `SELECT id, session_id, sender_type, body, message_type, read_at, created_at
       FROM messages
      WHERE session_id = $1
      ORDER BY created_at ASC`,
    [sessionId],
  );
  return rows.map(mapMessage);
}

export async function createSessionMessage(
  db: PostgresAdapter,
  sessionId: string,
  senderType: 'visitor' | 'admin',
  body: string,
  adminId: string | null = null,
): Promise<ChatMessage> {
  return db.withTransaction(async (client) => {
    const session = await client.query<{ status: string }>('SELECT status FROM chat_sessions WHERE id = $1', [sessionId]);
    if (!session.rows[0]) throw new HttpError(404, 'session_not_found');
    if (session.rows[0].status === 'closed') throw new HttpError(409, 'session_closed');

    const result = await client.query<MessageRow>(
      `INSERT INTO messages (session_id, sender_type, sender_id, admin_id, body, message_type)
       VALUES ($1, $2, $3, $4, $5, 'text')
       RETURNING id, session_id, sender_type, body, message_type, read_at, created_at`,
      [sessionId, senderType, adminId, adminId, body],
    );

    await client.query('UPDATE chat_sessions SET updated_at = now() WHERE id = $1', [sessionId]);
    return mapMessage(result.rows[0]);
  });
}
