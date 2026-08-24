import { describe, expect, it } from 'vitest';
import { accountHash, artifactFingerprint, contentHash, type CanonArtifact, type CharacterDoc, type NormalizedSnapshot } from '@onewash/core';
import { schema, writeSnapshot, type IngestDb } from '@onewash/db';
import { diffSnapshots, getAccountView, getCharacter, type DiffableCharacter } from '../lib/render.js';
import { makeIngestTestDb } from './ingest-helpers.js';

// ---------------------------------------------------------------------------
// Shared fixtures — REAL CharacterDoc-shaped data (short fake ids/values),
// never a hand-typed `fp` string: `artifactFingerprint` computes it from the
// same set/slot/main/subs fields the real parser would produce, exactly like
// packages/db/test/ingest.test.ts's `makeDoc` builds real docs instead of
// asserting against a hand-written hash.
// ---------------------------------------------------------------------------

function makeArtifact(overrides: Partial<Omit<CanonArtifact, 'fp'>> = {}): CanonArtifact {
  const base = {
    slot: 1 as const,
    set: 15025,
    lvl: 16,
    rarity: 5 as const,
    main: [2, 4780] as [number, number],
    subs: [
      [20, 3.9, 1],
      [22, 7.8, 2],
    ] as [number, number, 1 | 2 | 3 | 4][],
    ...overrides,
  };
  return { ...base, fp: artifactFingerprint(base) };
}

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
    artifacts: [makeArtifact()],
    ...overrides,
  };
}

function asDiffable(charKey: string, doc: CharacterDoc): DiffableCharacter {
  return { charKey, doc };
}

