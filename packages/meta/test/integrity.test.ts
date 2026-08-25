import { describe, it, expect } from 'vitest';
import { loadMeta, validateMeta, readRawMeta } from '../src/index.js';
import type { RawMeta } from '../src/index.js';

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
          provenance: { authoredBy: 'human', confidence: 'medium' },
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

  it('rejeita ficha de personagem duplicada (mesma chave resolvida)', () => {
    const profile = {
      schemaVersion: 1 as const,
      character: 'xiangling',
      variants: [],
      provenance: {
        authoredBy: 'human', sources: [], authoredAt: '2026-08-24',
        validatedForVersion: '7.0', confidence: 'high',
      },
    };
    const problems = validateMeta({ profiles: [profile, profile], archetypes: [] });
    expect(problems.join('\n')).toContain('xiangling');
    expect(problems.join('\n')).toMatch(/duplicad/);
  });

  it('rejeita ficha duplicada do Traveler quando a chave composta (slug:elemento) colide', () => {
    const profile = {
      schemaVersion: 1 as const,
      character: 'aether:anemo',
      variants: [],
      provenance: {
        authoredBy: 'human', sources: [], authoredAt: '2026-08-24',
        validatedForVersion: '7.0', confidence: 'high',
      },
    };
    const problems = validateMeta({ profiles: [profile, profile], archetypes: [] });
    expect(problems.join('\n')).toContain('aether:anemo');
    expect(problems.join('\n')).toMatch(/duplicad/);
  });

  it('rejeita StatKey inventada em substats', () => {
    const problems = validateMeta({
      profiles: [
        {
          schemaVersion: 1,
          character: 'xiangling',
          variants: [
            {
              id: 'x', label: 'X', roles: ['sub-dps'], scalesOn: 'atk',
              sets: [], mainStats: { sands: [], goblet: [], circlet: [] },
              substats: ['statKeyInventada'], weapons: [], targets: [],
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
    expect(problems.join('\n')).toContain('statKeyInventada');
  });

  it('rejeita StatKey inventada em targets (stat, numerator e denominator)', () => {
    const problems = validateMeta({
      profiles: [
        {
          schemaVersion: 1,
          character: 'xiangling',
          variants: [
            {
              id: 'x', label: 'X', roles: ['sub-dps'], scalesOn: 'atk',
              sets: [], mainStats: { sands: [], goblet: [], circlet: [] },
              substats: [], weapons: [],
              targets: [
                { kind: 'min', stat: 'statKeyInventada', value: 1, hard: true, why: 'teste' },
                {
                  kind: 'ratio', numerator: 'outraStatInventada', denominator: 'critRate_',
                  min: 1, max: 2, why: 'teste',
                },
              ],
            },
          ],
          provenance: {
            authoredBy: 'human', sources: [], authoredAt: '2026-08-24',
            validatedForVersion: '7.0', confidence: 'high',
          },
        },
      ],
      archetypes: [],
      // "stat"/"numerator" abaixo são inventados de propósito (é o que o
      // teste verifica) — RawMeta tipa targets com o StatTarget já
      // resolvido, então StatKey precisa do cast pra aceitar o valor inválido.
    } as unknown as RawMeta);
    expect(problems.join('\n')).toContain('statKeyInventada');
    expect(problems.join('\n')).toContain('outraStatInventada');
  });

  it('rejeita StatKey inventada em targetOverrides de slot de arquétipo', () => {
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
          provenance: { authoredBy: 'human', confidence: 'medium' },
          slots: [
            {
              role: ['sub-dps'], substitutable: false,
              requires: { kind: 'character', anyOf: ['xiangling'] },
              variant: 'national-er',
              targetOverrides: [
                { kind: 'min', stat: 'statKeyInventadaNoOverride', value: 1, hard: true, why: 'teste' },
              ],
            },
          ],
        },
      ],
      // "stat" acima é inventado de propósito — mesmo cast do teste anterior.
    } as unknown as RawMeta);
    expect(problems.join('\n')).toContain('statKeyInventadaNoOverride');
  });
  it('rejeita slot de personagem com anyOf vazio (o buraco que pôs geo num time de bloom)', () => {
    const problems = validateMeta({
      profiles: [],
      archetypes: [
        {
          schemaVersion: 1, id: 'teste', label: 'Teste',
          gameVersionAdded: '7.0', strength: 'meta', tags: [], sources: [],
          provenance: { authoredBy: 'human', confidence: 'medium' },
          slots: [
            { role: ['buffer', 'healer'], substitutable: true, requires: { kind: 'character', anyOf: [] } },
            { role: ['sub-dps'], substitutable: true, requires: { kind: 'element', element: 'electro', withRole: ['sub-dps'] } },
          ],
        },
      ],
    });
    expect(problems.join('\n')).toMatch(/anyOf" vazio/);
  });

  it('rejeita requires.element que não é um dos 7 elementos do jogo', () => {
    const problems = validateMeta({
      profiles: [],
      archetypes: [
        {
          schemaVersion: 1, id: 'teste', label: 'Teste',
          gameVersionAdded: '7.0', strength: 'meta', tags: [], sources: [],
          provenance: { authoredBy: 'human', confidence: 'medium' },
          slots: [
            { role: ['sub-dps'], substitutable: true, requires: { kind: 'element', element: 'eletro', withRole: ['sub-dps'] } },
            { role: ['sub-dps'], substitutable: false, requires: { kind: 'character', anyOf: ['xiangling'] } },
          ],
        },
      ],
    });
    expect(problems.join('\n')).toContain('eletro');
  });

  // ---------------------------------------------------------------------------
  // Proveniência de ARQUÉTIPO — as mesmas três defesas que a ficha já tinha.
  // Sem elas, o arquivo que `meta:research:archetypes` grava é indistinguível
  // de curadoria humana e o motor o serve como se fosse (§14.3).
  // ---------------------------------------------------------------------------

  it('todo arquétipo commitado declara proveniência humana — nenhum é rascunho de máquina disfarçado', () => {
    const raw = readRawMeta();
    expect(raw.archetypes.length).toBeGreaterThan(0);
    for (const a of raw.archetypes) {
      expect(a.provenance, `arquétipo "${a.id}"`).toBeDefined();
      expect(a.provenance.authoredBy, `arquétipo "${a.id}"`).toBe('human');
      expect(a.provenance.confidence, `arquétipo "${a.id}"`).toBe('medium');
    }
  });

  it('rejeita arquétipo SEM proveniência — não assume "human" por omissão', () => {
    const problems = validateMeta({
      profiles: [],
      archetypes: [
        {
          schemaVersion: 1, id: 'teste', label: 'Teste',
          gameVersionAdded: '7.0', strength: 'meta', tags: [], sources: [],
          slots: [
            { role: ['sub-dps'], substitutable: false, requires: { kind: 'character', anyOf: ['xiangling'] } },
            { role: ['buffer'], substitutable: false, requires: { kind: 'character', anyOf: ['bennett'] } },
          ],
        },
      ],
      // `provenance` ausente de propósito: é o arquivo de um lote antigo, e
      // precisa falhar em vez de ser adotado como curadoria.
    } as unknown as RawMeta);
    expect(problems.join(' ')).toMatch(/provenance\.authoredBy inválido ou ausente/);
    expect(problems.join(' ')).toMatch(/provenance\.confidence inválido ou ausente/);
  });

  it('rejeita arquétipo "researched" com confidence "high" — máquina não se declara revisada', () => {
    const problems = validateMeta({
      profiles: [],
      archetypes: [
        {
          schemaVersion: 1, id: 'teste', label: 'Teste',
          gameVersionAdded: '7.0', strength: 'meta', tags: [], sources: [],
          provenance: { authoredBy: 'researched', confidence: 'high' },
          slots: [
            { role: ['sub-dps'], substitutable: false, requires: { kind: 'character', anyOf: ['xiangling'] } },
            { role: ['buffer'], substitutable: false, requires: { kind: 'character', anyOf: ['bennett'] } },
          ],
        },
      ],
    });
    expect(problems.join(' ')).toMatch(/"high" é proibido com authoredBy "researched"/);
  });

  it('aceita arquétipo "researched-reviewed" com confidence "high" — a promoção é o caminho legítimo', () => {
    const problems = validateMeta({
      profiles: [],
      archetypes: [
        {
          schemaVersion: 1, id: 'teste', label: 'Teste',
          gameVersionAdded: '7.0', strength: 'meta', tags: [], sources: [],
          provenance: { authoredBy: 'researched-reviewed', confidence: 'high' },
          slots: [
            { role: ['sub-dps'], substitutable: false, requires: { kind: 'character', anyOf: ['xiangling'] } },
            { role: ['buffer'], substitutable: false, requires: { kind: 'character', anyOf: ['bennett'] } },
          ],
        },
      ],
    });
    expect(problems).toEqual([]);
  });

  it('rejeita schemaVersion de arquétipo diferente de 1, como já faz com a ficha', () => {
    const problems = validateMeta({
      profiles: [],
      archetypes: [
        {
          schemaVersion: 2, id: 'teste', label: 'Teste',
          gameVersionAdded: '7.0', strength: 'meta', tags: [], sources: [],
          provenance: { authoredBy: 'human', confidence: 'medium' },
          slots: [
            { role: ['sub-dps'], substitutable: false, requires: { kind: 'character', anyOf: ['xiangling'] } },
            { role: ['buffer'], substitutable: false, requires: { kind: 'character', anyOf: ['bennett'] } },
          ],
        },
      ],
    });
    expect(problems.join('\n')).toMatch(/schemaVersion deve ser 1/);
  });
});
