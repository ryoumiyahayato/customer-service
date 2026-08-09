import type { GenericServerConfig } from './config.js';
import { generateSessionToken, hashSessionToken } from './crypto.js';
import type { PostgresAdapter } from './db/postgres.js';

export type AdminIdentity = {
  id: string;
  username: string;
  email: string | null;
  displayName: string | null;
  role: string;
  createdAt: string;
};

export function isSuperAdmin(admin: Pick<AdminIdentity, 'role'>): boolean {
  return admin.role === 'SUPER_ADMIN' || admin.role === 'admin';
}

type AdminRow = {
  id: string;
  username: string;
  email: string | null;
  display_name: string | null;
  role: string;
  created_at: Date;
};

function mapAdmin(row: AdminRow): AdminIdentity {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    displayName: row.display_name,
    role: row.role === 'admin' ? 'SUPER_ADMIN' : row.role,
    createdAt: row.created_at.toISOString(),
  };
}

export async function hasAnyAdmin(db: PostgresAdapter): Promise<boolean> {
  const rows = await db.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM admins');
  return Number(rows[0]?.count || '0') > 0;
}

export async function createAdminSession(db: PostgresAdapter, adminId: string, config: GenericServerConfig) {
  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + config.adminSessionTtl * 1000);

  await db.query(
    `INSERT INTO admin_sessions (admin_id, token_hash, expires_at, last_seen_at)
      VALUES ($1, $2, $3, now())`,
    [adminId, tokenHash, expiresAt],
  );

  return { token, expiresAt };
}

export async function findAdminBySessionToken(db: PostgresAdapter, token: string): Promise<AdminIdentity | null> {
  const tokenHash = hashSessionToken(token);
  const rows = await db.query<AdminRow>(
    `SELECT admins.id, admins.username, admins.email, admins.display_name, admins.role, admins.created_at
       FROM admin_sessions
       JOIN admins ON admins.id = admin_sessions.admin_id
       WHERE admin_sessions.token_hash = $1
         AND admin_sessions.expires_at > now()
         AND admin_sessions.revoked_at IS NULL
         AND admins.is_disabled = FALSE
      LIMIT 1`,
    [tokenHash],
  );
  if (!rows[0]) return null;
  await db.query('UPDATE admin_sessions SET last_seen_at=now() WHERE token_hash=$1 AND revoked_at IS NULL', [tokenHash]);
  return mapAdmin(rows[0]);
}

export async function deleteAdminSessionByToken(db: PostgresAdapter, token: string): Promise<void> {
  const tokenHash = hashSessionToken(token);
  await db.query('DELETE FROM admin_sessions WHERE token_hash = $1', [tokenHash]);
}

export { mapAdmin };
