import type { GenericServerConfig } from './config.js';
import { hashPassword, timingSafeTextEqual } from './crypto.js';
import type { PostgresAdapter } from './db/postgres.js';
import { HttpError, optionalString, requireString } from './http.js';
import { hasAnyAdmin, mapAdmin } from './sessions.js';

export type SetupStatus = {
  ok: true;
  setupAvailable: boolean;
  requiresSetupToken: boolean;
  reason: 'already_configured' | 'missing_setup_token' | 'no_admins';
};

export async function getSetupStatus(config: GenericServerConfig, db: PostgresAdapter): Promise<SetupStatus> {
  const hasAdmin = await hasAnyAdmin(db);
  if (hasAdmin) {
    return {
      ok: true,
      setupAvailable: false,
      requiresSetupToken: false,
      reason: 'already_configured',
    };
  }

  if (!config.setupToken.trim()) {
    return {
      ok: true,
      setupAvailable: false,
      requiresSetupToken: true,
      reason: 'missing_setup_token',
    };
  }

  return {
    ok: true,
    setupAvailable: true,
    requiresSetupToken: true,
    reason: 'no_admins',
  };
}

type NewAdminRow = {
  id: string;
  username: string;
  email: string | null;
  display_name: string | null;
  role: string;
  created_at: Date;
};

function validateUsername(username: string) {
  if (username.length < 3 || username.length > 64) throw new HttpError(400, 'invalid_username');
  if (!/^[A-Za-z0-9_.@-]+$/.test(username)) throw new HttpError(400, 'invalid_username');
}

export async function initializeSetup(config: GenericServerConfig, db: PostgresAdapter, body: Record<string, unknown>) {
  if (await hasAnyAdmin(db)) throw new HttpError(409, 'already_configured');

  const expectedSetupToken = config.setupToken.trim();
  if (!expectedSetupToken) throw new HttpError(403, 'missing_setup_token');

  const setupToken = requireString(body.setupToken, 'setupToken');
  if (!timingSafeTextEqual(setupToken, expectedSetupToken)) throw new HttpError(403, 'invalid_setup_token');

  const username = requireString(body.username, 'username').trim();
  validateUsername(username);

  const email = optionalString(body.email)?.trim() || null;
  const displayName = optionalString(body.displayName)?.trim() || null;
  if (displayName && displayName.length > 80) throw new HttpError(400, 'invalid_display_name');

  const password = requireString(body.password, 'password');
  const confirmPassword = requireString(body.confirmPassword, 'confirmPassword');
  if (password.length < 12) throw new HttpError(400, 'invalid_password');
  if (password !== confirmPassword) throw new HttpError(400, 'password_mismatch');

  const passwordHash = await hashPassword(password);
  const rows = await db.query<NewAdminRow>(
    `INSERT INTO admins (username, email, display_name, password_hash, role)
     VALUES ($1, $2, $3, $4, 'SUPER_ADMIN')
     RETURNING id, username, email, display_name, role, created_at`,
    [username, email, displayName, passwordHash],
  );

  return {
    ok: true,
    initialized: true,
    admin: mapAdmin(rows[0]),
  };
}
