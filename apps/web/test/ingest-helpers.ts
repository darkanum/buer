import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { schema, type IngestDb } from '@buer/db';

const here = dirname(fileURLToPath(import.meta.url));
// apps/web/test -> apps/web -> apps -> repo root -> packages/db/drizzle.
// `@buer/db`'s package.json only maps "." and "./schema" (see its
// exports field), so its migration SQL isn't reachable as a package
// subpath import — a relative fs path to the sibling workspace package is
// the same approach apps/web/test/helpers.ts and packages/db/test/helpers.ts
// already use for their own (single-package) migration directories.
const dbDrizzleDir = join(here, '..', '..', '..', 'packages', 'db', 'drizzle');

/** Concatenates every migration file under packages/db/drizzle/*.sql, in
 * filename order (same pattern as packages/db/test/helpers.ts). */
async function loadDbMigrationSql(): Promise<string> {
  const files = (await readdir(dbDrizzleDir)).filter((f) => f.endsWith('.sql')).sort();
  const parts = await Promise.all(files.map((f) => readFile(join(dbDrizzleDir, f), 'utf8')));
  return parts.join('\n');
}

export interface IngestTestDb {
  /** Drizzle instance typed against @buer/db's schema — satisfies
   * `IngestDb`, same as `writeSnapshot`'s own tests (packages/db/test/helpers.ts). */
  db: IngestDb;
  /** Raw PGlite handle, for assertions the Drizzle query builder doesn't
   * cover as tersely (row counts, ad hoc SELECTs). */
  pglite: PGlite;
}

/**
 * Spins up an in-memory PGlite instance migrated with `@buer/db`'s own
 * migration (packages/db/drizzle/0000_init.sql) — `app.account`,
 * `catalog.*`, `app.raw_object`/`raw_observation`, `app.snapshot`, etc.
 * Better Auth's own tables are NOT part of this db: `handleIngest`'s tests
 * inject `verifyApiKey` directly (see test/ingest.test.ts), so no real
 * Better Auth instance/schema is needed for ingest route tests at all.
 *
 * No seed data beyond what the migration itself inserts (`app.doc_schema`
 * row for doc_schema=1) — every test starts from a schema with zero
 * accounts/snapshots/catalog rows, exactly like a fresh production DB.
 */
export async function makeIngestTestDb(): Promise<IngestTestDb> {
  const pglite = new PGlite();
  await pglite.exec(await loadDbMigrationSql());
  const db = drizzle(pglite, { schema }) as unknown as IngestDb;
  return { db, pglite };
}
