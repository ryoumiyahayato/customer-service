import {
  isSessionEnded,
  sessionBucketOf,
  type SessionBucket,
  type SessionStateInput,
} from './domain/sessionState';

export type { SessionBucket } from './domain/sessionState';

export interface LifecycleResult {
  archivedCount: number;
  purgedCount: number;
  expiredAttachmentCount: number;
  expiredRateLimitCount: number;
  expiredSessionCount: number;
  expiredInviteCount: number;
  errorCount: number;
}

const now = () => new Date().toISOString();
const ATTACHMENT_PATH_PREFIX = '/api/attachments/';

function isMissingCleanupSchema(error: unknown): boolean {
  return /no such table:\s*attachment_cleanup_jobs|no such column:\s*(deleted_at|history_cleared_at|image_purged_at)/i.test(String(error));
}

type LifecycleEnv = { DB: D1Database; UPLOADS?: R2Bucket };
type PurgeCandidate = {
  id: string;
  deleted_at: string | null;
  purged_at: string | null;
  history_cleared_at: string | null;
};

export function normalizeSessionBucket(
  session?: SessionStateInput | null,
): SessionBucket | null {
  return sessionBucketOf(session);
}

export function sessionEnded(session?: SessionStateInput | null): boolean {
  return isSessionEnded(session);
}

export async function archiveSession(
  env: LifecycleEnv,
  sessionId: string,
  archivedBy: string | null = null,
): Promise<void> {
  const t = now();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE sessions SET status='ARCHIVED',closed_at=COALESCE(closed_at,?),archived_at=COALESCE(archived_at,?),archived_by=?,updated_at=? WHERE id=? AND deleted_at IS NULL AND purged_at IS NULL`,
    ).bind(t, t, archivedBy, t, sessionId),
    env.DB.prepare(
      'UPDATE visitor_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE session_id=? AND revoked_at IS NULL',
    ).bind(t, sessionId),
  ]);
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
         AND datetime(COALESCE(updated_at, created_at)) <= datetime('now', '-24 hours')
       ORDER BY datetime(COALESCE(updated_at, created_at)) ASC
       LIMIT ?`,
    ).bind(archiveLimit).all<{ id: string }>()
  ).results || [];

  const ids = candidates.map((row) => String(row.id || '')).filter(Boolean);
  if (!ids.length) return { archivedCount: 0 };

  const t = now();
  const result = await env.DB.batch([
    env.DB.prepare(
      `UPDATE sessions SET status='ARCHIVED',closed_at=COALESCE(closed_at,?),archived_at=COALESCE(archived_at,?),archived_by=NULL,updated_at=?
       WHERE id IN (${ids.map(() => '?').join(',')})
         AND deleted_at IS NULL
         AND purged_at IS NULL
         AND archived_at IS NULL
         AND status IN ('PENDING','OPEN')
         AND datetime(COALESCE(updated_at, created_at)) <= datetime('now', '-24 hours')`,
    ).bind(t, t, t, ...ids),
    env.DB.prepare(
      `UPDATE visitor_sessions SET revoked_at=COALESCE(revoked_at,?)
        WHERE session_id IN (${ids.map(() => '?').join(',')}) AND revoked_at IS NULL`,
    ).bind(t, ...ids),
  ]);

  return { archivedCount: Number(result[0]?.meta?.changes || 0) };
}

function attachmentKeyFromPath(path: unknown): string {
  if (typeof path !== 'string' || !path.startsWith(ATTACHMENT_PATH_PREFIX)) return '';
  const rawKey = path.slice(ATTACHMENT_PATH_PREFIX.length);
  if (!rawKey || rawKey.includes('/') || rawKey.includes('?') || rawKey.includes('#')) return '';
  try {
    const key = decodeURIComponent(rawKey);
    return key && key.length <= 300 && !/[\/\u0000-\u001f\u007f]/.test(key) ? key : '';
  } catch {
    return '';
  }
}

async function collectPurgeKeys(env: LifecycleEnv, sessionId: string): Promise<Set<string>> {
  const messages = (
    await env.DB.prepare('SELECT image_path FROM messages WHERE session_id=?').bind(sessionId).all<{ image_path: string | null }>()
  ).results || [];
  const attachments = (
    await env.DB.prepare(
      'SELECT object_key FROM attachments WHERE conversation_id=? OR message_id IN (SELECT id FROM messages WHERE session_id=?)',
    ).bind(sessionId, sessionId).all<{ object_key: string | null }>()
  ).results || [];

  const keys = new Set<string>();
  for (const attachment of attachments) {
    const key = String(attachment.object_key || '');
    if (key) keys.add(key);
  }
  for (const message of messages) {
    const key = attachmentKeyFromPath(message.image_path);
    if (key) keys.add(key);
  }
  return keys;
}

