import { describe, it, expect, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSync } from '../src/commands/sync.js';

const deps = {
  getSession: async () => ({ ltoken_v2: 'x', ltuid_v2: '1' }),
  makeClient: () => ({ fetchAll: async () => ({
    list: { list: [] }, detail: { list: [] },
    account: { gameUid: '8', region: 'os_asia', nickname: 'T' } }) }),
  postIngest: vi.fn(async () => ({ changedChars: 3 })),
  readConfig: () => ({ apiToken: 'buer_live_x', apiBaseUrl: 'http://x' }),
};

describe('runSync', () => {
  it('envia o envelope e resume as mudanças', async () => {
    const r = await runSync(deps as any, {});
    expect(deps.postIngest).toHaveBeenCalledOnce();
    expect(r.changed).toBe(3);
    expect(r.sent).toBe(true);
  });
  it('--dry-run não envia', async () => {
    const p = vi.fn();
    await runSync({ ...deps, postIngest: p } as any, { dryRun: true });
    expect(p).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// --raw-out: dump cru resiliente a normalize()
// ---------------------------------------------------------------------------

/**
 * Um "personagem" no formato bruto real da HoYoLAB, com um único substat
 * cujo `property_type` é o parâmetro — controla se o `normalize()` real
 * (importado de @buer/core, nunca mockado aqui) aceita (mapeado no esquema
 * FightProp via @buer/gi-data, ex.: 20 = critRate_) ou lança (ex.: 9999,
 * genuinely desconhecido — nenhum id real do jogo cai fora do mapa hoje).
 */
function detailEntry(subPropertyType: number) {
  return {
    base: {
      id: 10000042,
      level: 80,
      element: 'Pyro',
      promote_level: 6,
      actived_constellation_num: 1,
      fetter: 10,
    },
    weapon: { id: 11509, level: 80, promote_level: 6, affix_level: 1 },
    skills: [{ skill_id: 10421, skill_type: 1, level_current: 8 }],
    relics: [
      {
        pos: 1,
        set: { id: 15001 },
        level: 20,
        rarity: 5,
        main_property: { property_type: 2, value: '46.6' },
        sub_property_list: [{ property_type: subPropertyType, value: '3.89', times: 1 }],
      },
    ],
  };
}

function rawFixture(subPropertyType: number) {
  return {
    list: { list: [] },
    detail: { list: [detailEntry(subPropertyType)] },
    account: { gameUid: '800000123', region: 'os_asia', nickname: 'ContaReal' },
  };
}

function tmpFile(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'buer-sync-'));
  return join(dir, name);
}

describe('runSync --raw-out', () => {
  it('feliz: normalize (real) aceita o payload — raw é salvo e normalized=true', async () => {
    const rawOut = tmpFile('raw-ok.json');
    const okDeps = {
      getSession: async () => ({ ltoken_v2: 'x', ltuid_v2: '1' }),
      makeClient: () => ({ fetchAll: async () => rawFixture(20) }), // 20 = critRate_, mapeado em normalize.ts
      postIngest: vi.fn(async () => ({ changedChars: 1 })),
      readConfig: () => ({ apiToken: 'buer_live_x', apiBaseUrl: 'http://x' }),
    };

    const r = await runSync(okDeps as any, { rawOut, dryRun: true });

    expect(existsSync(rawOut)).toBe(true);
    const saved = JSON.parse(readFileSync(rawOut, 'utf8'));
    expect(saved.account.gameUid).toBe('800000123');

    expect(r.rawSaved).toBe(rawOut);
    expect(r.normalized).toBe(true);
    expect(r.characters).toBe(1);
    expect(r.sent).toBe(false); // --dry-run
    expect(okDeps.postIngest).not.toHaveBeenCalled();
  });

  it('resiliente: normalize (real) lança em property_type não mapeado — raw ainda é salvo, runSync NÃO lança, postIngest NÃO é chamado', async () => {
    const rawOut = tmpFile('raw-resilient.json');
    const p = vi.fn();
    const realDeps = {
      getSession: async () => ({ ltoken_v2: 'x', ltuid_v2: '1' }),
      // 9999 não existe no mapa PROP de @buer/core#normalize → propKey() lança.
      makeClient: () => ({ fetchAll: async () => rawFixture(9999) }),
      postIngest: p,
      readConfig: () => ({ apiToken: 'buer_live_x', apiBaseUrl: 'http://x' }),
    };

    const r = await runSync(realDeps as any, { rawOut });

    expect(existsSync(rawOut)).toBe(true);
    const savedText = readFileSync(rawOut, 'utf8');
    const saved = JSON.parse(savedText);
    expect(saved.account.gameUid).toBe('800000123');
    // o cookie da sessão HoYoLAB nunca entra no arquivo raw.
    expect(savedText).not.toMatch(/ltoken_v2|ltuid_v2/);

    expect(r.normalized).toBe(false);
    expect(r.sent).toBe(false);
    expect(r.rawSaved).toBe(rawOut);
    expect(p).not.toHaveBeenCalled();
  });

  it('--raw-out --dry-run não exige token da API Buer (sessão HoYoLAB basta)', async () => {
    const rawOut = tmpFile('raw-no-token.json');
    const noTokenDeps = {
      getSession: async () => ({ ltoken_v2: 'x', ltuid_v2: '1' }),
      makeClient: () => ({ fetchAll: async () => rawFixture(20) }),
      postIngest: vi.fn(),
      readConfig: () => ({ apiToken: undefined, apiBaseUrl: 'http://x' }),
    };

    const r = await runSync(noTokenDeps as any, { rawOut, dryRun: true });

    expect(existsSync(rawOut)).toBe(true);
    expect(r.sent).toBe(false);
    expect(noTokenDeps.postIngest).not.toHaveBeenCalled();
  });

  it('sem --raw-out: falha de normalize ainda propaga (comportamento antigo preservado)', async () => {
    const failDeps = {
      getSession: async () => ({ ltoken_v2: 'x', ltuid_v2: '1' }),
      makeClient: () => ({ fetchAll: async () => rawFixture(9999) }),
      postIngest: vi.fn(),
      readConfig: () => ({ apiToken: 'buer_live_x', apiBaseUrl: 'http://x' }),
    };

    await expect(runSync(failDeps as any, {})).rejects.toThrow(/property_type desconhecido/);
    expect(failDeps.postIngest).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Seleção de conta (--region/--uid) e --list-accounts
// ---------------------------------------------------------------------------

describe('runSync — seleção de conta e --list-accounts', () => {
  it('rejeita --region inválido antes de tentar sessão/fetch', async () => {
    const getSession = vi.fn();
    const badRegionDeps = {
      getSession,
      makeClient: () => ({ fetchAll: vi.fn(), listGameRoles: vi.fn() }),
      postIngest: vi.fn(),
      readConfig: () => ({ apiToken: 'buer_live_x', apiBaseUrl: 'http://x' }),
    };
    await expect(runSync(badRegionDeps as any, { region: 'os_brazil' })).rejects.toThrow(/região inválida/);
    expect(getSession).not.toHaveBeenCalled();
  });

  it('repassa --uid/--region para client.fetchAll()', async () => {
    const fetchAll = vi.fn(async () => ({
      list: { list: [] },
      detail: { list: [] },
      account: { gameUid: '800000000', region: 'os_usa', nickname: 'Traveler' },
    }));
    const selDeps = {
      getSession: async () => ({ ltoken_v2: 'x', ltuid_v2: '1' }),
      makeClient: () => ({ fetchAll, listGameRoles: vi.fn() }),
      postIngest: vi.fn(async () => ({ changedChars: 0 })),
      readConfig: () => ({ apiToken: 'buer_live_x', apiBaseUrl: 'http://x' }),
    };
    await runSync(selDeps as any, { uid: '800000000', region: 'os_usa', dryRun: true });
    expect(fetchAll).toHaveBeenCalledWith({ uid: '800000000', region: 'os_usa' });
  });

  it('--list-accounts chama listGameRoles(), devolve accounts e NUNCA chama fetchAll/postIngest', async () => {
    const roles = [
      { gameUid: '700000001', region: 'os_asia', nickname: 'Alt' },
      { gameUid: '800000000', region: 'os_usa', nickname: 'Traveler' },
    ];
    const fetchAll = vi.fn();
    const postIngest = vi.fn();
    const listDeps = {
      getSession: async () => ({ ltoken_v2: 'x', ltuid_v2: '1' }),
      makeClient: () => ({ fetchAll, listGameRoles: async () => roles }),
      postIngest,
      readConfig: () => ({ apiToken: 'buer_live_x', apiBaseUrl: 'http://x' }),
    };
    const r = await runSync(listDeps as any, { listAccounts: true });
    expect(r.accounts).toEqual(roles);
    expect(r.sent).toBe(false);
    expect(fetchAll).not.toHaveBeenCalled();
    expect(postIngest).not.toHaveBeenCalled();
  });
});
