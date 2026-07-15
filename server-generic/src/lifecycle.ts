import { deleteAttachmentFilesForSession } from './attachments.js';
import { mapChatSession, requireAdminSessionAccess, type ChatSessionSummary } from './chat.js';
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
                history_cleared_at, assigned_operator_id`,
    [sessionId, isSuperAdmin(admin), admin.id],
  );
  if (!rows[0]) throw new HttpError(404, 'session_not_found');
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
                history_cleared_at, assigned_operator_id`,
    [sessionId, isSuperAdmin(admin), admin.id],
  );
  if (!rows[0]) throw new HttpError(404, 'session_not_found');
  return mapChatSession(rows[0]);
}

export async function clearSessionHistory(
  db: PostgresAdapter,
  storage: LocalStorageAdapter,
  sessionId: string,
  admin: AdminIdentity,
): Promise<{ historyCleared: true; attachmentsDeleted: number }> {
  await requireAdminSessionAccess(db, admin, sessionId);
  const attachmentsDeleted = await deleteAttachmentFilesForSession(db, storage, sessionId);

  await db.withTransaction(async (client) => {
    await client.query('DELETE FROM messages WHERE session_id = $1', [sessionId]);
    const updated = await client.query(
      `UPDATE chat_sessions
          SET history_cleared_at = now(),
              history_cleared_by = $2,
              updated_at = now()
        WHERE id = $1`,
      [sessionId, admin.id],
    );
    if (updated.rowCount === 0) throw new HttpError(404, 'session_not_found');
  });

  return { historyCleared: true, attachmentsDeleted };
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
