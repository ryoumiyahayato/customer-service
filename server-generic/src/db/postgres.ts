import type { GenericServerConfig } from '../config.js';
import pg from 'pg';

export type PostgresAdapter = {
  configured: boolean;
  query: <T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params?: unknown[]) => Promise<T[]>;
  withTransaction: <T>(handler: (client: pg.PoolClient) => Promise<T>) => Promise<T>;
  close: () => Promise<void>;
};

export function createPostgresAdapter(config: GenericServerConfig): PostgresAdapter {
  const pool = config.databaseUrl
    ? new pg.Pool({
        connectionString: config.databaseUrl,
        max: 10,
      })
    : undefined;

  return {
    configured: Boolean(config.databaseUrl),
    async query<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params: unknown[] = []) {
      if (!pool) throw new Error('database_not_configured');
      const result = await pool.query<T>(sql, params);
      return result.rows;
    },
    async withTransaction<T>(handler: (client: pg.PoolClient) => Promise<T>) {
      if (!pool) throw new Error('database_not_configured');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await handler(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool?.end();
    },
  };
}
