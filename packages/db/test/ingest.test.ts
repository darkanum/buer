import { sql } from 'drizzle-orm';
import { accountHash, contentHash, type CharacterDoc, type NormalizedSnapshot } from '@onewash/core';
import { describe, expect, it } from 'vitest';
import type { Database } from '../src/client.js';
import { writeSnapshot, type IngestDb } from '../src/ingest.js';
import { makeTestDb } from './helpers.js';

// Type-level guard (checked by `tsc`, never called at runtime): `IngestDb` is
// deliberately `PgDatabase<any, typeof schema>` — with `any` for the "query
// result HKT" generic — precisely so BOTH the production node-postgres
// `Database` (src/client.ts) AND the PGlite instance built by
// `test/helpers.ts` satisfy `writeSnapshot`'s `db` parameter. This function is
// never invoked; if `IngestDb` is ever narrowed to a driver-specific shape
// (e.g. accidentally pinned to PGlite's query-result type), passing a real
// `Database` here stops type-checking and `tsc` catches it.
function _typeCheckOnly_productionDatabaseSatisfiesIngestDb(db: Database): void {
  const _asIngestDb: IngestDb = db;
  void _asIngestDb;
}
void _typeCheckOnly_productionDatabaseSatisfiesIngestDb;

/**
 * Minimal valid CharacterDoc (matches the shape @onewash/core's canon.ts
 * expects — v1, sans stats derivados). `overrides` lets tests drive a
 * "change" by editing a real doc field (e.g. `lvl`), never by hand-editing a
 * hash string: since `content_hash` is `sha256(doc_canon)` computed BY
 * POSTGRES from the bytes we insert, only an actual doc difference produces a
 * different hash.
 */
function makeDoc(overrides: Partial<CharacterDoc> = {}): CharacterDoc {
  return {
    v: 1,
    char: '10000089',
    lvl: 90,
    asc: 6,
    cons: 2,
    friend: 10,
    weapon: { id: 13509, lvl: 90, promote: 6, refine: 1 },
    talents: [[10097, 10]],
    artifacts: [],
    ...overrides,
  };
}

/** Builds a NormalizedSnapshot the same way @onewash/core's normalize() would: contentHash/accountHash computed from the real doc, not asserted by hand. */
function normalizedFor(doc: CharacterDoc): NormalizedSnapshot {
  const characters = [
    {
      charKey: doc.char,
      doc,
      contentHash: contentHash(doc),
      promoted: {
        charLevel: doc.lvl,
        ascension: doc.asc,
        constellation: doc.cons,
        weaponId: doc.weapon.id,
        weaponRefine: doc.weapon.refine,
      },
    },
  ];
  return {
    characters,
    accountHash: accountHash(characters.map((c) => ({ charKey: c.charKey, contentHash: c.contentHash }))),
  };
}

/** catalog.{character,weapon} rows required by character_state's FKs. */
async function seedCatalog(db: IngestDb): Promise<void> {
  await db.execute(sql`INSERT INTO catalog.character (char_key, avatar_id, slug) VALUES ('10000089', 10000089, 'hu-tao')`);
  await db.execute(sql`INSERT INTO catalog.weapon (weapon_id, slug, promote_len) VALUES (13509, 'staff-of-homa', 5)`);
}

async function countRows(db: IngestDb, query: ReturnType<typeof sql>): Promise<number> {
  const res = (await db.execute(query)) as { rows: { n: number }[] };
  return Number(res.rows[0]?.n ?? 0);
}