async function claimTrashSessionForPurge(env: LifecycleEnv, candidate: PurgeCandidate): Promise<boolean> {
  if (candidate.purged_at && !candidate.history_cleared_at) return true;

  const t = now();
  const result = await env.DB.prepare(
    `UPDATE sessions
        SET purged_at=?,updated_at=?
      WHERE id=?
        AND deleted_at IS NOT NULL
        AND purged_at IS NULL
        AND datetime(deleted_at) <= datetime('now', '-24 hours')`,
  ).bind(t, t, candidate.id).run();
  return Number(result?.meta?.changes || 0) === 1;
}

async function purgeTrashSessionData(env: LifecycleEnv, candidate: PurgeCandidate): Promise<boolean> {
  const sessionId = String(candidate.id || '');
  if (!sessionId || !(await claimTrashSessionForPurge(env, candidate))) return false;

  const keys = await collectPurgeKeys(env, sessionId);
  const t = now();
  // Tombstone and enqueue first.  R2 deletion is an external side effect and
  // may fail; ordinary reads must be closed even when the cleanup worker has
  // to retry the object deletion later.
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO attachment_cleanup_jobs(
           id,attachment_id,conversation_id,object_key,attempts,next_attempt_at,created_at,updated_at
         )
         SELECT lower(hex(randomblob(16))),a.id,a.conversation_id,a.object_key,0,?,?,?
           FROM attachments a
          WHERE (a.conversation_id=? OR a.message_id IN (SELECT id FROM messages WHERE session_id=?))
            AND a.object_key IS NOT NULL
            AND a.deleted_at IS NULL
         ON CONFLICT(object_key) DO UPDATE SET
           completed_at=NULL,last_error=NULL,next_attempt_at=excluded.next_attempt_at,updated_at=excluded.updated_at`,
      ).bind(t, t, t, sessionId, sessionId),
      env.DB.prepare(
        `UPDATE attachments SET deleted_at=?
          WHERE (conversation_id=? OR message_id IN (SELECT id FROM messages WHERE session_id=?))
            AND deleted_at IS NULL`,
      ).bind(t, sessionId, sessionId),
      env.DB.prepare(
        `UPDATE messages SET content='',image_path=NULL,image_purged_at=COALESCE(image_purged_at,?)
          WHERE session_id=?`,
      ).bind(t, sessionId),
    ]);
  } catch (error) {
    // Pre-cleanup-job self-hosted databases still need the same read
    // invalidation.  If no tombstone column exists, delete the attachment
    // row only after the R2 delete path below has been attempted.
    if (!isMissingCleanupSchema(error)) throw error;
    try {
      await env.DB.prepare(
        `UPDATE attachments SET deleted_at=?
          WHERE (conversation_id=? OR message_id IN (SELECT id FROM messages WHERE session_id=?))
            AND deleted_at IS NULL`,
      ).bind(t, sessionId, sessionId).run();
    } catch (attachmentError) {
      if (!/no such column:\s*deleted_at/i.test(String(attachmentError))) throw attachmentError;
      await env.DB.prepare(
        `DELETE FROM attachments
          WHERE conversation_id=? OR message_id IN (SELECT id FROM messages WHERE session_id=?)`,
      ).bind(sessionId, sessionId).run();
    }
    try {
      await env.DB.prepare(
        `UPDATE messages SET content='',image_path=NULL,image_purged_at=COALESCE(image_purged_at,?)
          WHERE session_id=?`,
      ).bind(t, sessionId).run();
    } catch (messageError) {
      if (!/no such column:\s*image_purged_at/i.test(String(messageError))) throw messageError;
      await env.DB.prepare(
        'UPDATE messages SET content=\'\',image_path=NULL WHERE session_id=?',
      ).bind(sessionId).run();
    }
  }

  if (env.UPLOADS) {
    for (const key of keys) {
      try {
        await env.UPLOADS.delete(key);
      } catch (error) {
        console.error('lifecycle: purge R2 cleanup deferred', { sessionId, error: String(error) });
      }
    }
  }

  const results = await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM attachments
        WHERE (conversation_id=? OR message_id IN (SELECT id FROM messages WHERE session_id=?))
          AND EXISTS (
            SELECT 1 FROM sessions
             WHERE id=? AND purged_at IS NOT NULL AND history_cleared_at IS NULL
          )`,
    ).bind(sessionId, sessionId, sessionId),
    env.DB.prepare(
      `DELETE FROM messages
        WHERE session_id=?
          AND EXISTS (
            SELECT 1 FROM sessions
             WHERE id=? AND purged_at IS NOT NULL AND history_cleared_at IS NULL
          )`,
    ).bind(sessionId, sessionId),
    env.DB.prepare(
      `UPDATE sessions
          SET history_cleared_at=COALESCE(history_cleared_at,?),
              history_cleared_by=COALESCE(history_cleared_by,'system'),
              updated_at=?
        WHERE id=?
          AND purged_at IS NOT NULL
          AND history_cleared_at IS NULL`,
    ).bind(t, t, sessionId),
  ]);

  return Number(results[2]?.meta?.changes || 0) === 1;
}

