import { mapChatSession, type ChatSessionSummary } from './chat.js';
import type { PostgresAdapter } from './db/postgres.js';
import { HttpError } from './http.js';
import type { LocalStorageAdapter } from './storage/localStorage.js';
import { isSuperAdmin, type AdminIdentity } from './sessions.js';

export type LifecycleSchedulerPlan = {
  mode: 'cron' | 'systemd-timer' | 'app-scheduler';
  notes: string[];
};

export type LifecycleDryRunOptions = {
  dryRun: boolean;
  limitArchive: number;
  limitRecycle: number;
  limitClearHistory: number;
  cutoffHours: number;
};

export type LifecycleDryRunResult = {
  ok: true;
  dryRun: boolean;
  readOnly: boolean;
  writesExecuted: boolean;
  sqlType: 'SELECT' | 'MIXED';
  autoArchiveCount: number;
  autoRecycleCount: number;
  autoClearHistorySessionCount: number;
};

type CountRow = {
  count: string;
};

type SessionRow = {
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

export function describeLifecycleMigration(): LifecycleSchedulerPlan {
  return {
    mode: 'cron',
    notes: [
      'Cloudflare Scheduled Trigger will be mapped to cron, systemd timer, or app scheduler.',
      'The generic server package must reuse the existing lifecycle safety rules before enabling writes.',
      'Dry-run and write execution must stay separated.',
    ],
  };
}

export function normalizeLifecycleOptions(input: Partial<LifecycleDryRunOptions> = {}): LifecycleDryRunOptions {
  return {
    dryRun: input.dryRun ?? true,
    limitArchive: Math.max(1, Math.min(input.limitArchive ?? 20, 100)),
    limitRecycle: Math.max(1, Math.min(input.limitRecycle ?? 20, 100)),
    limitClearHistory: Math.max(1, Math.min(input.limitClearHistory ?? 10, 50)),
    cutoffHours: Math.max(1, Math.min(input.cutoffHours ?? 24, 168)),
  };
}

export async function archiveSession(
  db: PostgresAdapter,
  admin: AdminIdentity,
  sessionId: string,
): Promise<ChatSessionSummary> {
  const rows = await db.query<SessionRow>(
    `UPDATE chat_sessions
        SET archived_at = COALESCE(archived_at, now()),
            updated_at = now()
      WHERE id = $1
        AND deleted_at IS NULL
        AND ($2::boolean OR assigned_operator_id = $3)
      RETURNING id, status, customer_name, created_at, updated_at, closed_at, archived_at, deleted_at,
                history_cleared_at, purged_at, assigned_operator_id`,
    [sessionId, isSuperAdmin(admin), admin.id],
  );
  if (!rows[0]) throw new HttpError(404, 'session_not_found');
  await db.query(
    'UPDATE visitor_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE chat_session_id=$1 AND revoked_at IS NULL',
    [sessionId],
  );
  return mapChatSession(rows[0]);
}

export async function recycleSession(
  db: PostgresAdapter,
  admin: AdminIdentity,
  sessionId: string,
): Promise<ChatSessionSummary> {
  const rows = await db.query<SessionRow>(
    `UPDATE chat_sessions
        SET deleted_at = COALESCE(deleted_at, now()),
            updated_at = now()
      WHERE id = $1
        AND ($2::boolean OR assigned_operator_id = $3)
      RETURNING id, status, customer_name, created_at, updated_at, closed_at, archived_at, deleted_at,
                history_cleared_at, purged_at, assigned_operator_id`,
    [sessionId, isSuperAdmin(admin), admin.id],
  );
  if (!rows[0]) throw new HttpError(404, 'session_not_found');
  await db.query(
    'UPDATE visitor_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE chat_session_id=$1 AND revoked_at IS NULL',
    [sessionId],
  );
  return mapChatSession(rows[0]);
}

export async function clearSessionHistory(
  db: PostgresAdapter,
  storage: LocalStorageAdapter,
  sessionId: string,
  admin: AdminIdentity,
  confirmation: unknown,
): Promise<{ historyCleared: true; attachmentsDeleted: number }> {
  if (confirmation !== 'CLEAR_HISTORY') throw new HttpError(400, 'invalid_confirmation');
  if (!isSuperAdmin(admin)) throw new HttpError(403, 'forbidden');

  const result = await db.withTransaction(async (client) => {
    const currentAdmin = await client.query<{ id: string }>(
      `SELECT id FROM admins WHERE id=$1 AND role IN ('SUPER_ADMIN','admin') AND is_disabled=FALSE FOR SHARE`,
      [admin.id],
    );
    if (!currentAdmin.rows[0]) throw new HttpError(403, 'forbidden');
    const currentSession = await client.query<SessionRow>(
      `SELECT id,status,customer_name,created_at,updated_at,closed_at,archived_at,deleted_at,
              history_cleared_at,assigned_operator_id,purged_at
         FROM chat_sessions WHERE id=$1 FOR UPDATE`,
      [sessionId],
    );
    const session = currentSession.rows[0];
    if (!session) throw new HttpError(404, 'session_not_found');
    const ended = ['closed', 'archived'].includes(String(session.status).toLowerCase())
      || session.archived_at || session.deleted_at;
    if (!ended || session.purged_at) throw new HttpError(409, 'session_not_terminal');

    const count = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM attachments a JOIN messages m ON m.id=a.message_id
        WHERE m.session_id=$1 AND a.deleted_at IS NULL`,
      [sessionId],
    );
    const timestamp = new Date();
    await client.query(
      `INSERT INTO attachment_cleanup_jobs(
         attachment_id,chat_session_id,storage_key,next_attempt_at,created_at,updated_at
       )
       SELECT a.id,$1,a.storage_key,now(),now(),now()
         FROM attachments a JOIN messages m ON m.id=a.message_id
        WHERE m.session_id=$1 AND a.deleted_at IS NULL
       ON CONFLICT(storage_key) DO UPDATE SET
         completed_at=NULL,last_error=NULL,next_attempt_at=EXCLUDED.next_attempt_at,updated_at=EXCLUDED.updated_at`,
      [sessionId],
    );
    await client.query(
      `UPDATE attachments SET deleted_at=now()
        WHERE message_id IN (SELECT id FROM messages WHERE session_id=$1) AND deleted_at IS NULL`,
      [sessionId],
    );
    await client.query(
      `UPDATE chat_sessions
          SET message_count=0,
              message_bytes=0,
              unclaimed_attachment_count=0,
              unclaimed_attachment_bytes=0,
              updated_at=$1
        WHERE id=$2`,
      [timestamp, sessionId],
    );
    await client.query('DELETE FROM messages WHERE session_id=$1', [sessionId]);
    const updated = await client.query(
      `UPDATE chat_sessions
          SET history_cleared_at=$1,history_cleared_by=$2,updated_at=$1
        WHERE id=$3
          AND (status IN ('closed','archived') OR archived_at IS NOT NULL OR deleted_at IS NOT NULL)
          AND purged_at IS NULL`,
      [timestamp, admin.id, sessionId],
    );
    if (updated.rowCount !== 1) throw new HttpError(409, 'session_state_conflict');
    await client.query(
      `UPDATE visitor_sessions SET revoked_at=COALESCE(revoked_at,now())
        WHERE chat_session_id=$1 AND revoked_at IS NULL`,
      [sessionId],
    );
    await client.query(
      `INSERT INTO system_logs(level,event,actor_id,message)
       VALUES('INFO','chat.history.clear',$1,$2)`,
      [admin.id, JSON.stringify({ sessionId, messagesDeleted: 'all', attachmentsQueued: Number(count.rows[0]?.count || 0) })],
    );
    return Number(count.rows[0]?.count || 0);
  });

  // Cleanup is retried by the scheduler; this best-effort pass only reduces
  // object retention and never controls the already-committed access state.
  await processAttachmentCleanupJobs(db, storage, 500);
  return { historyCleared: true, attachmentsDeleted: result };
}

async function processAttachmentCleanupJobs(db: PostgresAdapter, storage: LocalStorageAdapter, limit: number) {
  const totalLimit = Math.max(1, Math.min(500, Math.floor(limit)));
  let completed = 0;
  for (let batch = 0; batch < 10 && completed < totalLimit; batch += 1) {
    const rows = await db.query<{ id: string; storage_key: string }>(
      `SELECT id,storage_key FROM attachment_cleanup_jobs
        WHERE completed_at IS NULL AND next_attempt_at<=now()
        ORDER BY next_attempt_at ASC LIMIT $1`,
      [Math.min(50, totalLimit - completed)],
    );
    if (!rows.length) break;
    for (const row of rows) {
      try {
        await storage.deleteObject(row.storage_key);
        await db.query('UPDATE attachment_cleanup_jobs SET completed_at=now(),updated_at=now() WHERE id=$1 AND completed_at IS NULL', [row.id]);
        completed += 1;
      } catch (error) {
        await db.query(
          `UPDATE attachment_cleanup_jobs
              SET attempts=attempts+1,next_attempt_at=now()+interval '5 minutes',last_error=$2,updated_at=now()
            WHERE id=$1 AND completed_at IS NULL`,
          [row.id, 'storage_delete_failed'],
        );
      }
    }
  }
}

async function countCandidates(db: PostgresAdapter, sql: string, params: unknown[], limit: number): Promise<number> {
  const rows = await db.query<CountRow>(sql, params);
  return Math.min(Number(rows[0]?.count || 0), limit);
}

export async function runLifecycleDryRun(
  db: PostgresAdapter,
  options: Partial<LifecycleDryRunOptions> = {},
): Promise<LifecycleDryRunResult> {
  const normalized = normalizeLifecycleOptions({ ...options, dryRun: true });
  const interval = `${normalized.cutoffHours} hours`;

  const autoArchiveCount = await countCandidates(
    db,
    `SELECT COUNT(*)::text AS count
       FROM chat_sessions
      WHERE status = 'closed'
        AND closed_at IS NOT NULL
        AND archived_at IS NULL
        AND deleted_at IS NULL
        AND closed_at < now() - $1::interval`,
    [interval],
    normalized.limitArchive,
  );

  const autoRecycleCount = await countCandidates(
    db,
    `SELECT COUNT(*)::text AS count
       FROM chat_sessions
      WHERE archived_at IS NOT NULL
        AND deleted_at IS NULL
        AND archived_at < now() - $1::interval`,
    [interval],
    normalized.limitRecycle,
  );

  const autoClearHistorySessionCount = await countCandidates(
    db,
    `SELECT COUNT(*)::text AS count
       FROM chat_sessions
      WHERE deleted_at IS NOT NULL
        AND history_cleared_at IS NULL
        AND deleted_at < now() - $1::interval`,
    [interval],
    normalized.limitClearHistory,
  );

  return {
    ok: true,
    dryRun: true,
    readOnly: true,
    writesExecuted: false,
    sqlType: 'SELECT',
    autoArchiveCount,
    autoRecycleCount,
    autoClearHistorySessionCount,
  };
}