describe('writeSnapshot', () => {
  it('roda o mesmo payload normalizado 2x (takenAt diferente) sem criar estado duplicado — dedupe', async () => {
    const { db, accountId } = await makeTestDb();
    await seedCatalog(db);
    const normalized = normalizedFor(makeDoc());

    const a = await writeSnapshot(db, {
      accountId,
      takenAt: new Date('2026-08-24T00:00:00Z'),
      parserVersion: 1,
      docSchema: 1,
      lang: 'pt-pt',
      normalized,
    });
    // Primeira observação de um personagem novo conta como "changed" (novo-ou-mudado).
    expect(a.changedChars).toBe(1);
    expect(a.deduped).toBe(false);

    const b = await writeSnapshot(db, {
      accountId,
      takenAt: new Date('2026-08-31T00:00:00Z'),
      parserVersion: 1,
      docSchema: 1,
      lang: 'pt-pt',
      normalized,
    });

    expect(b.changedChars).toBe(0);
    expect(b.deduped).toBe(true);
    expect(b.snapshotId).not.toBe(a.snapshotId);

    // O CRUX do teste: mesmo doc_canon -> mesmo content_hash GERADO pelo Postgres
    // -> ON CONFLICT DO NOTHING colide -> nenhuma linha nova em character_state.
    expect(await countRows(db, sql`SELECT count(*)::int n FROM app.character_state`)).toBe(1);

    // Só um intervalo aberto para o personagem, com last_seen_at atualizado pela 2ª rodada.
    expect(await countRows(db, sql`SELECT count(*)::int n FROM app.character_timeline WHERE valid_to IS NULL`)).toBe(1);
    const openRes = (await db.execute(
      sql`SELECT last_seen_at FROM app.character_timeline WHERE valid_to IS NULL`,
    )) as { rows: { last_seen_at: string | Date }[] };
    const lastSeenAt = new Date(openRes.rows[0]!.last_seen_at);
    expect(lastSeenAt.toISOString()).toBe(new Date('2026-08-31T00:00:00Z').toISOString());

    // Nenhum change_event: nada mudou.
    expect(await countRows(db, sql`SELECT count(*)::int n FROM app.change_event`)).toBe(0);
  });

  it('detecta mudança quando um campo do doc muda (lvl 90 -> 89) e mantém a timeline consistente', async () => {
    const { db, accountId } = await makeTestDb();
    await seedCatalog(db);

    const docBefore = makeDoc({ lvl: 90 });
    const first = await writeSnapshot(db, {
      accountId,
      takenAt: new Date('2026-08-24T00:00:00Z'),
      parserVersion: 1,
      docSchema: 1,
      lang: 'pt-pt',
      normalized: normalizedFor(docBefore),
    });
    expect(first.changedChars).toBe(1);

    // Muda um campo REAL do doc — não uma hash escrita à mão. contentHash(doc)
    // muda porque canonBytes(doc) muda, e é isso que também muda
    // sha256(doc_canon) computado pelo Postgres.
    const docAfter = makeDoc({ lvl: 89 });
    expect(contentHash(docAfter)).not.toBe(contentHash(docBefore));

    const second = await writeSnapshot(db, {
      accountId,
      takenAt: new Date('2026-08-31T00:00:00Z'),
      parserVersion: 1,
      docSchema: 1,
      lang: 'pt-pt',
      normalized: normalizedFor(docAfter),
    });

    expect(second.changedChars).toBe(1);
    expect(second.deduped).toBe(false);

    // Dois estados distintos content-addressed (um por doc_canon diferente).
    expect(await countRows(db, sql`SELECT count(*)::int n FROM app.character_state`)).toBe(2);

    // O intervalo antigo fechou por 'change'...
    expect(
      await countRows(
        db,
        sql`SELECT count(*)::int n FROM app.character_timeline WHERE valid_to IS NOT NULL AND closed_by = 'change'`,
      ),
    ).toBe(1);
    // ...e existe exatamente um intervalo aberto (o novo).
    const openRes = (await db.execute(
      sql`SELECT state_id FROM app.character_timeline WHERE account_id = ${accountId.toString()}::bigint AND char_key = '10000089' AND valid_to IS NULL`,
    )) as { rows: { state_id: string }[] };
    expect(openRes.rows).toHaveLength(1);

    // change_event foi emitido, referenciando o snapshot que detectou a mudança.
    expect(
      await countRows(
        db,
        sql`SELECT count(*)::int n FROM app.change_event WHERE detected_in = ${second.snapshotId.toString()}::bigint`,
      ),
    ).toBe(1);
  });

  it('idempotency_key repetida devolve o snapshot existente sem duplicar (dedupe no nível de snapshot)', async () => {
    const { db, accountId } = await makeTestDb();
    await seedCatalog(db);
    const normalized = normalizedFor(makeDoc());

    const a = await writeSnapshot(db, {
      accountId,
      takenAt: new Date('2026-08-24T00:00:00Z'),
      parserVersion: 1,
      docSchema: 1,
      lang: 'pt-pt',
      normalized,
      idempotencyKey: 'run-1',
    });

    const b = await writeSnapshot(db, {
      accountId,
      // takenAt diferente de propósito — a idempotency_key é o que deve dominar,
      // não a UNIQUE (account_id, taken_at).
      takenAt: new Date('2026-09-07T00:00:00Z'),
      parserVersion: 1,
      docSchema: 1,
      lang: 'pt-pt',
      normalized,
      idempotencyKey: 'run-1',
    });

    expect(b.snapshotId).toBe(a.snapshotId);
    expect(b.deduped).toBe(true);
    expect(await countRows(db, sql`SELECT count(*)::int n FROM app.snapshot`)).toBe(1);
  });
});
