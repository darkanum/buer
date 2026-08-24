import { describe, expect, it } from 'vitest';
import { writeSnapshot } from '@buer/db';
import { PROTOCOL_VERSION } from '@buer/core';
import { handleIngest, inlinePutRaw, type IngestDeps } from '../app/api/ingest/handler.js';
import { makeIngestTestDb, type IngestTestDb } from './ingest-helpers.js';

// Two REAL characters known to @buer/gi-data's bundled data (Furina
// 10000089 + weapon 13509 "engulfing-lightning" + artifact set 15025
// "deepwood-memories"; Hu Tao 10000046 + weapon 13502 "skyward-spine" +
// artifact set 15009 "prayers-for-illumination") — same shape and values as
// packages/core/test/fixtures/detail.sample.json, so the sub-stat
// reconstruction in @buer/core's substat.ts (which only has a tier table
// for 5★ rolls) is exercised against values already known to resolve. Plus
// one character/weapon/artifact-set combo with ids that do NOT exist in
// gi-data's data, to exercise the provisional-catalog-upsert path.
const KNOWN_CHAR_1 = {
  base: { id: 10000089, element: 'Hydro', level: 90, promote_level: 6, actived_constellation_num: 0, fetter: 10 },
  weapon: { id: 13509, level: 90, promote_level: 6, affix_level: 1 },
  relics: [
    {
      pos: 1,
      set: { id: 15025 },
      level: 20,
      rarity: 5,
      main_property: { property_type: 5, value: '4780' },
      sub_property_list: [
        { property_type: 20, value: '3.1%', times: 1 },
        { property_type: 22, value: '14.8%', times: 2 },
        { property_type: 23, value: '4.5%', times: 1 },
      ],
    },
  ],
  skills: [{ skill_id: 10097, level_current: 10, skill_type: 1 }],
  constellations: [],
};
const KNOWN_CHAR_2 = {
  base: { id: 10000046, element: 'Pyro', level: 90, promote_level: 6, actived_constellation_num: 1, fetter: 10 },
  weapon: { id: 13502, level: 90, promote_level: 6, affix_level: 1 },
  relics: [
    {
      pos: 3,
      set: { id: 15009 },
      level: 20,
      rarity: 5,
      main_property: { property_type: 2, value: '311' },
      sub_property_list: [{ property_type: 22, value: '5.4%', times: 1 }],
    },
  ],
  skills: [{ skill_id: 10351, level_current: 8, skill_type: 1 }],
  constellations: [],
};
/** char_key/weapon_id/set_id here are NOT in @buer/gi-data's data —
 * exercises the `provisional: true` branch of upsertProvisionalCatalog. */
const PROVISIONAL_CHAR = {
  base: { id: 99999001, element: 'Anemo', level: 1, promote_level: 0, actived_constellation_num: 0, fetter: 1 },
  weapon: { id: 99001, level: 1, promote_level: 0, affix_level: 1 },
  relics: [
    { pos: 5, set: { id: 99101 }, level: 4, rarity: 5, main_property: { property_type: 28, value: '16.32' }, sub_property_list: [] },
  ],
  skills: [],
  constellations: [],
};

/** `property_type: 9999` is not in @buer/core's normalize.ts PROP subset
 * — a syntactically valid envelope whose raw content core's normalize()
 * cannot handle. Exercises the review-round-1 "400, not an uncaught 500"
 * boundary for untrusted `raw` content. */
const UNMAPPED_PROP_CHAR = {
  base: { id: 10000015, element: 'Cryo', level: 80, promote_level: 5, actived_constellation_num: 0, fetter: 10 },
  weapon: { id: 11301, level: 80, promote_level: 5, affix_level: 1 },
  relics: [
    {
      pos: 1,
      set: { id: 10001 },
      level: 20,
      rarity: 5,
      main_property: { property_type: 5, value: '4780' },
      sub_property_list: [{ property_type: 9999, value: '1%', times: 1 }],
    },
  ],
  skills: [],
  constellations: [],
};

const DETAIL = { list: [KNOWN_CHAR_1, KNOWN_CHAR_2, PROVISIONAL_CHAR] };
/** Same characters as DETAIL, but KNOWN_CHAR_1's level differs — a
 * different raw content hash (so a different idempotency_key) for use with
 * the SAME `takenAt` as DETAIL's envelope, to drive the
 * UNIQUE(account_id, taken_at) conflict test. */
const DETAIL_VARIANT = {
  list: [{ ...KNOWN_CHAR_1, base: { ...KNOWN_CHAR_1.base, level: 89 } }, KNOWN_CHAR_2, PROVISIONAL_CHAR],
};

function makeEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    cliVersion: '0.1.0-test',
    // Inside the only partition packages/db/drizzle/0000_init.sql declares
    // for app.raw_observation (2026-09-01..2026-10-01) — see task-8.2-report.md.
    takenAt: '2026-09-05T12:00:00.000Z',
    account: { gameUid: 'uid-1', region: 'os_usa', nickname: 'Traveler', lang: 'pt-pt' },
    raw: { list: {}, detail: DETAIL },
    ...overrides,
  };
}

function mkRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://x/api/ingest', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  });
}

interface TestCtx {
  deps: IngestDeps;
  testDb: IngestTestDb;
}

async function makeCtx(userId = 'user-1'): Promise<TestCtx> {
  const testDb = await makeIngestTestDb();
  const deps: IngestDeps = {
    verifyApiKey: async () => ({ userId }),
    db: testDb.db,
    writeSnapshot,
    putRaw: inlinePutRaw,
  };
  return { deps, testDb };
}

describe('POST /api/ingest (handleIngest)', () => {
  it('401 sem token / token inválido', async () => {
    const { deps } = await makeCtx();
    deps.verifyApiKey = async () => null;
    const res = await handleIngest(deps, mkRequest(makeEnvelope()));
    expect(res.status).toBe(401);
  });

  it('400 em envelope malformado (protocolVersion errado) com erro útil', async () => {
    const { deps } = await makeCtx();
    const res = await handleIngest(deps, mkRequest(makeEnvelope({ protocolVersion: 999 }), { 'x-api-key': 'buer_live_ok' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty('error');
  });

  it('400 em envelope malformado (raw ausente) com erro útil', async () => {
    const { deps } = await makeCtx();
    const { raw: _raw, ...withoutRaw } = makeEnvelope();
    const res = await handleIngest(deps, mkRequest(withoutRaw, { 'x-api-key': 'buer_live_ok' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty('error');
  });

  it('400 em corpo não-JSON, sem crashar', async () => {
    const { deps } = await makeCtx();
    const res = await handleIngest(deps, mkRequest('isto não é json', { 'x-api-key': 'buer_live_ok' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty('error');
  });

  it('deriva o dono da conta do token verificado, ignorando qualquer spoof no corpo', async () => {
    const { deps, testDb } = await makeCtx('real-user');
    const base = makeEnvelope();
    const spoofed = {
      ...base,
      userId: 'attacker',
      account: { ...base.account, ownerId: 'attacker' },
    };
    const res = await handleIngest(deps, mkRequest(spoofed, { 'x-api-key': 'buer_live_ok' }));
    expect(res.status).toBe(200);

    const rows = await testDb.pglite.query<{ owner_id: string }>('SELECT owner_id FROM app.account');
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.owner_id).toBe('real-user');
  });

  it('rejeita ingest de outro usuário na mesma conta (game_uid+region já reivindicada)', async () => {
    const { deps, testDb } = await makeCtx('user-a');
    const first = await handleIngest(deps, mkRequest(makeEnvelope(), { 'x-api-key': 'buer_live_ok' }));
    expect(first.status).toBe(200);

    const depsOtherUser: IngestDeps = { ...deps, verifyApiKey: async () => ({ userId: 'user-b' }) };
    const second = await handleIngest(
      depsOtherUser,
      mkRequest(makeEnvelope({ takenAt: '2026-09-06T00:00:00.000Z' }), { 'x-api-key': 'buer_live_ok' }),
    );
    expect(second.status).toBe(403);

    const rows = await testDb.pglite.query<{ n: number }>('SELECT count(*)::int AS n FROM app.account');
    expect(rows.rows[0]?.n).toBe(1);
  });

  it('happy path: cria o snapshot e as linhas provisórias de catálogo', async () => {
    const { deps, testDb } = await makeCtx();
    const res = await handleIngest(deps, mkRequest(makeEnvelope(), { 'x-api-key': 'buer_live_ok' }));
    expect(res.status).toBe(200);

    const json = (await res.json()) as { snapshotId: string; changedChars: number; deduped: boolean };
    expect(typeof json.snapshotId).toBe('string');
    expect(json.changedChars).toBe(3);
    expect(json.deduped).toBe(false);

    const snapshotRows = await testDb.pglite.query<{ n: number }>('SELECT count(*)::int AS n FROM app.snapshot');
    expect(snapshotRows.rows[0]?.n).toBe(1);

    const known = await testDb.pglite.query<{ provisional: boolean; slug: string; rarity: number }>(
      "SELECT provisional, slug, rarity FROM catalog.character WHERE char_key = '10000089'",
    );
    expect(known.rows[0]).toMatchObject({ provisional: false, slug: 'furina', rarity: 5 });

    const provisionalChar = await testDb.pglite.query<{ provisional: boolean }>(
      "SELECT provisional FROM catalog.character WHERE char_key = '99999001'",
    );
    expect(provisionalChar.rows).toHaveLength(1);
    expect(provisionalChar.rows[0]?.provisional).toBe(true);

    const provisionalWeapon = await testDb.pglite.query<{ provisional_slug: string }>(
      "SELECT slug AS provisional_slug FROM catalog.weapon WHERE weapon_id = 99001",
    );
    expect(provisionalWeapon.rows[0]?.provisional_slug).toBe('provisional-weapon-99001');

    const provisionalSet = await testDb.pglite.query('SELECT 1 FROM catalog.artifact_set WHERE set_id = 99101');
    expect(provisionalSet.rows).toHaveLength(1);
  });

  it('dedupe: o mesmo payload postado 2x não cria um 2º snapshot', async () => {
    const { deps, testDb } = await makeCtx();

    const res1 = await handleIngest(deps, mkRequest(makeEnvelope(), { 'x-api-key': 'buer_live_ok' }));
    expect(res1.status).toBe(200);
    const json1 = (await res1.json()) as { snapshotId: string; deduped: boolean };
    expect(json1.deduped).toBe(false);

    const res2 = await handleIngest(deps, mkRequest(makeEnvelope(), { 'x-api-key': 'buer_live_ok' }));
    expect(res2.status).toBe(200);
    const json2 = (await res2.json()) as { snapshotId: string; deduped: boolean; changedChars: number };
    expect(json2.deduped).toBe(true);
    expect(json2.snapshotId).toBe(json1.snapshotId);
    expect(json2.changedChars).toBe(0);

    const rows = await testDb.pglite.query<{ n: number }>('SELECT count(*)::int AS n FROM app.snapshot');
    expect(rows.rows[0]?.n).toBe(1);
  });

  it('400 (não 500) quando raw contém um property_type não mapeado por normalize()', async () => {
    const { deps, testDb } = await makeCtx();
    const badDetail = { list: [UNMAPPED_PROP_CHAR] };
    const res = await handleIngest(
      deps,
      mkRequest(makeEnvelope({ raw: { list: {}, detail: badDetail } }), { 'x-api-key': 'buer_live_ok' }),
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: unknown };
    expect(json).toHaveProperty('error');
    // Non-leaking: the message is core's own short diagnostic, never a dump
    // of the raw payload it failed on.
    expect(String(json.error)).not.toContain('sub_property_list');
    expect(String(json.error).length).toBeLessThan(200);

    const rows = await testDb.pglite.query<{ n: number }>('SELECT count(*)::int AS n FROM app.snapshot');
    expect(rows.rows[0]?.n).toBe(0);
  });

  it('409 quando o mesmo taken_at é reusado com conteúdo diferente (conflito de UNIQUE(account_id, taken_at))', async () => {
    const { deps, testDb } = await makeCtx();

    const first = await handleIngest(deps, mkRequest(makeEnvelope(), { 'x-api-key': 'buer_live_ok' }));
    expect(first.status).toBe(200);

    const second = await handleIngest(
      deps,
      mkRequest(makeEnvelope({ raw: { list: {}, detail: DETAIL_VARIANT } }), { 'x-api-key': 'buer_live_ok' }),
    );
    expect(second.status).toBe(409);
    expect(await second.json()).toHaveProperty('error');

    const rows = await testDb.pglite.query<{ n: number }>('SELECT count(*)::int AS n FROM app.snapshot');
    expect(rows.rows[0]?.n).toBe(1);
  });

  it('reingest da mesma conta (mesmo dono) atualiza nickname/lang em app.account', async () => {
    const { deps, testDb } = await makeCtx('user-1');

    const first = await handleIngest(deps, mkRequest(makeEnvelope(), { 'x-api-key': 'buer_live_ok' }));
    expect(first.status).toBe(200);

    const second = await handleIngest(
      deps,
      mkRequest(
        makeEnvelope({
          takenAt: '2026-09-06T00:00:00.000Z',
          account: { gameUid: 'uid-1', region: 'os_usa', nickname: 'Novo Nick', lang: 'pt-pt' },
        }),
        { 'x-api-key': 'buer_live_ok' },
      ),
    );
    expect(second.status).toBe(200);

    const rows = await testDb.pglite.query<{ n: number; nickname: string; owner_id: string }>(
      'SELECT count(*)::int AS n FROM app.account',
    );
    expect(rows.rows[0]?.n).toBe(1);

    const account = await testDb.pglite.query<{ nickname: string; owner_id: string }>(
      "SELECT nickname, owner_id FROM app.account WHERE game_uid = 'uid-1' AND region = 'os_usa'",
    );
    expect(account.rows[0]?.nickname).toBe('Novo Nick');
    expect(account.rows[0]?.owner_id).toBe('user-1');
  });
});
