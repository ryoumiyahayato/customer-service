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

// Public, non-secret dummy hash used only to equalize KDF cost for unknown/disabled usernames.
const DUMMY_ADMIN_PASSWORD_HASH = 'scrypt:v1:Y3VzdG9tZXItc2VydmljZQ:r2odcRGGReylRo5Nox-ZCXE5G40w0er7MpY_d7UXDejuBEanNtBP5eCqjxx2yGvDmb7VEIoj67DmQtJN8k3H8g';

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
  const valid = await verifyPassword(password, admin?.password_hash || DUMMY_ADMIN_PASSWORD_HASH);
  if (!admin || admin.is_disabled || !valid) throw new HttpError(401, 'invalid_credentials');

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
