import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../config.js';
import { createPostgresAdapter } from './postgres.js';

type MigrationFile = {
  version: string;
  fileName: string;
  sql: string;
};

async function readMigrations(migrationsDir: string): Promise<MigrationFile[]> {
  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right));

  return Promise.all(
    files.map(async (fileName) => ({
      version: fileName.replace(/\.sql$/, ''),
      fileName,
      sql: await readFile(path.join(migrationsDir, fileName), 'utf8'),
    })),
  );
}

async function ensureMigrationTable(db: ReturnType<typeof createPostgresAdapter>) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function appliedVersions(db: ReturnType<typeof createPostgresAdapter>) {
  await ensureMigrationTable(db);
  const rows = await db.query<{ version: string }>('SELECT version FROM schema_migrations ORDER BY version');
  return new Set(rows.map((row) => row.version));
}

async function main() {
  const config = loadConfig();
  if (!config.databaseUrl) {
    console.error('DATABASE_URL is required for generic server migrations.');
    process.exitCode = 1;
    return;
  }

  const statusOnly = process.argv.includes('--status');
  const migrationsDir = path.join(process.cwd(), 'migrations');
  const migrations = await readMigrations(migrationsDir);
  const db = createPostgresAdapter(config);

  try {
    const applied = await appliedVersions(db);
    const pending = migrations.filter((migration) => !applied.has(migration.version));

    if (statusOnly) {
      console.log(`server-generic migrations: applied=${applied.size} pending=${pending.length}`);
      return;
    }

    for (const migration of pending) {
      await db.withTransaction(async (client) => {
        await client.query(migration.sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING', [
          migration.version,
        ]);
      });
      console.log(`Applied migration ${migration.fileName}`);
    }

    console.log(`server-generic migrations complete: applied_now=${pending.length}`);
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Migration failed.');
  process.exitCode = 1;
});
