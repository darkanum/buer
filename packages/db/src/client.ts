import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema/index.js';

export type Database = ReturnType<typeof drizzle<typeof schema>>;

/**
 * App-facing client: connects through the pooled endpoint (e.g. Neon's
 * pgbouncer proxy). Use for request-serving code.
 */
export function db(url: string): Database {
  return drizzle(new Pool({ connectionString: url }), { schema });
}

/**
 * Migration-facing client: connects through the direct (non-pooled) endpoint.
 * `max: 1` keeps this to a single session, which is what DDL/migration runs
 * need (and what `drizzle.config.ts` assumes via `DATABASE_URL_DIRECT`).
 */
export function migrationClient(url: string): Database {
  return drizzle(new Pool({ connectionString: url, max: 1 }), { schema });
}
