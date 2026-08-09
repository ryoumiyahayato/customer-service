import { generateVisitorToken, hashVisitorToken } from './crypto.js';
import type { PostgresAdapter } from './db/postgres.js';
import { HttpError, optionalString } from './http.js';
import { isSuperAdmin, type AdminIdentity } from './sessions.js';

export type ChatSessionSummary = {
  id: string;
  status: string;
  customerName: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  archivedAt: string | null;
  deletedAt: string | null;
  historyClearedAt: string | null;
  purgedAt: string | null;
  assignedOperatorId: string | null;
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
  purged_at: Date | null;
  assigned_operator_id: string | null;
};

const CHAT_SESSION_COLUMNS = `id, status, customer_name, created_at, updated_at, closed_at,
  archived_at, deleted_at, history_cleared_at, purged_at, assigned_operator_id`;

export const CHAT_SESSION_COLUMNS_FROM_C = `c.id, c.status, c.customer_name, c.created_at, c.updated_at, c.closed_at,
  c.archived_at, c.deleted_at, c.history_cleared_at, c.purged_at, c.assigned_operator_id`;

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
    purgedAt: toIso(row.purged_at),
    assignedOperatorId: row.assigned_operator_id,
  };
}

export function canAdminAccessSession(admin: AdminIdentity, assignedOperatorId: string | null): boolean {
  return isSuperAdmin(admin) || assignedOperatorId === admin.id;
}

export type VisitorSessionCapability = 'read' | 'write' | 'upload' | 'socket';

export async function createVisitorSession(db: PostgresAdapter, body: Record<string, unknown>) {
  const customerName = optionalString(body.customerName)?.trim() || null;
  if (customerName && customerName.length > 80) throw new HttpError(400, 'invalid_customer_name');

  const visitorToken = generateVisitorToken();
  const visitorTokenHash = hashVisitorToken(visitorToken);
  return db.withTransaction(async (client) => {
    const rows = await client.query<ChatSessionRow>(
      `INSERT INTO chat_sessions (visitor_token_hash, status, customer_name)
       VALUES ($1, 'open', $2)
       RETURNING ${CHAT_SESSION_COLUMNS}`,
      [visitorTokenHash, customerName],
    );
    const session = rows.rows[0];
    await client.query(
      `INSERT INTO visitor_sessions(chat_session_id,token_hash,created_at,last_seen_at,expires_at)
       VALUES($1,$2,now(),now(),now()+interval '30 days')`,
      [session.id, visitorTokenHash],
    );
    return { session: mapChatSession(session), visitorToken };
  });
}

export async function requireVisitorSession(
  db: PostgresAdapter,
  sessionId: string,
  visitorToken: string | null,
  capability: VisitorSessionCapability = 'read',
) {
  if (!visitorToken) throw new HttpError(401, 'visitor_token_required');
  const rows = await db.query<ChatSessionRow>(
    `SELECT ${CHAT_SESSION_COLUMNS_FROM_C}
       FROM chat_sessions c
       JOIN visitor_sessions v ON v.chat_session_id=c.id
      WHERE c.id = $1
        AND v.token_hash = $2
        AND v.revoked_at IS NULL
        AND v.expires_at > now()
      LIMIT 1`,
    [sessionId, hashVisitorToken(visitorToken)],
  );
  if (!rows[0]) throw new HttpError(404, 'session_not_found');
  await db.query('UPDATE visitor_sessions SET last_seen_at=now() WHERE chat_session_id=$1 AND token_hash=$2 AND revoked_at IS NULL', [sessionId, hashVisitorToken(visitorToken)]);
  const status = rows[0].status.toLowerCase();
  const ended = status === 'closed' || status === 'archived' || rows[0].archived_at || rows[0].deleted_at || rows[0].purged_at || rows[0].history_cleared_at;
  if (capability !== 'read' && ended) throw new HttpError(409, 'session_ended');
  return mapChatSession(rows[0]);
}

export async function requireAdminSessionExists(db: PostgresAdapter, sessionId: string) {
  const rows = await db.query<ChatSessionRow>(
    `SELECT ${CHAT_SESSION_COLUMNS}
       FROM chat_sessions
      WHERE id = $1
      LIMIT 1`,
    [sessionId],
  );
  if (!rows[0]) throw new HttpError(404, 'session_not_found');
  return mapChatSession(rows[0]);
}

export async function requireAdminSessionAccess(
  db: PostgresAdapter,
  admin: AdminIdentity,
  sessionId: string,
): Promise<ChatSessionSummary> {
  const session = await requireAdminSessionExists(db, sessionId);
  if (!canAdminAccessSession(admin, session.assignedOperatorId)) throw new HttpError(404, 'session_not_found');
  return session;
}

export async function listAdminChatSessions(
  db: PostgresAdapter,
  admin: AdminIdentity,
  limit = 50,
): Promise<ChatSessionSummary[]> {
  const safeLimit = Math.max(1, Math.min(limit, 100));
  const rows = await db.query<ChatSessionRow>(
    `SELECT ${CHAT_SESSION_COLUMNS}
       FROM chat_sessions
      WHERE ($1::boolean OR assigned_operator_id = $2)
      ORDER BY updated_at DESC
      LIMIT $3`,
    [isSuperAdmin(admin), admin.id, safeLimit],
  );
  return rows.map(mapChatSession);
}

export async function closeChatSession(
  db: PostgresAdapter,
  admin: AdminIdentity,
  sessionId: string,
): Promise<ChatSessionSummary> {
  const rows = await db.query<ChatSessionRow>(
    `UPDATE chat_sessions
        SET status = 'closed',
            closed_at = COALESCE(closed_at, now()),
            updated_at = now()
      WHERE id = $1
        AND ($2::boolean OR assigned_operator_id = $3)
      RETURNING ${CHAT_SESSION_COLUMNS}`,
    [sessionId, isSuperAdmin(admin), admin.id],
  );
  if (!rows[0]) throw new HttpError(404, 'session_not_found');
  await db.query('UPDATE visitor_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE chat_session_id=$1 AND revoked_at IS NULL', [sessionId]);
  return mapChatSession(rows[0]);
}

