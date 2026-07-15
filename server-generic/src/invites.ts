import { randomBytes } from 'node:crypto';
import { generateVisitorToken, hashSessionToken, hashVisitorToken } from './crypto.js';
import { mapChatSession, type ChatSessionSummary } from './chat.js';
import type { PostgresAdapter } from './db/postgres.js';
import { HttpError } from './http.js';
import { isSuperAdmin, type AdminIdentity } from './sessions.js';

const DEFAULT_INVITE_TTL_SECONDS = 15 * 60;
const MIN_INVITE_TTL_SECONDS = 60;
const MAX_INVITE_TTL_SECONDS = 24 * 60 * 60;

const generateInviteToken = () => randomBytes(20).toString('hex');

type InviteRow = {
  id: string;
  token_hash: string;
  created_by_admin_id: string;
  source_admin_id: string | null;
  session_id: string | null;
  expires_at: Date;
  consumed_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
  updated_at: Date;
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
  assigned_operator_id: string | null;
};

export type PublicInvite = {
  id: string;
  createdByAdminId: string;
  sourceAdminId: string | null;
  sessionId: string | null;
  expiresAt: string;
  consumedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export type InviteCreationResult = {
  token: string;
  invite: PublicInvite;
};

export type InviteConsumptionResult = {
  invite: PublicInvite;
  session: ChatSessionSummary;
  visitorToken: string;
  resumed: boolean;
};

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function mapInvite(row: InviteRow): PublicInvite {
  return {
    id: row.id,
    createdByAdminId: row.created_by_admin_id,
    sourceAdminId: row.source_admin_id,
    sessionId: row.session_id,
    expiresAt: row.expires_at.toISOString(),
    consumedAt: toIso(row.consumed_at),
    revokedAt: toIso(row.revoked_at),
    createdAt: row.created_at.toISOString(),
  };
}

function normalizeTtlSeconds(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_INVITE_TTL_SECONDS;
  return Math.max(MIN_INVITE_TTL_SECONDS, Math.min(MAX_INVITE_TTL_SECONDS, Math.floor(parsed)));
}

function normalizeToken(value: string): string {
  const token = value.trim();
  if (!token || token.length > 256) throw new HttpError(404, 'invite_not_found');
  return token;
}

async function requireActiveSourceOperator(db: PostgresAdapter, sourceAdminId: string | null) {
  if (!sourceAdminId) return;
  const rows = await db.query<{ id: string }>(
    `SELECT id
       FROM admins
      WHERE id = $1
        AND is_disabled = FALSE
        AND role = 'OPERATOR'
      LIMIT 1`,
    [sourceAdminId],
  );
  if (!rows[0]) throw new HttpError(404, 'source_admin_not_found');
}

export async function createInvite(
  db: PostgresAdapter,
  admin: AdminIdentity,
  input: { sourceAdminId?: string | null; expiresInSeconds?: unknown } = {},
): Promise<InviteCreationResult> {
  const requestedSourceAdminId = input.sourceAdminId?.trim() || null;
  const sourceAdminId = isSuperAdmin(admin) ? requestedSourceAdminId : admin.id;
  if (!isSuperAdmin(admin) && requestedSourceAdminId && requestedSourceAdminId !== admin.id) {
    throw new HttpError(403, 'forbidden');
  }
  await requireActiveSourceOperator(db, sourceAdminId);

  const ttlSeconds = normalizeTtlSeconds(input.expiresInSeconds);
  const token = generateInviteToken();
  const tokenHash = hashSessionToken(token);
  const rows = await db.query<InviteRow>(
    `INSERT INTO invite_links (
       token_hash, created_by_admin_id, source_admin_id, expires_at
     )
     VALUES ($1, $2, $3, now() + ($4::text || ' seconds')::interval)
     RETURNING id, token_hash, created_by_admin_id, source_admin_id, session_id,
               expires_at, consumed_at, revoked_at, created_at, updated_at`,
    [tokenHash, admin.id, sourceAdminId, ttlSeconds],
  );

  return { token, invite: mapInvite(rows[0]) };
}

export async function listInvites(db: PostgresAdapter, admin: AdminIdentity, limit = 100): Promise<PublicInvite[]> {
  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
  const rows = await db.query<InviteRow>(
    `SELECT id, token_hash, created_by_admin_id, source_admin_id, session_id,
            expires_at, consumed_at, revoked_at, created_at, updated_at
       FROM invite_links
      WHERE ($1::boolean OR created_by_admin_id = $2 OR source_admin_id = $2)
      ORDER BY created_at DESC
      LIMIT $3`,
    [isSuperAdmin(admin), admin.id, safeLimit],
  );
  return rows.map(mapInvite);
}

export async function revokeInvite(db: PostgresAdapter, admin: AdminIdentity, inviteId: string): Promise<PublicInvite> {
  return db.withTransaction(async (client) => {
    const existing = await client.query<InviteRow>(
      `SELECT id, token_hash, created_by_admin_id, source_admin_id, session_id,
              expires_at, consumed_at, revoked_at, created_at, updated_at
         FROM invite_links
        WHERE id = $1
          AND ($2::boolean OR created_by_admin_id = $3 OR source_admin_id = $3)
        FOR UPDATE`,
      [inviteId, isSuperAdmin(admin), admin.id],
    );
    const invite = existing.rows[0];
    if (!invite) throw new HttpError(404, 'invite_not_found');
    if (invite.consumed_at) throw new HttpError(409, 'invite_already_consumed');
    if (invite.revoked_at) throw new HttpError(409, 'invite_already_revoked');

    const updated = await client.query<InviteRow>(
      `UPDATE invite_links
          SET revoked_at = now(), updated_at = now()
        WHERE id = $1
        RETURNING id, token_hash, created_by_admin_id, source_admin_id, session_id,
                  expires_at, consumed_at, revoked_at, created_at, updated_at`,
      [inviteId],
    );
    return mapInvite(updated.rows[0]);
  });
}

export async function consumeInvite(
  db: PostgresAdapter,
  rawToken: string,
  existingVisitorToken: string | null,
  customerName = '访客',
): Promise<InviteConsumptionResult> {
  const token = normalizeToken(rawToken);
  const tokenHash = hashSessionToken(token);

  return db.withTransaction(async (client) => {
    const inviteResult = await client.query<InviteRow>(
      `SELECT id, token_hash, created_by_admin_id, source_admin_id, session_id,
              expires_at, consumed_at, revoked_at, created_at, updated_at
         FROM invite_links
        WHERE token_hash = $1
        FOR UPDATE`,
      [tokenHash],
    );
    const invite = inviteResult.rows[0];
    if (!invite || invite.revoked_at) throw new HttpError(404, 'invite_not_found');
    if (invite.expires_at.getTime() <= Date.now()) throw new HttpError(410, 'invite_expired');

    if (invite.consumed_at) {
      if (!invite.session_id || !existingVisitorToken) throw new HttpError(410, 'invite_already_consumed');
      const resumed = await client.query<ChatSessionRow>(
        `SELECT id, status, customer_name, created_at, updated_at, closed_at,
                archived_at, deleted_at, history_cleared_at, assigned_operator_id
           FROM chat_sessions
          WHERE id = $1
            AND visitor_token_hash = $2
            AND deleted_at IS NULL
            AND history_cleared_at IS NULL
          LIMIT 1`,
        [invite.session_id, hashVisitorToken(existingVisitorToken)],
      );
      if (!resumed.rows[0]) throw new HttpError(410, 'invite_already_consumed');
      return {
        invite: mapInvite(invite),
        session: mapChatSession(resumed.rows[0]),
        visitorToken: existingVisitorToken,
        resumed: true,
      };
    }

    const visitorToken = generateVisitorToken();
    const visitorTokenHash = hashVisitorToken(visitorToken);
    const sessionResult = await client.query<ChatSessionRow>(
      `INSERT INTO chat_sessions (visitor_token_hash, status, customer_name, assigned_operator_id)
       VALUES ($1, 'open', $2, $3)
       RETURNING id, status, customer_name, created_at, updated_at, closed_at,
                 archived_at, deleted_at, history_cleared_at, assigned_operator_id`,
      [visitorTokenHash, customerName.trim().slice(0, 80) || '访客', invite.source_admin_id],
    );
    const session = sessionResult.rows[0];

    const consumed = await client.query<InviteRow>(
      `UPDATE invite_links
          SET consumed_at = now(), session_id = $2, updated_at = now()
        WHERE id = $1
          AND consumed_at IS NULL
          AND revoked_at IS NULL
          AND expires_at > now()
        RETURNING id, token_hash, created_by_admin_id, source_admin_id, session_id,
                  expires_at, consumed_at, revoked_at, created_at, updated_at`,
      [invite.id, session.id],
    );
    if (consumed.rowCount !== 1) throw new HttpError(409, 'invite_consumption_conflict');

    return {
      invite: mapInvite(consumed.rows[0]),
      session: mapChatSession(session),
      visitorToken,
      resumed: false,
    };
  });
}
