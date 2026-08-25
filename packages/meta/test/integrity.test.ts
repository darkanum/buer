import { describe, it, expect } from 'vitest';
import { loadMeta, validateMeta, readRawMeta } from '../src/index.js';

describe('integridade do banco curado', () => {
  it('o banco commitado é íntegro (spec §5.5)', () => {
    expect(validateMeta(readRawMeta())).toEqual([]);
  });

  it('carrega e resolve slug para chave numérica', () => {
    const bank = loadMeta();
    // xiangling = avatar id 10000023 no catálogo do gi-data
    const profile = bank.profiles.get('10000023' as never);
    expect(profile).toBeDefined();
    expect(profile!.variants.length).toBeGreaterThanOrEqual(1);
    // sets e armas também viram id numérico
    const variant = profile!.variants[0]!;
    expect(variant.sets[0]!.sets.every((s) => /^\d+$/.test(s))).toBe(true);
    expect(variant.weapons.every((w) => /^\d+$/.test(w.weapon))).toBe(true);
  });

  it('rejeita slug de personagem que não existe no catálogo', () => {
    const problems = validateMeta({
      profiles: [
        {
          schemaVersion: 1,
          character: 'personagem-que-nao-existe',
          variants: [],
          provenance: {
            authoredBy: 'human', sources: [], authoredAt: '2026-08-24',
            validatedForVersion: '7.0', confidence: 'high',
          },
        },
      ],
      archetypes: [],
    });
    expect(problems.join('\n')).toContain('personagem-que-nao-existe');
  });

  it('rejeita RoleTag fora do vocabulário fechado', () => {
    const problems = validateMeta({
      profiles: [
        {
          schemaVersion: 1,
          character: 'xiangling',
          variants: [
            {
              id: 'x', label: 'X', roles: ['carry'], scalesOn: 'atk',
              sets: [], mainStats: { sands: [], goblet: [], circlet: [] },
              substats: [], weapons: [], targets: [],
            },
          ],
          provenance: {
            authoredBy: 'human', sources: [], authoredAt: '2026-08-24',
            validatedForVersion: '7.0', confidence: 'high',
          },
        },
      ],
      archetypes: [],
    });
    expect(problems.join('\n')).toContain('carry');
  });

  it('proíbe confidence high em ficha meramente pesquisada (spec §5.5)', () => {
    const problems = validateMeta({
      profiles: [
        {
          schemaVersion: 1,
          character: 'xiangling',
          variants: [],
          provenance: {
            authoredBy: 'researched', sources: ['https://exemplo'], authoredAt: '2026-08-24',
            validatedForVersion: '7.0', confidence: 'high',
          },
        },
      ],
      archetypes: [],
    });
    expect(problems.join('\n')).toMatch(/researched.*high|high.*researched/);
  });

  it('rejeita arquétipo cujo slot exige variante inexistente', () => {
    const problems = validateMeta({
      profiles: [
        {
          schemaVersion: 1,
          character: 'xiangling',
          variants: [
            {
              id: 'national-er', label: 'National', roles: ['sub-dps'], scalesOn: 'atk',
              sets: [], mainStats: { sands: [], goblet: [], circlet: [] },
              substats: [], weapons: [], targets: [],
            },
          ],
          provenance: {
            authoredBy: 'human', sources: [], authoredAt: '2026-08-24',
            validatedForVersion: '7.0', confidence: 'high',
          },
        },
      ],
      archetypes: [
        {
          schemaVersion: 1, id: 'teste', label: 'Teste',
          gameVersionAdded: '7.0', strength: 'meta', tags: [], sources: [],
          slots: [
            {
              role: ['sub-dps'], substitutable: false,
              requires: { kind: 'character', anyOf: ['xiangling'] },
              variant: 'variante-inexistente',
            },
          ],
        },
      ],
    });
    expect(problems.join('\n')).toContain('variante-inexistente');
  });

  it('rejeita main-stat ilegal para o slot', () => {
    const problems = validateMeta({
      profiles: [
        {
          schemaVersion: 1,
          character: 'xiangling',
          variants: [
            {
              id: 'x', label: 'X', roles: ['sub-dps'], scalesOn: 'atk',
              sets: [],
              // flor/pluma não entram; 'hp' plano não é main-stat legal de ampulheta
              mainStats: { sands: ['hp'], goblet: [], circlet: [] },
              substats: [], weapons: [], targets: [],
            },
          ],
          provenance: {
            authoredBy: 'human', sources: [], authoredAt: '2026-08-24',
            validatedForVersion: '7.0', confidence: 'high',
          },
        },
      ],
      archetypes: [],
    });
    expect(problems.join('\n')).toContain('sands');
  });
});
