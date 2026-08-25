import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadMeta } from '@buer/meta';
import type { MetaBank, TeamArchetypeData, CharacterProfile, ScoringWeights } from '@buer/meta';
import type { CharacterKey, WeaponKey } from '@buer/core';
import type { CharacterInstance, Roster, WeaponInstance } from '../../src/interfaces.js';
import { rosterFromHoyolab } from '../../src/roster/from-hoyolab.js';
import { ObservedStatResolver } from '../../src/stat-resolver.js';
import { CuratedTeamEvaluator } from '../../src/team/evaluator.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(
  readFileSync(path.join(HERE, '..', '..', '..', 'core', 'test', 'fixtures', 'real-account.scrubbed.json'), 'utf8'),
);
const roster = rosterFromHoyolab(raw, { capturedAt: '2026-08-24T00:00:00.000Z', lang: 'pt-br' });
const bank = loadMeta();
const evaluator = new CuratedTeamEvaluator({ bank, resolver: new ObservedStatResolver() });
const XIANGLING = '10000023' as CharacterKey;
// Tighnari: DENDRO, com ficha no banco, e nomeado em arquétipo nenhum —
// nenhum slot de elemento do banco pede dendro e nenhum `anyOf` o cita.
// (Era a Barbara aqui; ela virou candidata legítima do slot de buffer/healer
// do Hyperbloom quando esse slot deixou de ser um `anyOf` vazio.)
const TIGHNARI = '10000069' as CharacterKey;
const FISCHL = '10000031' as CharacterKey;

