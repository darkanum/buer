import { describe, it, expect } from 'vitest';
import type { BuildVariant } from '@buer/meta';
import type { ArtifactPiece, Build } from '../../src/interfaces.js';
import { checkSet } from '../../src/curated/checks/set.js';
import { checkMainStats } from '../../src/curated/checks/main-stats.js';
import { checkTargets } from '../../src/curated/checks/targets.js';
import { checkWeapon } from '../../src/curated/checks/weapon.js';
import { checkSubstats } from '../../src/curated/checks/substats.js';

function piece(over: Partial<ArtifactPiece>): ArtifactPiece {
  return {
    fingerprint: 'fp', setKey: 'A' as never, slot: 'flower', rarity: 5, level: 20,
    mainStatKey: 'hp' as never, substats: [], locked: false, equippedBy: null,
    ...over,
  } as ArtifactPiece;
}

function build(over: Partial<Build> = {}): Build {
  return {
    schemaVersion: 1,
    character: { key: 'c', level: 90, ascension: 0, constellation: 0, talents: { auto: 9, skill: 9, burst: 9 } },
    weapon: { key: 'W1', level: 90, ascension: 6, refinement: 1, equippedBy: 'c' },
    artifacts: {
      flower: piece({ slot: 'flower', setKey: 'A' as never }),
      plume: piece({ slot: 'plume', setKey: 'A' as never }),
      sands: piece({ slot: 'sands', setKey: 'A' as never, mainStatKey: 'enerRech_' as never }),
      goblet: piece({ slot: 'goblet', setKey: 'A' as never, mainStatKey: 'pyro_dmg_' as never }),
      circlet: piece({ slot: 'circlet', setKey: 'A' as never, mainStatKey: 'critRate_' as never }),
    },
    conditionals: {},
    ...over,
  } as Build;
}

const variant = {
  id: 'v', label: 'V', roles: ['sub-dps'], scalesOn: 'atk',
  sets: [
    { kind: '4pc', sets: ['A'], rank: 1 },
    { kind: '4pc', sets: ['B'], rank: 2 },
    { kind: '2+2', sets: ['A', 'B'], rank: 3 },
  ],
  mainStats: { sands: ['enerRech_', 'atk_'], goblet: ['pyro_dmg_'], circlet: ['critRate_', 'critDMG_'] },
  substats: ['critRate_', 'critDMG_', 'enerRech_'],
  weapons: [{ weapon: 'W1', rank: 1, minRefinement: 5 }, { weapon: 'W2', rank: 2 }],
  targets: [],
} as unknown as BuildVariant;

describe('checkSet', () => {
  it('4pc do set rank 1 é on-target com crédito cheio', () => {
    const f = checkSet(build(), variant);
    expect(f.status).toBe('on-target');
    expect(f.credit).toBe(1);
  });

  it('4pc de um set de rank pior perde crédito mas não é bloqueio', () => {
    const b = build({
      artifacts: {
        flower: piece({ slot: 'flower', setKey: 'B' as never }),
        plume: piece({ slot: 'plume', setKey: 'B' as never }),
        sands: piece({ slot: 'sands', setKey: 'B' as never }),
        goblet: piece({ slot: 'goblet', setKey: 'B' as never }),
        circlet: piece({ slot: 'circlet', setKey: 'B' as never }),
      },
    } as Partial<Build>);
    const f = checkSet(b, variant);
    expect(f.credit).toBeLessThan(1);
    expect(f.status).not.toBe('blocking');
  });

  it('reconhece 2+2 quando declarado', () => {
    const b = build({
      artifacts: {
        flower: piece({ slot: 'flower', setKey: 'A' as never }),
        plume: piece({ slot: 'plume', setKey: 'A' as never }),
        sands: piece({ slot: 'sands', setKey: 'B' as never }),
        goblet: piece({ slot: 'goblet', setKey: 'B' as never }),
        circlet: piece({ slot: 'circlet', setKey: 'C' as never }),
      },
    } as Partial<Build>);
    const f = checkSet(b, variant);
    expect(f.credit).toBeGreaterThan(0);
    expect(f.summary).toContain('2+2');
  });

  it('set fora da ficha zera o crédito e diz o que está equipado', () => {
    const b = build({
      artifacts: {
        flower: piece({ slot: 'flower', setKey: 'Z' as never }),
        plume: piece({ slot: 'plume', setKey: 'Z' as never }),
        sands: piece({ slot: 'sands', setKey: 'Z' as never }),
        goblet: piece({ slot: 'goblet', setKey: 'Z' as never }),
        circlet: piece({ slot: 'circlet', setKey: 'Z' as never }),
      },
    } as Partial<Build>);
    const f = checkSet(b, variant);
    expect(f.credit).toBe(0);
    expect(f.status).toBe('off-target');
  });
});