export async function purgeTrashSessions(
  env: LifecycleEnv,
  limit = 50,
): Promise<{ purgedCount: number }> {
  const purgeLimit = Math.max(0, Math.min(100, Math.floor(limit)));
  if (!purgeLimit) return { purgedCount: 0 };

  const candidates = (
    await env.DB.prepare(
      `SELECT id,deleted_at,purged_at,history_cleared_at FROM sessions
       WHERE (
         deleted_at IS NOT NULL
         AND purged_at IS NULL
         AND datetime(deleted_at) <= datetime('now', '-24 hours')
       ) OR (
         purged_at IS NOT NULL
         AND history_cleared_at IS NULL
       )
       ORDER BY datetime(COALESCE(purged_at, deleted_at)) ASC
       LIMIT ?`,
    ).bind(purgeLimit).all<PurgeCandidate>()
  ).results || [];

  let purgedCount = 0;
  for (const candidate of candidates) {
    try {
      if (await purgeTrashSessionData(env, candidate)) purgedCount += 1;
    } catch (error) {
      console.error('lifecycle: purgeTrashSessionData failed', { sessionId: String(candidate.id || ''), error: String(error) });
    }
  }

  return { purgedCount };
}

export async function cleanupExpiredOrphanAttachments(
  env: LifecycleEnv,
  limit = 50,
): Promise<{ expiredAttachmentCount: number }> {
  const cleanupLimit = Math.max(0, Math.min(100, Math.floor(limit)));
  if (!cleanupLimit || !env.UPLOADS) return { expiredAttachmentCount: 0 };

  const rows = (
    await env.DB.prepare(
      `SELECT id, object_key, conversation_id, byte_size FROM attachments
       WHERE message_id IS NULL
         AND deleted_at IS NULL
         AND expires_at IS NOT NULL
         AND datetime(expires_at) <= datetime('now')
       ORDER BY datetime(expires_at) ASC
       LIMIT ?`,
  ).bind(cleanupLimit).all<{ id: string; object_key: string; conversation_id: string | null; byte_size: number }>()
  ).results || [];

  let cleanedCount = 0;
  for (const row of rows) {
    const id = String(row.id || '');
    const objectKey = String(row.object_key || '');
    if (!id || !objectKey) continue;
    try {
      await env.UPLOADS.delete(objectKey);
      const deleted = await env.DB.prepare(
        'DELETE FROM attachments WHERE id=? AND message_id IS NULL AND deleted_at IS NULL',
      ).bind(id).run();
      if (Number(deleted?.meta?.changes || 0) === 1) {
        cleanedCount += 1;
        if (row.conversation_id) {
          try {
            await env.DB.prepare(
              `UPDATE sessions
                  SET unclaimed_attachment_count=MAX(0,COALESCE(unclaimed_attachment_count,0)-1),
                      unclaimed_attachment_bytes=MAX(0,COALESCE(unclaimed_attachment_bytes,0)-?)
                WHERE id=?`,
            ).bind(Number(row.byte_size || 0), row.conversation_id).run();
          } catch (error) {
            if (!/no such column|unknown column|unclaimed_attachment/i.test(String(error))) throw error;
          }
        }
      }
    } catch (error) {
      console.error('lifecycle: cleanupExpiredOrphanAttachments R2 delete failed', { id, error: String(error) });
    }
  }

  return { expiredAttachmentCount: cleanedCount };
}

export async function cleanupExpiredRateLimits(
  env: LifecycleEnv,
  limit = 200,
): Promise<{ expiredRateLimitCount: number }> {
  const cleanupLimit = Math.max(0, Math.min(500, Math.floor(limit)));
  if (!cleanupLimit) return { expiredRateLimitCount: 0 };

  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const rows = (
    await env.DB.prepare(
      `SELECT key FROM rate_limits
       WHERE reset_at <= ?
       ORDER BY reset_at ASC
       LIMIT ?`,
    ).bind(cutoff, cleanupLimit).all<{ key: string }>()
  ).results || [];
  const keys = rows.map((row) => String(row.key || '')).filter(Boolean);
  if (!keys.length) return { expiredRateLimitCount: 0 };

  for (let i = 0; i < keys.length; i += 80) {
    const chunk = keys.slice(i, i + 80);
    if (chunk.length) await env.DB.prepare(`DELETE FROM rate_limits WHERE key IN (${chunk.map(() => '?').join(',')})`).bind(...chunk).run();
  }

  return { expiredRateLimitCount: keys.length };
}

