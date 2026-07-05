import { loadConfig } from './config.js';
import { createPostgresAdapter } from './db/postgres.js';
import { runLifecycleDryRun } from './lifecycle.js';

export async function runGenericLifecycleDryRun() {
  const config = loadConfig();
  if (!config.databaseUrl) throw new Error('DATABASE_URL is required for lifecycle dry-run.');

  const db = createPostgresAdapter(config);
  try {
    return await runLifecycleDryRun(db);
  } finally {
    await db.close();
  }
}
