import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadMeta } from '@buer/meta';
import type { CharacterProfile, MetaBank, TeamArchetypeData } from '@buer/meta';
import type { CharacterKey, Element, RoleTag } from '@buer/core';
import type { CharacterInstance, Roster } from '../src/interfaces.js';
import { rosterFromHoyolab } from '../src/roster/from-hoyolab.js';
import { CuratedRosterAdvisor } from '../src/advisor/advisor.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(
  readFileSync(path.join(HERE, '..', '..', 'core', 'test', 'fixtures', 'real-account.scrubbed.json'), 'utf8'),
);
const full = rosterFromHoyolab(raw, { capturedAt: '2026-08-24T00:00:00.000Z', lang: 'pt-br' });
const bank = loadMeta();
const advisor = new CuratedRosterAdvisor({ bank });
const XIANGLING = '10000023' as CharacterKey;
const XINGQIU = '10000025' as CharacterKey;

const without = (key: string) => ({
  ...full,
  characters: new Map([...full.characters].filter(([k]) => k !== key)),
});

describe('CuratedRosterAdvisor', () => {
  it('roster sem xingqiu sugere adquirir xingqiu, com o arquétipo que ele destrava', async () => {
    const advice = await advisor.adviseFor(XIANGLING, without('10000025'));
    const candidate = advice.candidates.find(
      (c) => c.axis.kind === 'newCharacter' && c.axis.character === XINGQIU,
    );
    expect(candidate).toBeDefined();
    expect(candidate!.unlocks.map((u) => u.archetype.id)).toContain('national');
    expect(candidate!.explanation.summary).toContain('National');
  });

  it('não sugere nada para um arquétipo que já é jogável', async () => {
    const advice = await advisor.adviseFor(XIANGLING, full);
    // Escopado ao National de propósito: a Task 11 acrescenta arquétipos em
    // que Xiangling pode hospedar um slot flex de pyro, e um
    // `toHaveLength(0)` global passaria a quebrar por crescimento do banco,
    // não por regressão do conselheiro.
    const unlocked = advice.candidates.flatMap((c) => c.unlocks.map((u) => u.archetype.id));
    expect(unlocked).not.toContain('national');
  });

  it('improves fica VAZIO na Fase 2 — não se afirma quanto rende (spec §8.4)', async () => {
    const advice = await advisor.adviseFor(XIANGLING, without('10000025'));
    for (const candidate of advice.candidates) expect(candidate.improves).toHaveLength(0);
  });

  it('ordena por quantos arquétipos destrava, depois por força curada', async () => {
    const advice = await advisor.adviseFor(XIANGLING, without('10000025'));
    for (let i = 1; i < advice.candidates.length; i++) {
      const previous = advice.candidates[i - 1]!;
      const current = advice.candidates[i]!;
      expect(previous.unlocks.length).toBeGreaterThanOrEqual(current.unlocks.length);
    }
  });

  it('declara nas assunções que não sabe disponibilidade de gacha', async () => {
    const advice = await advisor.adviseFor(XIANGLING, without('10000025'));
    const text = advice.candidates[0]!.provenance.assumptions.join(' ');
    expect(text).toMatch(/gacha|disponibilidade/i);
  });

  it('slot flex vazio vira CoverageGap com elemento e papéis, não um nome', async () => {
    // remove todos os anemo do roster: o slot flex do National deixa de fechar
    const noAnemo = {
      ...full,
      characters: new Map([...full.characters].filter(([, c]) => c.element !== 'anemo')),
    };
    const advice = await advisor.adviseFor(XIANGLING, noAnemo);
    const gap = advice.coverageGaps.find((g) => g.missing.element === 'anemo');
    expect(gap).toBeDefined();
    expect(gap!.blockedArchetypes).toContain('national');
    expect(['critical', 'notable', 'minor']).toContain(gap!.severity);
  });

  it('a visão de conta cobre todos os arquétipos, não só os de um personagem', async () => {
    const accountView = await advisor.advise(without('10000025'), {} as never);
    const characterView = await advisor.adviseFor(XIANGLING, without('10000025'));
    expect(accountView.candidates.length).toBeGreaterThanOrEqual(characterView.candidates.length);
  });
});

// ---------------------------------------------------------------------------
// Fixtures sintéticas para os dois achados da revisão da Task 10 — não
// dependem do banco curado real (só 3 fichas hoje) nem exigem dado novo em
// @buer/meta, como a revisão autorizou.
// ---------------------------------------------------------------------------

function buildProfile(character: CharacterKey, roles: readonly RoleTag[]): CharacterProfile {
  return {
    schemaVersion: 1,
    character,
    variants: [
      {
        id: 'v1',
        label: 'v1',
        roles,
        scalesOn: 'atk',
        sets: [],
        mainStats: { sands: [], goblet: [], circlet: [] },
        substats: [],
        weapons: [],
        targets: [],
      },
    ],
    provenance: {
      authoredBy: 'human',
      sources: [],
      authoredAt: '2026-08-24T00:00:00.000Z',
      validatedForVersion: '1.0',
      confidence: 'high',
    },
  };
}