export async function cleanupExpiredAuthSessions(
  env: LifecycleEnv,
  limit = 200,
): Promise<{ expiredSessionCount: number }> {
  const cleanupLimit = Math.max(0, Math.min(500, Math.floor(limit)));
  if (!cleanupLimit) return { expiredSessionCount: 0 };

  let expiredSessionCount = 0;
  for (const table of ['admin_sessions', 'visitor_sessions']) {
    const rows = (
      await env.DB.prepare(
        `SELECT id FROM ${table}
         WHERE revoked_at IS NOT NULL
            OR datetime(expires_at) <= datetime('now')
         ORDER BY datetime(COALESCE(revoked_at, expires_at, created_at)) ASC
         LIMIT ?`,
      ).bind(cleanupLimit).all<{ id: string }>()
    ).results || [];
    const ids = rows.map((row) => String(row.id || '')).filter(Boolean);
    for (let i = 0; i < ids.length; i += 80) {
      const chunk = ids.slice(i, i + 80);
      if (chunk.length) {
        const result = await env.DB.prepare(`DELETE FROM ${table} WHERE id IN (${chunk.map(() => '?').join(',')})`).bind(...chunk).run();
        expiredSessionCount += Number(result?.meta?.changes || chunk.length);
      }
    }
  }

  return { expiredSessionCount };
}

export async function cleanupExpiredInviteLinks(
  env: LifecycleEnv,
  limit = 100,
): Promise<{ expiredInviteCount: number }> {
  const cleanupLimit = Math.max(0, Math.min(500, Math.floor(limit)));
  if (!cleanupLimit) return { expiredInviteCount: 0 };

  const rows = (
    await env.DB.prepare(
      `SELECT id FROM invite_links
       WHERE datetime(expires_at) <= datetime('now')
          OR revoked_at IS NOT NULL
          OR (consumed_at IS NOT NULL AND datetime(consumed_at) <= datetime('now', '-7 days'))
       ORDER BY datetime(COALESCE(revoked_at, consumed_at, expires_at, created_at)) ASC
       LIMIT ?`,
    ).bind(cleanupLimit).all<{ id: string }>()
  ).results || [];
  const ids = rows.map((row) => String(row.id || '')).filter(Boolean);
  if (!ids.length) return { expiredInviteCount: 0 };

  let expiredInviteCount = 0;
  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80);
    if (chunk.length) {
      const result = await env.DB.prepare(`DELETE FROM invite_links WHERE id IN (${chunk.map(() => '?').join(',')})`).bind(...chunk).run();
      expiredInviteCount += Number(result?.meta?.changes || chunk.length);
    }
  }

  return { expiredInviteCount };
}

export async function runLifecycle(
  env: LifecycleEnv,
): Promise<LifecycleResult> {
  let archivedCount = 0;
  let purgedCount = 0;
  let expiredAttachmentCount = 0;
  let expiredRateLimitCount = 0;
  let expiredSessionCount = 0;
  let expiredInviteCount = 0;
  let errorCount = 0;

  try {
    const archiveResult = await autoArchiveActiveSessions(env, 50);
    archivedCount = archiveResult.archivedCount;
  } catch (error) {
    errorCount++;
    console.error('lifecycle: autoArchiveActiveSessions failed', String(error));
  }

  try {
    const purgeResult = await purgeTrashSessions(env, 50);
    purgedCount = purgeResult.purgedCount;
  } catch (error) {
    errorCount++;
    console.error('lifecycle: purgeTrashSessions failed', String(error));
  }

  try {
    const cleanupResult = await cleanupExpiredOrphanAttachments(env, 500);
    expiredAttachmentCount = cleanupResult.expiredAttachmentCount;
  } catch (error) {
    errorCount++;
    console.error('lifecycle: cleanupExpiredOrphanAttachments failed', String(error));
  }

  try {
    const cleanupResult = await cleanupExpiredRateLimits(env, 200);
    expiredRateLimitCount = cleanupResult.expiredRateLimitCount;
  } catch (error) {
    errorCount++;
    console.error('lifecycle: cleanupExpiredRateLimits failed', String(error));
  }

  try {
    const cleanupResult = await cleanupExpiredAuthSessions(env, 200);
    expiredSessionCount = cleanupResult.expiredSessionCount;
  } catch (error) {
    errorCount++;
    console.error('lifecycle: cleanupExpiredAuthSessions failed', String(error));
  }

  try {
    const cleanupResult = await cleanupExpiredInviteLinks(env, 100);
    expiredInviteCount = cleanupResult.expiredInviteCount;
  } catch (error) {
    errorCount++;
    console.error('lifecycle: cleanupExpiredInviteLinks failed', String(error));
  }

  return {
    archivedCount,
    purgedCount,
    expiredAttachmentCount,
    expiredRateLimitCount,
    expiredSessionCount,
    expiredInviteCount,
    errorCount,
  };
}
