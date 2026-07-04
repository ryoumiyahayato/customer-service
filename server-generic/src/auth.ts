import type { GenericServerConfig } from './config.js';
import { verifyPassword } from './crypto.js';
import type { PostgresAdapter } from './db/postgres.js';
import { HttpError, requireString } from './http.js';
import {
  createAdminSession,
  deleteAdminSessionByToken,
  findAdminBySessionToken,
  mapAdmin,
  type AdminIdentity,
} from './sessions.js';

type AdminWithPasswordRow = {
  id: string;
  username: string;
  email: string | null;
  display_name: string | null;
  role: string;
  created_at: Date;
  password_hash: string;
  is_disabled: boolean;
};

export async function loginAdmin(config: GenericServerConfig, db: PostgresAdapter, body: Record<string, unknown>) {
  const usernameOrEmail = requireString(body.username, 'username').trim();
  const password = requireString(body.password, 'password');
  if (!usernameOrEmail || !password) throw new HttpError(401, 'invalid_credentials');

  const rows = await db.query<AdminWithPasswordRow>(
    `SELECT id, username, email, display_name, role, created_at, password_hash, is_disabled
       FROM admins
      WHERE username = $1 OR email = $1
      LIMIT 1`,
    [usernameOrEmail],
  );
  const admin = rows[0];
  if (!admin || admin.is_disabled) throw new HttpError(401, 'invalid_credentials');

  const valid = await verifyPassword(password, admin.password_hash);
  if (!valid) throw new HttpError(401, 'invalid_credentials');

  const session = await createAdminSession(db, admin.id, config);
  return {
    admin: mapAdmin(admin),
    session,
  };
}

export async function logoutAdmin(db: PostgresAdapter, token: string | null): Promise<void> {
  if (!token) return;
  await deleteAdminSessionByToken(db, token);
}

export async function requireCurrentAdmin(db: PostgresAdapter, token: string | null): Promise<AdminIdentity> {
  if (!token) throw new HttpError(401, 'unauthenticated');
  const admin = await findAdminBySessionToken(db, token);
  if (!admin) throw new HttpError(401, 'unauthenticated');
  return admin;
}
