import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { charKey, propKey, type CharacterKey, type Element, type StatKey } from '@buer/core';
import { loadArtifactSets } from '@buer/gi-data';
import { rosterFromHoyolab, equippedBuild } from '../src/roster/from-hoyolab.js';

// Mesmo mapa pos->slot que from-hoyolab.ts usa internamente — duplicado aqui
// só para reconstruir, a partir do payload cru, a chave (dono, slot) que
// identifica uma peça, e comparar o `times` cru contra o `tiers.length` que
// o montador produziu.
const SLOT_BY_POS: Readonly<Record<number, string>> = {
  1: 'flower', 2: 'plume', 3: 'sands', 4: 'goblet', 5: 'circlet',
};
const ELEMENTS = new Set(['pyro', 'hydro', 'cryo', 'electro', 'anemo', 'geo', 'dendro']);

/**
 * dono+slot+StatKey -> `times` cru do HoYoLAB, direto do payload (sem passar
 * pelo montador). Usado para provar que `tiers.length === times + 1` de
 * verdade, e não só ">= 1" (que o caminho degradado passaria mesmo devolvendo
 * sempre 1 tier fixo).
 */
function rawTimesByOwnerSlotStat(): Map<string, number> {
  const out = new Map<string, number>();
  for (const entry of raw.detail.list as Record<string, any>[]) {
    const base = entry['base'] as Record<string, any>;
    const rawElement = String(base['element'] ?? '').toLowerCase();
    const element = ELEMENTS.has(rawElement) ? (rawElement as Element) : undefined;
    const owner = charKey(base['id'] as number, element);
    for (const relic of (entry['relics'] ?? []) as Record<string, any>[]) {
      const slot = SLOT_BY_POS[relic['pos'] as number];
      for (const sub of (relic['sub_property_list'] ?? []) as Record<string, any>[]) {
        const statKey = propKey(sub['property_type'] as number);
        out.set(`${owner}::${slot}::${statKey}`, sub['times'] as number);
      }
    }
  }
  return out;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(
  readFileSync(
    path.join(HERE, '..', '..', 'core', 'test', 'fixtures', 'real-account.scrubbed.json'),
    'utf8',
  ),
);
const OPTS = { capturedAt: '2026-08-24T00:00:00.000Z', lang: 'pt-br' };

describe('rosterFromHoyolab', () => {
  it('monta os 63 personagens da conta real', () => {
    const roster = rosterFromHoyolab(raw, OPTS);
    expect(roster.characters.size).toBe(63);
    expect(roster.provenance.source).toBe('hoyolab');
    expect(roster.provenance.capturedAt).toBe(OPTS.capturedAt);
  });

  it('separa os três talentos por sufixo de skill_id (1=auto, 2=skill, 5=burst)', () => {
    const roster = rosterFromHoyolab(raw, OPTS);
    // xiangling = 10000023, nível 90 C4 na conta de calibração
    const xiangling = roster.characters.get('10000023' as CharacterKey);
    expect(xiangling).toBeDefined();
    expect(xiangling!.level).toBe(90);
    expect(xiangling!.constellation).toBe(4);
    expect(xiangling!.element).toBe('pyro');
    expect(xiangling!.talents.auto).toBeGreaterThan(0);
    expect(xiangling!.talents.skill).toBeGreaterThan(0);
    expect(xiangling!.talents.burst).toBeGreaterThan(0);
  });

  it('aceita nível de talento acima de 10 (constelação dá +3)', () => {
    const roster = rosterFromHoyolab(raw, OPTS);
    for (const c of roster.characters.values()) {
      expect(c.talents.skill).toBeLessThanOrEqual(15);
    }
  });

  it('cada peça de artefato tem fingerprint, dono e substats com contagem de rolls', () => {
    const roster = rosterFromHoyolab(raw, OPTS);
    // Contagem EXATA, verificada na fixture: 156 relíquias no payload, mas 3
    // são 1★/2★ (nível 0, personagem 10000015, slots flower/goblet/circlet)
    // e são rejeitadas na borda — `interfaces.ts` diz `rarity: 3 | 4 | 5`
    // ("1/2 rejeitados na borda"), e o montador É a borda. 156 - 3 = 153.
    // Exato e não "maior que N" de propósito: prova que nenhuma OUTRA peça é
    // descartada por engano.
    expect(roster.artifacts.length).toBe(153);
    const rawTimes = rawTimesByOwnerSlotStat();
    for (const piece of roster.artifacts) {
      expect(piece.fingerprint).toMatch(/\S/);
      expect(piece.equippedBy).not.toBeNull();
      expect(['flower', 'plume', 'sands', 'goblet', 'circlet']).toContain(piece.slot);
      // Regressão que "tiers.length >= 1" não pegaria: o caminho degradado
      // (raridade sem tabela de tier verificada) tem que preservar a
      // contagem REAL de rolls, não devolver sempre 1 tier fixo.
      expect(piece.rarity).toBeGreaterThanOrEqual(3);
      for (const sub of piece.substats) {
        const times = rawTimes.get(`${piece.equippedBy}::${piece.slot}::${sub.key}`);
        expect(times).toBeDefined();
        expect(sub.tiers.length).toBe((times as number) + 1);
      }
    }
  });

  it('traduz o set.id do HoYoLAB para a chave do catálogo do gi-data', () => {
    const sets = loadArtifactSets();
    const roster = rosterFromHoyolab(raw, OPTS);
    // O payload traz `set.id` de 7 dígitos (2150031); o catálogo usa 5
    // (15003). Sem a tradução, TODA verificação de conjunto daria zero em
    // silêncio. Os 29 sets distintos da conta real têm que resolver.
    const unknown = [...new Set(roster.artifacts.map((p) => p.setKey))].filter((k) => !sets[Number(k)]);
    expect(unknown).toEqual([]);
    expect(roster.artifacts.some((p) => sets[Number(p.setKey)]!.slug === 'wanderer-s-troupe')).toBe(true);
  });

  it('lança em set.id fora do catálogo em vez de inventar chave', () => {
    const bogus = {
      detail: {
        list: [
          {
            base: { id: 10000023, element: 'Pyro', level: 90, actived_constellation_num: 0 },
            weapon: { id: 13401, level: 90, promote_level: 6, affix_level: 1 },
            relics: [
              {
                pos: 1, rarity: 5, level: 20, set: { id: 9999999 },
                main_property: { property_type: 2, value: '4780' }, sub_property_list: [],
              },
            ],
            skills: [],
          },
        ],
      },
    };
    expect(() => rosterFromHoyolab(bogus, OPTS)).toThrow(/9999999/);
  });

  it('preenche observedStats por personagem', () => {
    const roster = rosterFromHoyolab(raw, OPTS);
    expect(roster.observedStats.size).toBe(63);
    const stats = roster.observedStats.get('10000023' as CharacterKey);
    expect(typeof stats?.atk).toBe('number');
    expect(typeof stats?.enerRech_).toBe('number');
  });

  it('não quebra em personagem que o catálogo do gi-data não conhece', () => {
    // a conta real tem 2 personagens de patch novo ainda ausentes do catálogo;
    // o montador trabalha com id numérico, então eles passam normalmente.
    const roster = rosterFromHoyolab(raw, OPTS);
    expect(roster.characters.size).toBe(63);
  });
});

describe('equippedBuild', () => {
  it('monta a build equipada com arma, 5 slots e stats observados', () => {
    const roster = rosterFromHoyolab(raw, OPTS);
    const build = equippedBuild(roster, '10000023' as CharacterKey);
    expect(build).not.toBeNull();
    expect(build!.weapon.key).toMatch(/^\d+$/);
    expect(build!.artifacts.flower).not.toBeNull();
    expect(build!.artifacts.circlet).not.toBeNull();
    expect(build!.observedStats).toBeDefined();
    expect(build!.conditionals).toEqual({});
  });

  it('devolve null para personagem que não está no roster', () => {
    const roster = rosterFromHoyolab(raw, OPTS);
    expect(equippedBuild(roster, '99999999' as CharacterKey)).toBeNull();
  });
});
