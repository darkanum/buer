import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadMeta } from '@buer/meta';
import type { CharacterKey } from '@buer/core';
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
const BARBARA = '10000014' as CharacterKey;

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
    const r = await evaluator.teamsFor(BARBARA, roster);
    expect(r.playable).toHaveLength(0);
    expect(r.blocked).toHaveLength(0);
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
});
