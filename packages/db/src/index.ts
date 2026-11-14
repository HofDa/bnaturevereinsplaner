import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';
export function createDatabase(
  connectionString: string,
  onError: (code: string) => void = (code) => console.error('Database pool error', code),
) {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5000,
    options: '-c timezone=UTC -c statement_timeout=15000',
  });
  pool.on('error', (error: Error & { code?: string }) => {
    onError(error.code ?? 'DATABASE_CONNECTION_ERROR');
  });
  return { db: drizzle(pool, { schema }), pool };
}
export type Database = ReturnType<typeof createDatabase>['db'];
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type Executor = Database | Transaction;
export { schema };
