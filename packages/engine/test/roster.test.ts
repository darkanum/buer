import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { CharacterKey } from '@buer/core';
import { loadArtifactSets } from '@buer/gi-data';
import { rosterFromHoyolab, equippedBuild } from '../src/roster/from-hoyolab.js';

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
    // Contagem EXATA, verificada na fixture: 156 peças em 32 dos 63
    // personagens (os outros 31 estão sem artefato nenhum). Exato e não
    // "maior que N" de propósito: prova que nenhuma peça é descartada.
    expect(roster.artifacts.length).toBe(156);
    for (const piece of roster.artifacts) {
      expect(piece.fingerprint).toMatch(/\S/);
      expect(piece.equippedBy).not.toBeNull();
      expect(['flower', 'plume', 'sands', 'goblet', 'circlet']).toContain(piece.slot);
      for (const sub of piece.substats) {
        expect(sub.tiers.length).toBeGreaterThanOrEqual(1);
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
