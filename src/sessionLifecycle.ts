export type SessionBucket = 'active' | 'archived' | 'trash' | 'purged';

export interface LifecycleResult {
  archivedCount: number;
  purgedCount: number;
  expiredAttachmentCount: number;
  errorCount: number;
}

const now = () => new Date().toISOString();

type LifecycleEnv = { DB: D1Database; UPLOADS?: R2Bucket };

export function normalizeSessionBucket(session: any): SessionBucket | null {
  if (!session) return null;
  if (session.purged_at) return 'purged';
  if (session.deleted_at) return 'trash';
  if (session.archived_at || session.status === 'ARCHIVED' || session.status === 'CLOSED') return 'archived';
  return 'active';
}

export function sessionEnded(session: any): boolean {
  return Boolean(!session || session.deleted_at || session.purged_at || session.status === 'CLOSED' || session.status === 'ARCHIVED');
}

export async function archiveSession(
  env: LifecycleEnv,
  sessionId: string,
  archivedBy: string | null = null,
): Promise<void> {
  const t = now();
  await env.DB.prepare(
    `UPDATE sessions SET status='ARCHIVED',closed_at=COALESCE(closed_at,?),archived_at=COALESCE(archived_at,?),archived_by=?,updated_at=? WHERE id=? AND deleted_at IS NULL AND purged_at IS NULL`
  ).bind(t, t, archivedBy, t, sessionId).run();
}

export async function autoArchiveActiveSessions(
  env: LifecycleEnv,
  limit = 50,
): Promise<{ archivedCount: number }> {
  const archiveLimit = Math.max(0, Math.min(100, Math.floor(limit)));
  if (!archiveLimit) return { archivedCount: 0 };

  const candidates = (
    await env.DB.prepare(
      `SELECT id FROM sessions
       WHERE deleted_at IS NULL
         AND purged_at IS NULL
         AND archived_at IS NULL
         AND status IN ('PENDING','OPEN')
         AND COALESCE(updated_at, created_at) <= datetime('now', '-24 hours')
       ORDER BY COALESCE(updated_at, created_at) ASC
       LIMIT ?`
    ).bind(archiveLimit).all<any>()
  ).results || [];

  const ids = candidates.map((row: any) => String(row.id || '')).filter(Boolean);
  if (!ids.length) return { archivedCount: 0 };

  const t = now();
  const result: any = await env.DB.prepare(
    `UPDATE sessions SET status='ARCHIVED',closed_at=COALESCE(closed_at,?),archived_at=COALESCE(archived_at,?),archived_by=NULL,updated_at=?
     WHERE id IN (${ids.map(() => '?').join(',')})
       AND deleted_at IS NULL
       AND purged_at IS NULL
       AND archived_at IS NULL
       AND status IN ('PENDING','OPEN')`
  ).bind(t, t, t, ...ids).run();

  return { archivedCount: Number(result?.meta?.changes || 0) };
}

export async function purgeTrashSessions(
  env: LifecycleEnv,
  limit = 50,
): Promise<{ purgedCount: number }> {
  const purgeLimit = Math.max(0, Math.min(100, Math.floor(limit)));
  if (!purgeLimit) return { purgedCount: 0 };

  const candidates = (
    await env.DB.prepare(
      `SELECT id FROM sessions
       WHERE deleted_at IS NOT NULL
         AND purged_at IS NULL
         AND deleted_at <= datetime('now', '-24 hours')
       ORDER BY deleted_at ASC
       LIMIT ?`
    ).bind(purgeLimit).all<any>()
  ).results || [];

  const ids = candidates.map((row: any) => String(row.id || '')).filter(Boolean);
  if (!ids.length) return { purgedCount: 0 };

  const t = now();
  const result: any = await env.DB.prepare(
    `UPDATE sessions SET purged_at=?,updated_at=?
     WHERE id IN (${ids.map(() => '?').join(',')})
       AND deleted_at IS NOT NULL
       AND purged_at IS NULL`
  ).bind(t, t, ...ids).run();

  return { purgedCount: Number(result?.meta?.changes || 0) };
}

export async function cleanupExpiredOrphanAttachments(
  env: LifecycleEnv,
  limit = 50,
): Promise<{ expiredAttachmentCount: number }> {
  const cleanupLimit = Math.max(0, Math.min(100, Math.floor(limit)));
  if (!cleanupLimit || !env.UPLOADS) return { expiredAttachmentCount: 0 };

  const cutoff = now();
  const rows = (
    await env.DB.prepare(
      `SELECT id, object_key FROM attachments
       WHERE message_id IS NULL
         AND deleted_at IS NULL
         AND expires_at IS NOT NULL
         AND expires_at <= ?
       ORDER BY expires_at ASC
       LIMIT ?`
    ).bind(cutoff, cleanupLimit).all<any>()
  ).results || [];

  const cleanedIds: string[] = [];
  for (const row of rows) {
    const id = String(row.id || '');
    const objectKey = String(row.object_key || '');
    if (!id || !objectKey) continue;
    try {
      await env.UPLOADS.delete(objectKey);
      cleanedIds.push(id);
    } catch (error) {
      console.error('lifecycle: cleanupExpiredOrphanAttachments R2 delete failed', { id, objectKey, error });
    }
  }

  for (let i = 0; i < cleanedIds.length; i += 80) {
    const chunk = cleanedIds.slice(i, i + 80);
    if (chunk.length) {
      await env.DB.prepare(`DELETE FROM attachments WHERE id IN (${chunk.map(() => '?').join(',')}) AND message_id IS NULL`).bind(...chunk).run();
    }
  }

  return { expiredAttachmentCount: cleanedIds.length };
}

export async function runLifecycle(
  env: LifecycleEnv,
): Promise<LifecycleResult> {
  let archivedCount = 0;
  let purgedCount = 0;
  let expiredAttachmentCount = 0;
  let errorCount = 0;

  try {
    const archiveResult = await autoArchiveActiveSessions(env, 50);
    archivedCount = archiveResult.archivedCount;
  } catch (e) {
    errorCount++;
    console.error('lifecycle: autoArchiveActiveSessions failed', e);
  }

  try {
    const purgeResult = await purgeTrashSessions(env, 50);
    purgedCount = purgeResult.purgedCount;
  } catch (e) {
    errorCount++;
    console.error('lifecycle: purgeTrashSessions failed', e);
  }

  try {
    const cleanupResult = await cleanupExpiredOrphanAttachments(env, 50);
    expiredAttachmentCount = cleanupResult.expiredAttachmentCount;
  } catch (e) {
    errorCount++;
    console.error('lifecycle: cleanupExpiredOrphanAttachments failed', e);
  }

  return { archivedCount, purgedCount, expiredAttachmentCount, errorCount };
}
