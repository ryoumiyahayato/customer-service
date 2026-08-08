import { COOKIE_NAMES, readCookie } from './cookies';
import { verifySignedValue } from './signing';
import { hashSessionToken } from './sessionTokens';

type AdminSessionEnv = {
  DB: D1Database;
  SESSION_SECRET: string;
};

export type ActiveAdminSession = {
  id: string;
  username: string;
  displayName: string;
  role: 'SUPER_ADMIN' | 'OPERATOR';
  sessionId: string;
  createdAt: string;
  lastSeenAt: string | null;
  expiresAt: string;
};

type AdminSessionRow = {
  id: string;
  username: string;
  display_name: string | null;
  role: 'SUPER_ADMIN' | 'OPERATOR';
  session_id: string;
  created_at: string;
  last_seen_at: string | null;
  expires_at: string;
};

export async function activeAdminSession(
  env: AdminSessionEnv,
  req: Request,
  options: { touch?: boolean } = {},
): Promise<ActiveAdminSession | null> {
  const signed = readCookie(req, COOKIE_NAMES.admin);
  const sessionId = await verifySignedValue(env.SESSION_SECRET, signed);
  if (!sessionId) return null;
  const tokenHash = await hashSessionToken(env.SESSION_SECRET, sessionId);
  const row = await env.DB.prepare(
    `SELECT a.id,a.username,a.display_name,a.role,s.id session_id,
            s.created_at,s.last_seen_at,s.expires_at
       FROM admin_sessions s
       JOIN admins a ON a.id=s.admin_id
      WHERE s.id=? AND s.token_hash=? AND s.revoked_at IS NULL
        AND datetime(s.expires_at)>datetime('now')
        AND datetime(s.created_at)>datetime('now','-1 day')
        AND datetime(COALESCE(s.last_seen_at,s.created_at))>datetime('now','-30 minutes')
        AND COALESCE(a.is_disabled,0)=0
        AND a.role IN ('SUPER_ADMIN','OPERATOR')
      LIMIT 1`,
  ).bind(sessionId, tokenHash).first<AdminSessionRow>();
  if (!row?.id || !row.session_id) return null;

  if (options.touch) {
    const seenAt = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare('UPDATE admin_sessions SET last_seen_at=? WHERE id=? AND revoked_at IS NULL').bind(seenAt, sessionId),
      env.DB.prepare('UPDATE admins SET last_seen_at=? WHERE id=? AND COALESCE(is_disabled,0)=0').bind(seenAt, row.id),
    ]);
  }

  return {
    id: row.id,
    username: row.username,
    displayName: String(row.display_name || row.username || ''),
    role: row.role,
    sessionId: row.session_id,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
  };
}
