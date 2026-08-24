import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../src/schema/index.js';
import type { IngestDb } from '../src/ingest.js';

const here = dirname(fileURLToPath(import.meta.url));
const drizzleDir = join(here, '..', 'drizzle');

/** Concatenates every migration file under drizzle/*.sql, in filename order. */
async function loadMigrationSql(): Promise<string> {
  const files = (await readdir(drizzleDir)).filter((f) => f.endsWith('.sql')).sort();
  const parts = await Promise.all(files.map((f) => readFile(join(drizzleDir, f), 'utf8')));
  return parts.join('\n');
}

export interface TestDb {
  db: IngestDb;
  accountId: bigint;
}

/**
 * Spins up an in-memory PGlite instance, runs the full hand-authored migration
 * (drizzle/*.sql), seeds a single `app.account` row, and wraps the raw client
 * in a Drizzle instance typed against the same schema `writeSnapshot` expects.
 */
export async function makeTestDb(): Promise<TestDb> {
  const pglite = new PGlite();
  await pglite.exec(await loadMigrationSql());

  const db = drizzle(pglite, { schema }) as unknown as IngestDb;

  const inserted = await pglite.query<{ account_id: string }>(
    `INSERT INTO app.account (owner_id, game_uid, region, active_doc_schema)
     VALUES ($1, $2, $3, $4) RETURNING account_id`,
    ['owner-test', 'uid-test', 'os_usa', 1],
  );
  const row = inserted.rows[0];
  if (!row) throw new Error('makeTestDb: falha ao inserir a conta seed');
  const accountId = BigInt(row.account_id);

  return { db, accountId };
}