function buildBank(profiles: readonly CharacterProfile[], archetypes: readonly TeamArchetypeData[]): MetaBank {
  return {
    profiles: new Map(profiles.map((p) => [p.character, p])),
    archetypes,
    scoring: { version: 1, set: 1, mainStats: 1, targets: 1, weapon: 1, substats: 1 },
    datasetSha: 'synthetic-test',
  };
}

function buildCharacter(key: CharacterKey, element: Element, constellation: CharacterInstance['constellation'] = 0): CharacterInstance {
  return {
    key,
    element,
    level: 1,
    ascension: 0,
    constellation,
    talents: { auto: 1, skill: 1, burst: 1 },
  };
}

function buildRoster(characters: readonly CharacterInstance[]): Roster {
  return {
    schemaVersion: 1,
    characters: new Map(characters.map((c) => [c.key, c])),
    artifacts: [],
    weapons: [],
    observedStats: new Map(),
    provenance: { source: 'manual', completeness: 'full', capturedAt: '2026-08-24T00:00:00.000Z', lang: 'pt-br' },
  };
}

/** Arquétipo sintético de um slot só, fixo, não-substituível — o mínimo para
 * exercitar `blocked-by-one` sem depender do banco curado real. */
function buildSingleCharArchetype(
  id: string,
  required: CharacterKey,
  opts: { readonly minConstellation?: number } = {},
): TeamArchetypeData {
  return {
    schemaVersion: 1,
    id,
    label: id,
    gameVersionAdded: '1.0',
    strength: 'niche',
    tags: [],
    sources: [],
    slots: [
      {
        role: ['sub-dps'],
        requires: { kind: 'character', anyOf: [required] },
        substitutable: false,
        ...opts,
      },
    ],
  };
}

describe('CuratedRosterAdvisor — redundancyWith respeita elemento (achado Critical da revisão)', () => {
  // XINGQIU é hydro de verdade no catálogo do gi-data (characters.json) —
  // reusado aqui para não fabricar um elemento que não existe no jogo.
  const NEW_CHAR = XINGQIU;
  const HYDRO_BUDDY = 'synthetic-hydro-buddy' as CharacterKey;
  const PYRO_BUDDY = 'synthetic-pyro-buddy' as CharacterKey;

  const testBank = buildBank(
    [buildProfile(HYDRO_BUDDY, ['sub-dps']), buildProfile(PYRO_BUDDY, ['sub-dps'])],
    [buildSingleCharArchetype('synthetic-needs-hydro', NEW_CHAR)],
  );
  const testRoster = buildRoster([buildCharacter(HYDRO_BUDDY, 'hydro'), buildCharacter(PYRO_BUDDY, 'pyro')]);
  const testAdvisor = new CuratedRosterAdvisor({ bank: testBank });

  it('positivo: lista quem tem o MESMO papel e o MESMO elemento do personagem a adquirir', async () => {
    const advice = await testAdvisor.advise(testRoster, {} as never);
    const candidate = advice.candidates.find(
      (c) => c.axis.kind === 'newCharacter' && c.axis.character === NEW_CHAR,
    );
    expect(candidate).toBeDefined();
    expect(candidate!.redundancyWith).toContain(HYDRO_BUDDY);
  });

  it('negativo: NÃO lista quem tem o mesmo papel mas elemento DIFERENTE (falhava antes do fix)', async () => {
    const advice = await testAdvisor.advise(testRoster, {} as never);
    const candidate = advice.candidates.find(
      (c) => c.axis.kind === 'newCharacter' && c.axis.character === NEW_CHAR,
    );
    expect(candidate).toBeDefined();
    expect(candidate!.redundancyWith).not.toContain(PYRO_BUDDY);
  });
});

describe('CuratedRosterAdvisor — identidade do eixo por dono (achado Important da revisão)', () => {
  const CHAR_A = 'synthetic-charA' as CharacterKey;
  const CHAR_B = 'synthetic-charB' as CharacterKey;

  const testBank = buildBank(
    [],
    [
      buildSingleCharArchetype('synthetic-archetype-a', CHAR_A, { minConstellation: 2 }),
      buildSingleCharArchetype('synthetic-archetype-b', CHAR_B, { minConstellation: 2 }),
    ],
  );
  const testRoster = buildRoster([buildCharacter(CHAR_A, 'pyro', 0), buildCharacter(CHAR_B, 'hydro', 0)]);
  const testAdvisor = new CuratedRosterAdvisor({ bank: testBank });

  it('dois personagens pedindo o MESMO salto de constelação geram DOIS candidatos, não um fundido', async () => {
    const advice = await testAdvisor.advise(testRoster, {} as never);
    const consCandidates = advice.candidates.filter((c) => c.axis.kind === 'constellation');
    expect(consCandidates).toHaveLength(2);
    const owners = new Set(consCandidates.map((c) => (c.axis.kind === 'constellation' ? c.axis.of : undefined)));
    expect(owners).toEqual(new Set([CHAR_A, CHAR_B]));
  });
});