describe('CuratedTeamEvaluator.teamsFor', () => {
  it('lista o National como time jogável para Xiangling', async () => {
    const r = await evaluator.teamsFor(XIANGLING, roster);
    expect(r.playable.map((t) => t.match.archetype.id)).toContain('national');
  });

  it('o assessment traz reações, ressonância e viabilidade de energia', async () => {
    const r = await evaluator.teamsFor(XIANGLING, roster);
    const team = r.playable.find((t) => t.match.archetype.id === 'national')!;
    expect(team.assessment.reactions.some((x) => x.reaction === 'vaporize' && x.satisfied)).toBe(true);
    expect(Array.isArray(team.assessment.resonance)).toBe(true);
    expect(team.assessment.energyFeasibility.length).toBeGreaterThan(0);
    const xl = team.assessment.energyFeasibility.find((e) => e.of === XIANGLING)!;
    expect(xl.required).toBe(200); // alvo hard da variante national-er
    expect(typeof xl.actual).toBe('number');
  });

  it('a explicação nomeia o arquétipo, quem foi para cada slot e a variante julgada', async () => {
    const r = await evaluator.teamsFor(XIANGLING, roster);
    const team = r.playable.find((t) => t.match.archetype.id === 'national')!;
    expect(team.assessment.explanation.summary).toContain('National');
    const text = team.assessment.explanation.reasons.map((x) => x.claim).join(' ');
    expect(text).toMatch(/variante/i);
  });

  it('a ordenação diz por qual critério foi decidida', async () => {
    const r = await evaluator.teamsFor(XIANGLING, roster);
    for (const team of r.playable) {
      expect(['strength', 'targets', 'declared']).toContain(team.rankedBy);
    }
  });

  it('personagem sem arquétipo nenhum devolve as duas listas vazias, sem inventar time', async () => {
    const r = await evaluator.teamsFor(TIGHNARI, roster);
    expect(r.playable).toHaveLength(0);
    expect(r.blocked).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // roleCoverage: o papel ROTULADO no slot não é o papel que o ocupante cumpre
  // (Achado 2 da revisão final).
  // -------------------------------------------------------------------------

  it('roleCoverage não afirma coberto o papel que a ficha do ocupante não declara', async () => {
    const r = await evaluator.teamsFor(FISCHL, roster);
    const hyperbloom = r.playable.find((t) => t.match.archetype.id === 'hyperbloom');
    expect(hyperbloom).toBeDefined();

    // O slot 4 do Hyperbloom pede buffer/healer e nesta conta quem o ocupa é a
    // Sucrose, cuja única variante declara driver/debuffer/buffer. "buffer"
    // ela cumpre; "healer" ninguém neste time cumpre, e o assessment tem que
    // dizer isso em vez de herdar o rótulo do slot.
    const coverage = hyperbloom!.assessment.roleCoverage;
    expect(coverage.buffer).not.toBe('missing');
    expect(coverage.healer).toBe('missing');
  });

  it('todo papel dado como coberto é declarado por alguma ficha de quem está no time', async () => {
    for (const subject of [XIANGLING, FISCHL]) {
      const r = await evaluator.teamsFor(subject, roster);
      for (const option of [...r.playable, ...r.blocked]) {
        const declared = new Set<string>();
        for (const key of option.match.fills) {
          if (key === null) continue;
          for (const variant of bank.profiles.get(key)?.variants ?? []) {
            for (const role of variant.roles) declared.add(role);
          }
        }
        for (const [role, state] of Object.entries(option.assessment.roleCoverage)) {
          if (state === 'missing') continue;
          expect(declared, `${option.match.archetype.id}: "${role}" dado como ${state}`).toContain(role);
        }
      }
    }
  });

  it('roster sem xingqiu move o National de jogável para bloqueado', async () => {
    const without = { ...roster, characters: new Map([...roster.characters].filter(([k]) => k !== '10000025')) };
    const r = await evaluator.teamsFor(XIANGLING, without);
    expect(r.playable.map((t) => t.match.archetype.id)).not.toContain('national');
    expect(r.blocked.map((t) => t.match.archetype.id)).toContain('national');
  });

  it('a proveniência do assessment declara que é comparação curada, não simulação', async () => {
    const r = await evaluator.teamsFor(XIANGLING, roster);
    const p = r.playable[0]!.assessment.score.provenance;
    expect(p.kind).toBe('curated');
    expect(p.assumptions.join(' ')).toMatch(/ordinal|compara/i);
  });

  // Achado 1 (Critical, revisão): `stat-resolver.ts` documenta que `null`
  // significa "não sei", nunca zero. Um roster parcial (sem observedStats
  // para o personagem) não pode fazer `energyFeasibility` mentir "0% de ER".
  it('personagem sem stats observados não aparece em energyFeasibility, e a explicação diz por quê', async () => {
    const withoutStats = {
      ...roster,
      observedStats: new Map([...roster.observedStats].filter(([k]) => k !== XIANGLING)),
    };
    const r = await evaluator.teamsFor(XIANGLING, withoutStats);
    const team = r.playable.find((t) => t.match.archetype.id === 'national')!;

    expect(team.assessment.energyFeasibility.some((e) => e.of === XIANGLING)).toBe(false);
    const text = team.assessment.explanation.reasons.map((x) => x.claim).join(' ');
    expect(text).toMatch(/não p(o|ô)de ser verificad/i);
  });
});

// ---------------------------------------------------------------------------
// Achados 2, 3 e 4 (revisão da Task 9): cenários sintéticos, em memória.
//
// Usar o banco real (`national`) não dá controle fino sobre "dois arquétipos
// de mesma força que se desempatam por alvo duro" nem sobre "slot flex que só
// casa por papel" — o banco atual não tem nenhum dos dois. Um personagem e
// dois/três arquétipos fabricados aqui isolam exatamente o que cada achado
// aponta, sem depender de dado que a Task 11 ainda vai acrescentar.
// ---------------------------------------------------------------------------
describe('CuratedTeamEvaluator.teamsFor — cenários sintéticos (achados da revisão)', () => {
  const CHAR = '90000001' as CharacterKey;
  // Nunca entra no roster — só existe no `anyOf` do arquétipo do Achado 4,
  // para provar que CHAR entra pelo papel, não por estar nomeado ali.
  const OTHER = '90000002' as CharacterKey;

  function characterInstance(key: CharacterKey): CharacterInstance {
    return { key, level: 90, ascension: 6, constellation: 0, talents: { auto: 1, skill: 1, burst: 1 } };
  }

  function weaponInstance(owner: CharacterKey): WeaponInstance {
    return { key: 'test-weapon' as WeaponKey, level: 90, ascension: 6, refinement: 1, equippedBy: owner };
  }

  function makeRoster(critRate_: number): Roster {
    return {
      schemaVersion: 1,
      characters: new Map([[CHAR, characterInstance(CHAR)]]),
      artifacts: [],
      weapons: [weaponInstance(CHAR)],
      observedStats: new Map([[CHAR, { critRate_ }]]),
      provenance: { source: 'manual', completeness: 'full', capturedAt: '2026-08-24T00:00:00.000Z', lang: 'pt-br' },
    };
  }

  function makeProfile(): CharacterProfile {
    return {
      schemaVersion: 1,
      character: CHAR,
      variants: [
        {
          id: 'only',
          label: 'Only',
          roles: ['main-dps'],
          scalesOn: 'atk',
          sets: [],
          mainStats: { sands: [], goblet: [], circlet: [] },
          substats: [],
          weapons: [],
          // Vazio de propósito: os alvos destes testes vêm do targetOverride
          // do slot do arquétipo, não da ficha — isola o que cada teste quer medir.
          targets: [],
        },
      ],
      provenance: { authoredBy: 'human', sources: [], authoredAt: '2026-01-01', validatedForVersion: '5.0', confidence: 'high' },
    };
  }

  const weights: ScoringWeights = { version: 1, set: 1, mainStats: 1, targets: 1, weapon: 1, substats: 1 };

  /** Um único slot fixo, exigindo CHAR por nome, com um alvo hard de critRate_. */
  function archetypeWithHardCrit(id: string, hardCritTarget: number): TeamArchetypeData {
    return {
      schemaVersion: 1,
      id,
      label: id,
      gameVersionAdded: '5.0',
      strength: 'meta',
      tags: [],
      slots: [
        {
          role: ['main-dps'],
          requires: { kind: 'character', anyOf: [CHAR] },
          targetOverrides: [{ kind: 'min', stat: 'critRate_', value: hardCritTarget, hard: true, why: 'teste' }],
          substitutable: false,
        },
      ],
      sources: [],
    };
  }

  /** Slot flex: exige nomeadamente OTHER, mas casa por papel (Achado 4). */
  function roleOnlyArchetype(): TeamArchetypeData {
    return {
      schemaVersion: 1,
      id: 'role-only',
      label: 'role-only',
      gameVersionAdded: '5.0',
      strength: 'meta',
      tags: [],
      slots: [
        {
          role: ['main-dps'],
          requires: { kind: 'character', anyOf: [OTHER] },
          substitutable: true,
        },
      ],
      sources: [],
    };
  }

  function makeBank(archetypes: readonly TeamArchetypeData[]): MetaBank {
    return {
      profiles: new Map([[CHAR, makeProfile()]]),
      archetypes,
      scoring: weights,
      datasetSha: 'test-sha',
    };
  }

  it('desempate entre times de mesma força usa score.value (todos os alvos duros) — Achado 2', async () => {
    const roster = makeRoster(50); // critRate_ observado = 50
    // "meta-fail": exige critRate_ >= 100 (hard) — a build tem 50, viola.
    const failArchetype = archetypeWithHardCrit('meta-fail', 100);
    // "meta-pass": exige critRate_ >= 10 (hard) — a build tem 50, cumpre.
    const passArchetype = archetypeWithHardCrit('meta-pass', 10);
    const bank = makeBank([failArchetype, passArchetype]);
    const ev = new CuratedTeamEvaluator({ bank, resolver: new ObservedStatResolver() });

    const r = await ev.teamsFor(CHAR, roster);
    const failTeam = r.playable.find((t) => t.match.archetype.id === 'meta-fail')!;
    const passTeam = r.playable.find((t) => t.match.archetype.id === 'meta-pass')!;

    // Nenhum dos dois arquétipos tem alvo de ER — se o desempate ainda
    // olhasse só energyFeasibility (o bug), os dois empatariam em 0 e a
    // ordem cairia para a declarada, não para quem de fato cumpre os alvos.
    expect(passTeam.assessment.score.value).toBe(1);
    expect(failTeam.assessment.score.value).toBe(0);
    expect(r.playable.map((t) => t.match.archetype.id)).toEqual(['meta-pass', 'meta-fail']);
    expect(passTeam.rankedBy).toBe('strength');
    expect(failTeam.rankedBy).toBe('targets');
  });

  it('score.violations carrega os números REAIS medidos, não fica vazio por omissão — Achado 3', async () => {
    const roster = makeRoster(50);
    const failArchetype = archetypeWithHardCrit('meta-fail', 100);
    const passArchetype = archetypeWithHardCrit('meta-pass', 10);
    const bank = makeBank([failArchetype, passArchetype]);
    const ev = new CuratedTeamEvaluator({ bank, resolver: new ObservedStatResolver() });

    const r = await ev.teamsFor(CHAR, roster);
    const failTeam = r.playable.find((t) => t.match.archetype.id === 'meta-fail')!;
    const passTeam = r.playable.find((t) => t.match.archetype.id === 'meta-pass')!;

    expect(failTeam.assessment.score.violations).toHaveLength(1);
    const violation = failTeam.assessment.score.violations[0]!;
    expect(violation.required).toBe(100);
    expect(violation.actual).toBe(50);
    expect(violation.hard).toBe(true);
    expect(violation.constraint.kind).toBe('stat');
    if (violation.constraint.kind === 'stat') {
      expect(violation.constraint.of).toBe(CHAR);
      expect(violation.constraint.stat).toBe('critRate_');
    }

    expect(passTeam.assessment.score.violations).toHaveLength(0);
  });

  it('personagem só alcançável via slot flex por papel não é descartado antes do matching — Achado 4', async () => {
    const roster = makeRoster(50);
    const bank = makeBank([roleOnlyArchetype()]);
    const ev = new CuratedTeamEvaluator({ bank, resolver: new ObservedStatResolver() });

    const r = await ev.teamsFor(CHAR, roster);
    expect(r.playable.map((t) => t.match.archetype.id)).toContain('role-only');
    const team = r.playable.find((t) => t.match.archetype.id === 'role-only')!;
    expect(team.match.fills).toContain(CHAR);
  });
});
