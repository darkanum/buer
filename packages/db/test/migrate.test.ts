import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type { InferInsertModel } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { characterState } from '../src/schema/app.js';

const here = dirname(fileURLToPath(import.meta.url));
const drizzleDir = join(here, '..', 'drizzle');

// Type-level guard (checked by `pnpm --filter @buer/db typecheck`, not at
// runtime): app.character_state.content_hash is `GENERATED ALWAYS AS
// (sha256(doc_canon)) STORED` in Postgres, so the insert shape drizzle-orm
// infers for it must NOT accept `contentHash`. If `.generatedAlwaysAs()` ever
// stops excluding the column from `InferInsertModel`, this object literal
// starts type-checking again and the `@ts-expect-error` below turns into a
// hard "unused directive" error under tsc.
type CharacterStateInsert = InferInsertModel<typeof characterState>;
const _characterStateInsertRejectsContentHash: CharacterStateInsert = {
  accountId: 1n,
  charKey: '10000089',
  docSchema: 1,
  docCanon: Buffer.alloc(0),
  // @ts-expect-error contentHash is a DB-generated column; it must not be insertable.
  contentHash: Buffer.alloc(32),
  charLevel: 1,
  ascension: 0,
  constellation: 0,
};
void _characterStateInsertRejectsContentHash;

/** Concatenates every migration file under drizzle/*.sql, in filename order. */
async function loadMigrationSql(): Promise<string> {
  const files = (await readdir(drizzleDir)).filter((f) => f.endsWith('.sql')).sort();
  const parts = await Promise.all(files.map((f) => readFile(join(drizzleDir, f), 'utf8')));
  return parts.join('\n');
}

describe('migration', () => {
  it('cria raw_object (não particionado) e raw_observation (particionado) sem erro', async () => {
    const pg = new PGlite();
    const sql = await loadMigrationSql();

    // This is the §5.3 trap: a naive single-table `raw_observation` with
    // `PRIMARY KEY (raw_sha256)` + `PARTITION BY RANGE (captured_at)` fails with
    // "unique constraint on partitioned table must include all partitioning
    // columns". The migration must run clean end-to-end, including the
    // concrete partition and the ALTER ... SET STORAGE EXTERNAL statement.
    await pg.exec(sql);

    const r = await pg.query<{ a: string | null; b: string | null }>(
      `SELECT to_regclass('app.raw_object') a, to_regclass('app.raw_observation') b`,
    );
    expect(r.rows[0]?.a).not.toBeNull();
    expect(r.rows[0]?.b).not.toBeNull();
  });

  it('cria app.character_state e computa content_hash via coluna gerada (sha256)', async () => {
    const pg = new PGlite();
    const sql = await loadMigrationSql();
    await pg.exec(sql);

    const exists = await pg.query<{ r: string | null }>(`SELECT to_regclass('app.character_state') r`);
    expect(exists.rows[0]?.r).not.toBeNull();

    // Minimal FK graph: app.doc_schema(1) is seeded by the migration itself.
    await pg.query(
      `INSERT INTO app.account (owner_id, game_uid, region, active_doc_schema) VALUES ($1, $2, $3, $4)`,
      ['owner-1', 'uid-1', 'os_usa', 1],
    );
    await pg.query(`INSERT INTO catalog.character (char_key, avatar_id, slug) VALUES ($1, $2, $3)`, [
      '10000089',
      10000089,
      'hu-tao',
    ]);

    const docCanon = Buffer.from('{"v":1,"char":"10000089"}', 'utf8');
    await pg.query(
      `INSERT INTO app.character_state
         (account_id, char_key, doc_schema, doc_canon, char_level, ascension, constellation)
       VALUES (1, $1, 1, $2, 90, 6, 0)`,
      ['10000089', docCanon],
    );

    const row = await pg.query<{ content_hash: Uint8Array | null }>(
      `SELECT content_hash FROM app.character_state WHERE char_key = $1`,
      ['10000089'],
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0]?.content_hash).not.toBeNull();
  });

  it('impõe o índice parcial character_timeline_one_open (no máximo um intervalo aberto)', async () => {
    const pg = new PGlite();
    const sql = await loadMigrationSql();
    await pg.exec(sql);

    await pg.query(
      `INSERT INTO app.account (owner_id, game_uid, region, active_doc_schema) VALUES ($1, $2, $3, $4)`,
      ['owner-1', 'uid-1', 'os_usa', 1],
    );
    await pg.query(`INSERT INTO catalog.character (char_key, avatar_id, slug) VALUES ($1, $2, $3)`, [
      '10000089',
      10000089,
      'hu-tao',
    ]);
    await pg.query(
      `INSERT INTO app.snapshot (account_id, taken_at, parser_version, doc_schema, lang, account_hash, observed_chars)
       VALUES (1, now(), 1, 1, 'pt-pt', $1, 1)`,
      [Buffer.from('h')],
    );
    const docCanon = Buffer.from('{"v":1}', 'utf8');
    await pg.query(
      `INSERT INTO app.character_state
         (account_id, char_key, doc_schema, doc_canon, char_level, ascension, constellation)
       VALUES (1, $1, 1, $2, 90, 6, 0)`,
      ['10000089', docCanon],
    );
    const state = await pg.query<{ state_id: string }>(
      `SELECT state_id FROM app.character_state WHERE char_key = $1`,
      ['10000089'],
    );
    const stateId = state.rows[0]!.state_id;

    await pg.query(
      `INSERT INTO app.character_timeline
         (account_id, char_key, doc_schema, valid_from, valid_to, last_seen_at, state_id, from_snapshot)
       VALUES (1, $1, 1, now(), NULL, now(), $2, 1)`,
      ['10000089', stateId],
    );

    // A second open interval for the same (account_id, char_key, doc_schema)
    // must violate the partial unique index, not silently coexist.
    await expect(
      pg.query(
        `INSERT INTO app.character_timeline
           (account_id, char_key, doc_schema, valid_from, valid_to, last_seen_at, state_id, from_snapshot)
         VALUES (1, $1, 1, now(), NULL, now(), $2, 1)`,
        ['10000089', stateId],
      ),
    ).rejects.toThrow();
  });
});
