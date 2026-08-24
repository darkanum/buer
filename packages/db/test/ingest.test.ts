import { sql } from 'drizzle-orm';
import { accountHash, contentHash, type CharacterDoc, type NormalizedSnapshot } from '@buer/core';
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
 * Minimal valid CharacterDoc (matches the shape @buer/core's canon.ts
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

/**
 * Builds a NormalizedSnapshot the same way @buer/core's normalize() would
 * for MULTIPLE characters: contentHash per character + accountHash over the
 * whole set, both computed from the real docs, never asserted by hand. This
 * is what a realistic production snapshot looks like — one writeSnapshot()
 * call, several characters processed by the same per-character loop.
 */
function normalizedForMany(docs: CharacterDoc[]): NormalizedSnapshot {
  const characters = docs.map((doc) => ({
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
  }));
  return {
    characters,
    accountHash: accountHash(characters.map((c) => ({ charKey: c.charKey, contentHash: c.contentHash }))),
  };
}

/** Single-character convenience wrapper around normalizedForMany. */
function normalizedFor(doc: CharacterDoc): NormalizedSnapshot {
  return normalizedForMany([doc]);
}

/** catalog.{character,weapon} rows required by character_state's FKs. */
async function seedCatalog(db: IngestDb): Promise<void> {
  await db.execute(sql`INSERT INTO catalog.character (char_key, avatar_id, slug) VALUES ('10000089', 10000089, 'hu-tao')`);
  await db.execute(sql`INSERT INTO catalog.weapon (weapon_id, slug, promote_len) VALUES (13509, 'staff-of-homa', 5)`);
}

/** Seeds one extra catalog.character row (e.g. for multi-character tests that need more than the default '10000089'). */
async function seedCharacter(db: IngestDb, charKey: string, avatarId: number, slug: string): Promise<void> {
  await db.execute(
    sql`INSERT INTO catalog.character (char_key, avatar_id, slug) VALUES (${charKey}, ${avatarId}, ${slug})`,
  );
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

  it('processa 3 personagens na mesma transação sem misturar estado entre iterações (A inalterado, B mudou, C novo)', async () => {
    const { db, accountId } = await makeTestDb();
    await seedCatalog(db);
    await seedCharacter(db, '11000001', 11000001, 'char-a');
    await seedCharacter(db, '11000002', 11000002, 'char-b');
    await seedCharacter(db, '11000003', 11000003, 'char-c');

    // Run 1: só A e B existem ainda (C é "novo" só na run 2).
    const docA = makeDoc({ char: '11000001', lvl: 80 });
    const docB1 = makeDoc({ char: '11000002', lvl: 90 });
    const run1 = await writeSnapshot(db, {
      accountId,
      takenAt: new Date('2026-08-24T00:00:00Z'),
      parserVersion: 1,
      docSchema: 1,
      lang: 'pt-pt',
      normalized: normalizedForMany([docA, docB1]),
    });
    expect(run1.changedChars).toBe(2); // ambos observados pela 1ª vez

    // Run 2, UMA transação, TRÊS personagens no mesmo loop:
    //  - A: doc idêntico (docA reaproveitado) -> inalterado
    //  - B: doc mudou (lvl 90 -> 89) -> muda de estado
    //  - C: nunca visto por essa conta -> novo
    const docB2 = makeDoc({ char: '11000002', lvl: 89 });
    const docC = makeDoc({ char: '11000003', lvl: 1 });
    const run2 = await writeSnapshot(db, {
      accountId,
      takenAt: new Date('2026-08-31T00:00:00Z'),
      parserVersion: 1,
      docSchema: 1,
      lang: 'pt-pt',
      normalized: normalizedForMany([docA, docB2, docC]),
    });

    // changedChars conta só B (mudou) e C (novo) — A não conta.
    expect(run2.changedChars).toBe(2);
    expect(run2.deduped).toBe(false);

    // character_state: A tem 1 linha (dedupe), B tem 2 (lvl 90 e lvl 89), C tem 1 -> 4 no total.
    // Isso prova que os locals por-iteração (docCanon/stateId/openRow etc.) não vazam entre
    // personagens: se vazassem, ou A ganharia uma 2ª linha por engano, ou B/C perderiam a sua.
    expect(await countRows(db, sql`SELECT count(*)::int n FROM app.character_state`)).toBe(4);

    // Exatamente um intervalo aberto por personagem -> 3 linhas abertas no total.
    expect(await countRows(db, sql`SELECT count(*)::int n FROM app.character_timeline WHERE valid_to IS NULL`)).toBe(3);

    // O intervalo antigo de B (e só o de B) fechou por 'change'.
    expect(
      await countRows(
        db,
        sql`SELECT count(*)::int n FROM app.character_timeline WHERE valid_to IS NOT NULL AND closed_by = 'change'`,
      ),
    ).toBe(1);
    expect(
      await countRows(
        db,
        sql`SELECT count(*)::int n FROM app.character_timeline WHERE char_key = '11000002' AND valid_to IS NOT NULL AND closed_by = 'change'`,
      ),
    ).toBe(1);

    // A ainda tem seu único intervalo aberto, com last_seen_at avançado pela run2 (não um novo estado).
    const aOpen = (await db.execute(
      sql`SELECT last_seen_at FROM app.character_timeline WHERE char_key = '11000001' AND valid_to IS NULL`,
    )) as { rows: { last_seen_at: string | Date }[] };
    expect(aOpen.rows).toHaveLength(1);
    expect(new Date(aOpen.rows[0]!.last_seen_at).toISOString()).toBe(new Date('2026-08-31T00:00:00Z').toISOString());

    // change_event: só B dispara um (o caminho de personagem NOVO — C — não emite change_event
    // na implementação atual; só o caminho de MUDANÇA emite). Consistente com ingest.ts.
    expect(
      await countRows(
        db,
        sql`SELECT count(*)::int n FROM app.change_event WHERE detected_in = ${run2.snapshotId.toString()}::bigint`,
      ),
    ).toBe(1);
    expect(await countRows(db, sql`SELECT count(*)::int n FROM app.change_event WHERE char_key = '11000002'`)).toBe(1);
    expect(await countRows(db, sql`SELECT count(*)::int n FROM app.change_event WHERE char_key = '11000003'`)).toBe(0);
    expect(await countRows(db, sql`SELECT count(*)::int n FROM app.change_event WHERE char_key = '11000001'`)).toBe(0);
  });

  it('reverte a transação inteira quando um personagem no meio do array viola uma FK de catálogo (atomicidade)', async () => {
    const { db, accountId } = await makeTestDb();
    await seedCatalog(db); // só '10000089' está cadastrado em catalog.character

    // Personagem VÁLIDO primeiro (seedado) — deve ser processado com sucesso pelo loop antes
    // do que falha. Personagem INVÁLIDO depois — char_key nunca inserido em catalog.character,
    // então o INSERT em character_state viola a FK character_state_char_key_fkey e lança.
    const validDoc = makeDoc({ char: '10000089', lvl: 90 });
    const invalidDoc = makeDoc({ char: '99999999', lvl: 1 });
    const normalized = normalizedForMany([validDoc, invalidDoc]);

    await expect(
      writeSnapshot(db, {
        accountId,
        takenAt: new Date('2026-08-24T00:00:00Z'),
        parserVersion: 1,
        docSchema: 1,
        lang: 'pt-pt',
        normalized,
      }),
    ).rejects.toThrow();

    // Nada foi comitado: nem o snapshot (inserido ANTES do loop de personagens), nem o
    // character_state do personagem válido (processado ANTES do que falhou), nem timeline,
    // nem change_event — a transação inteira reverteu.
    expect(await countRows(db, sql`SELECT count(*)::int n FROM app.snapshot`)).toBe(0);
    expect(await countRows(db, sql`SELECT count(*)::int n FROM app.character_state`)).toBe(0);
    expect(await countRows(db, sql`SELECT count(*)::int n FROM app.character_timeline`)).toBe(0);
    expect(await countRows(db, sql`SELECT count(*)::int n FROM app.change_event`)).toBe(0);
  });
});