describe('diffSnapshots (pure)', () => {
  it('mesmo fp, level maior -> artifact_upgrade', () => {
    const before = makeDoc();
    const after = makeDoc({ artifacts: [makeArtifact({ lvl: 20 })] });
    expect(after.artifacts[0]!.fp).toBe(before.artifacts[0]!.fp); // mesma peça

    const changes = diffSnapshots([asDiffable('10000089', before)], [asDiffable('10000089', after)]);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({ charKey: '10000089', kind: 'artifact_upgrade', key: 1, before: 16, after: 20 });
  });

  it('fp diferente -> artifact_swap (mesmo slot, peça física diferente)', () => {
    const before = makeDoc();
    const after = makeDoc({
      artifacts: [makeArtifact({ set: 15009, main: [30, 46.6], subs: [[23, 5.2, 1]] })],
    });
    expect(after.artifacts[0]!.fp).not.toBe(before.artifacts[0]!.fp);

    const changes = diffSnapshots([asDiffable('10000089', before)], [asDiffable('10000089', after)]);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.kind).toBe('artifact_swap');
    expect(changes[0]!.key).toBe(1);
  });

  it('detecta level_up', () => {
    const before = makeDoc({ lvl: 89 });
    const after = makeDoc({ lvl: 90 });
    const changes = diffSnapshots([asDiffable('10000089', before)], [asDiffable('10000089', after)]);
    expect(changes).toEqual([{ charKey: '10000089', kind: 'level_up', before: 89, after: 90 }]);
  });

  it('detecta weapon_change', () => {
    const before = makeDoc({ weapon: { id: 13509, lvl: 90, promote: 6, refine: 1 } });
    const after = makeDoc({ weapon: { id: 13502, lvl: 90, promote: 6, refine: 1 } });
    const changes = diffSnapshots([asDiffable('10000089', before)], [asDiffable('10000089', after)]);
    expect(changes).toEqual([{ charKey: '10000089', kind: 'weapon_change', before: 13509, after: 13502 }]);
  });

  it('detecta constellation e talent_up simultaneamente', () => {
    const before = makeDoc({ cons: 1, talents: [[10097, 9]] });
    const after = makeDoc({ cons: 2, talents: [[10097, 10]] });
    const changes = diffSnapshots([asDiffable('10000089', before)], [asDiffable('10000089', after)]);
    expect(changes).toContainEqual({ charKey: '10000089', kind: 'constellation', before: 1, after: 2 });
    expect(changes).toContainEqual({ charKey: '10000089', kind: 'talent_up', key: 10097, before: 9, after: 10 });
  });

  it('personagem novo (presente em after, ausente em before) -> character_new, sem outros campos', () => {
    const after = makeDoc({ char: '10000046' });
    const changes = diffSnapshots([], [asDiffable('10000046', after)]);
    expect(changes).toEqual([{ charKey: '10000046', kind: 'character_new' }]);
  });

  it('nada muda -> nenhuma mudança reportada', () => {
    const doc = makeDoc();
    const changes = diffSnapshots([asDiffable('10000089', doc)], [asDiffable('10000089', doc)]);
    expect(changes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getAccountView / getCharacter — real PGlite db, migrated with @onewash/db's
// own migration (packages/db/drizzle/0000_init.sql via makeIngestTestDb,
// already built for Task 8.2's ingest tests), seeded via the REAL
// writeSnapshot() — not hand-inserted rows — so the read layer is exercised
// against exactly what production writes.
// ---------------------------------------------------------------------------

/** catalog.{character,weapon,artifact_set} rows required by
 * character_state's FKs (writeSnapshot doesn't upsert these itself — that's
 * app/api/ingest/route.ts's job — so tests seed them directly, same pattern
 * as packages/db/test/ingest.test.ts's seedCatalog). */
async function seedCatalog(db: IngestDb): Promise<void> {
  await db.insert(schema.character).values([
    { charKey: '10000089', avatarId: 10000089, slug: 'furina', rarity: 5 },
    { charKey: '10000046', avatarId: 10000046, slug: 'hu-tao', rarity: 5 },
  ]);
  await db.insert(schema.weapon).values([
    { weaponId: 13509, slug: 'staff-of-homa', promoteLen: 5 },
    { weaponId: 13502, slug: 'primordial-jade-winged-spear', promoteLen: 5 },
  ]);
  await db.insert(schema.artifactSet).values([{ setId: 15025, slug: 'marechaussee-hunter', maxRarity: 5, twopcNumeric: true }]);
}

async function seedAccount(db: IngestDb): Promise<bigint> {
  const rows = await db
    .insert(schema.account)
    .values({ ownerId: 'owner-render-test', gameUid: 'uid-render-test', region: 'os_usa', activeDocSchema: 1 })
    .returning();
  return rows[0]!.accountId;
}

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

describe('getAccountView / getCharacter (PGlite)', () => {
  it('getAccountView devolve o roster atual (aberto na timeline) com o doc parseado', async () => {
    const { db } = await makeIngestTestDb();
    await seedCatalog(db);
    const accountId = await seedAccount(db);

    const furina = makeDoc({ char: '10000089' });
    const huTao = makeDoc({
      char: '10000046',
      weapon: { id: 13502, lvl: 90, promote: 6, refine: 1 },
      artifacts: [],
    });

    await writeSnapshot(db, {
      accountId,
      takenAt: new Date('2026-09-05T00:00:00Z'),
      parserVersion: 1,
      docSchema: 1,
      lang: 'pt-pt',
      normalized: normalizedForMany([furina, huTao]),
    });

    const roster = await getAccountView(db, accountId);
    expect(roster).toHaveLength(2);

    const byKey = new Map(roster.map((r) => [r.charKey, r]));
    const furinaRow = byKey.get('10000089');
    expect(furinaRow).toBeDefined();
    expect(furinaRow!.promoted).toEqual({ charLevel: 90, ascension: 6, constellation: 2, weaponId: 13509 });
    expect(furinaRow!.doc).toEqual(furina);

    const huTaoRow = byKey.get('10000046');
    expect(huTaoRow).toBeDefined();
    expect(huTaoRow!.doc.weapon.id).toBe(13502);
    expect(huTaoRow!.doc.artifacts).toEqual([]);
  });

  it('getCharacter devolve só o personagem pedido, com o doc completo (constelação, arma, artefatos)', async () => {
    const { db } = await makeIngestTestDb();
    await seedCatalog(db);
    const accountId = await seedAccount(db);

    const doc = makeDoc();
    await writeSnapshot(db, {
      accountId,
      takenAt: new Date('2026-09-05T00:00:00Z'),
      parserVersion: 1,
      docSchema: 1,
      lang: 'pt-pt',
      normalized: normalizedForMany([doc]),
    });

    const character = await getCharacter(db, accountId, '10000089');
    expect(character).not.toBeNull();
    expect(character!.doc).toEqual(doc);
    expect(character!.doc.artifacts[0]!.fp).toBe(doc.artifacts[0]!.fp);

    expect(await getCharacter(db, accountId, '99999999')).toBeNull();
  });

  it('getAccountView reflete a MUDANÇA MAIS RECENTE (intervalo aberto), não o histórico', async () => {
    const { db } = await makeIngestTestDb();
    await seedCatalog(db);
    const accountId = await seedAccount(db);

    await writeSnapshot(db, {
      accountId,
      takenAt: new Date('2026-09-05T00:00:00Z'),
      parserVersion: 1,
      docSchema: 1,
      lang: 'pt-pt',
      normalized: normalizedForMany([makeDoc({ lvl: 89 })]),
    });
    await writeSnapshot(db, {
      accountId,
      takenAt: new Date('2026-09-06T00:00:00Z'),
      parserVersion: 1,
      docSchema: 1,
      lang: 'pt-pt',
      normalized: normalizedForMany([makeDoc({ lvl: 90 })]),
    });

    const roster = await getAccountView(db, accountId);
    expect(roster).toHaveLength(1);
    expect(roster[0]!.doc.lvl).toBe(90);
    expect(roster[0]!.promoted.charLevel).toBe(90);
  });
});