describe('checkMainStats', () => {
  it('as três main-stats na primeira posição da lista dão crédito cheio', () => {
    expect(checkMainStats(build(), variant).credit).toBe(1);
  });

  it('main-stat fora da lista derruba o crédito e é nomeada', () => {
    const b = build();
    const broken = { ...b, artifacts: { ...b.artifacts, goblet: piece({ slot: 'goblet', mainStatKey: 'hp_' as never }) } } as Build;
    const f = checkMainStats(broken, variant);
    expect(f.credit).toBeLessThan(1);
    expect(f.summary).toContain('goblet');
  });

  it('ignora slot para o qual a ficha não declara preferência', () => {
    const v = { ...variant, mainStats: { sands: ['enerRech_'], goblet: [], circlet: [] } } as unknown as BuildVariant;
    expect(checkMainStats(build(), v).credit).toBe(1);
  });
});

describe('checkTargets', () => {
  const er200 = { kind: 'min', stat: 'enerRech_', value: 200, hard: true, why: 'burst precisa sair' } as const;
  const crit = { kind: 'ratio', numerator: 'critDMG_', denominator: 'critRate_', min: 1.5, max: 2.5, why: 'equilíbrio' } as const;

  it('alvo hard violado é BLOQUEIO e sai também como violação', () => {
    const r = checkTargets({ enerRech_: 140 }, [er200]);
    expect(r.finding.status).toBe('blocking');
    expect(r.violated).toHaveLength(1);
    expect(r.finding.why).toContain('burst precisa sair');
  });

  it('alvo hard cumprido não bloqueia', () => {
    const r = checkTargets({ enerRech_: 210 }, [er200]);
    expect(r.finding.status).toBe('on-target');
    expect(r.violated).toHaveLength(0);
  });

  it('razão de crit dentro da faixa é on-target, fora é off-target sem bloquear', () => {
    expect(checkTargets({ critRate_: 70, critDMG_: 140 }, [crit]).finding.status).toBe('on-target');
    const bad = checkTargets({ critRate_: 20, critDMG_: 200 }, [crit]).finding;
    expect(bad.status).not.toBe('on-target');
    expect(bad.status).not.toBe('blocking');
  });

  it('sem stats resolvidos, não afirma nada: crédito 0 e ressalva explícita', () => {
    const r = checkTargets(null, [er200]);
    expect(r.finding.credit).toBe(0);
    expect(r.finding.caveat).toMatch(/stats/i);
    expect(r.violated).toHaveLength(0);
  });

  it('variante sem alvo nenhum é on-target com crédito cheio', () => {
    expect(checkTargets({}, []).finding.credit).toBe(1);
  });
});

describe('checkWeapon', () => {
  it('arma rank 1 com refino suficiente é crédito cheio', () => {
    const b = build({ weapon: { key: 'W1', level: 90, ascension: 6, refinement: 5, equippedBy: 'c' } } as Partial<Build>);
    expect(checkWeapon(b, variant).credit).toBe(1);
  });

  it('refino abaixo do mínimo reduz crédito e diz o refino exigido', () => {
    const f = checkWeapon(build(), variant); // refinement 1, minRefinement 5
    expect(f.credit).toBeLessThan(1);
    expect(f.summary).toContain('R5');
  });

  it('arma fora da lista não zera nem bloqueia — é conselho, não erro', () => {
    const b = build({ weapon: { key: 'W9', level: 90, ascension: 6, refinement: 1, equippedBy: 'c' } } as Partial<Build>);
    const f = checkWeapon(b, variant);
    expect(f.credit).toBeGreaterThan(0);
    expect(f.status).not.toBe('blocking');
  });
});

describe('checkSubstats', () => {
  const sub = (key: string, rolls: number) => ({
    key, tiers: Array.from({ length: rolls }, () => 1), value: 1, source: 'reconstructed',
  });

  it('todos os rolls nas stats prioritárias é crédito cheio', () => {
    const b = build();
    const loaded = {
      ...b,
      artifacts: {
        ...b.artifacts,
        flower: piece({ slot: 'flower', substats: [sub('critRate_', 5), sub('critDMG_', 4)] as never }),
      },
    } as Build;
    expect(checkSubstats(loaded, variant).credit).toBe(1);
  });

  it('rolls só em stats irrelevantes zera o crédito', () => {
    const b = build();
    const wasted = {
      ...b,
      artifacts: {
        ...b.artifacts,
        flower: piece({ slot: 'flower', substats: [sub('def_', 6), sub('hp', 5)] as never }),
      },
    } as Build;
    expect(checkSubstats(wasted, variant).credit).toBe(0);
  });

  it('peça não-5★ carrega ressalva visível (tabela de tier ausente)', () => {
    const b = build();
    const fodder = {
      ...b,
      artifacts: { ...b.artifacts, flower: piece({ slot: 'flower', rarity: 4, substats: [sub('critRate_', 2)] as never }) },
    } as Build;
    expect(checkSubstats(fodder, variant).caveat).toMatch(/5★|5\*|raridade/i);
  });

  it('build sem substat nenhum não lança', () => {
    expect(() => checkSubstats(build(), variant)).not.toThrow();
  });
});
