import type { GenericServerConfig } from '../config.js';

export type PostgresAdapter = {
  configured: boolean;
  query: <T = unknown>(sql: string, params?: unknown[]) => Promise<T[]>;
};

export function createPostgresAdapter(config: GenericServerConfig): PostgresAdapter {
  return {
    configured: Boolean(config.databaseUrl),
    async query() {
      throw new Error('PostgreSQL adapter is a skeleton. Implement a real driver in a later package.');
    },
  };
}
