import { generateVisitorToken, hashVisitorToken } from './crypto.js';
import type { PostgresAdapter } from './db/postgres.js';
import { HttpError, optionalString } from './http.js';

export type ChatSessionStatus = 'open' | 'closed' | string;

export type ChatSessionSummary = {
  id: string;
  status: ChatSessionStatus;
  customerName: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  archivedAt: string | null;
  deletedAt: string | null;
  historyClearedAt: string | null;
};

type ChatSessionRow = {
  id: string;
  status: string;
  customer_name: string | null;
  created_at: Date;
  updated_at: Date;
  closed_at: Date | null;
  archived_at: Date | null;
  deleted_at: Date | null;
  history_cleared_at: Date | null;
};

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function mapChatSession(row: ChatSessionRow): ChatSessionSummary {
  return {
    id: row.id,
    status: row.status,
    customerName: row.customer_name,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    closedAt: toIso(row.closed_at),
    archivedAt: toIso(row.archived_at),
    deletedAt: toIso(row.deleted_at),
    historyClearedAt: toIso(row.history_cleared_at),
  };
}

export async function createVisitorSession(db: PostgresAdapter, body: Record<string, unknown>) {
  const customerName = optionalString(body.customerName)?.trim() || null;
  if (customerName && customerName.length > 80) throw new HttpError(400, 'invalid_customer_name');

  const visitorToken = generateVisitorToken();
  const visitorTokenHash = hashVisitorToken(visitorToken);
  const rows = await db.query<ChatSessionRow>(
    `INSERT INTO chat_sessions (visitor_token_hash, status, customer_name)
     VALUES ($1, 'open', $2)
     RETURNING id, status, customer_name, created_at, updated_at, closed_at, archived_at, deleted_at, history_cleared_at`,
    [visitorTokenHash, customerName],
  );

  return {
    session: mapChatSession(rows[0]),
    visitorToken,
  };
}

export async function requireVisitorSession(db: PostgresAdapter, sessionId: string, visitorToken: string | null) {
  if (!visitorToken) throw new HttpError(401, 'visitor_token_required');
  const rows = await db.query<ChatSessionRow>(
    `SELECT id, status, customer_name, created_at, updated_at, closed_at, archived_at, deleted_at, history_cleared_at
       FROM chat_sessions
      WHERE id = $1 AND visitor_token_hash = $2
      LIMIT 1`,
    [sessionId, hashVisitorToken(visitorToken)],
  );
  if (!rows[0]) throw new HttpError(404, 'session_not_found');
  return mapChatSession(rows[0]);
}

export async function requireAdminSessionExists(db: PostgresAdapter, sessionId: string) {
  const rows = await db.query<ChatSessionRow>(
    `SELECT id, status, customer_name, created_at, updated_at, closed_at, archived_at, deleted_at, history_cleared_at
       FROM chat_sessions
      WHERE id = $1
      LIMIT 1`,
    [sessionId],
  );
  if (!rows[0]) throw new HttpError(404, 'session_not_found');
  return mapChatSession(rows[0]);
}

export async function listAdminChatSessions(db: PostgresAdapter, limit = 50): Promise<ChatSessionSummary[]> {
  const safeLimit = Math.max(1, Math.min(limit, 100));
  const rows = await db.query<ChatSessionRow>(
    `SELECT id, status, customer_name, created_at, updated_at, closed_at, archived_at, deleted_at, history_cleared_at
       FROM chat_sessions
      ORDER BY updated_at DESC
      LIMIT $1`,
    [safeLimit],
  );
  return rows.map(mapChatSession);
}

export async function closeChatSession(db: PostgresAdapter, sessionId: string): Promise<ChatSessionSummary> {
  const rows = await db.query<ChatSessionRow>(
    `UPDATE chat_sessions
        SET status = 'closed',
            closed_at = COALESCE(closed_at, now()),
            updated_at = now()
      WHERE id = $1
      RETURNING id, status, customer_name, created_at, updated_at, closed_at, archived_at, deleted_at, history_cleared_at`,
    [sessionId],
  );
  if (!rows[0]) throw new HttpError(404, 'session_not_found');
  return mapChatSession(rows[0]);
}
