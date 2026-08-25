import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadMeta } from '@buer/meta';
import type { CharacterKey } from '@buer/core';
import { rosterFromHoyolab, equippedBuild } from '../../src/roster/from-hoyolab.js';
import { ObservedStatResolver } from '../../src/stat-resolver.js';
import { assess } from '../../src/curated/scoring.js';
import { selectVariant } from '../../src/curated/variant.js';
import { CuratedBuildEvaluator } from '../../src/curated/evaluator.js';
import { contractSuite } from '../../src/contract-suite.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(
  readFileSync(path.join(HERE, '..', '..', '..', 'core', 'test', 'fixtures', 'real-account.scrubbed.json'), 'utf8'),
);
const roster = rosterFromHoyolab(raw, { capturedAt: '2026-08-24T00:00:00.000Z', lang: 'pt-br' });
const bank = loadMeta();
const XIANGLING = '10000023' as CharacterKey;

describe('assess', () => {
  it('produz um achado por verificação e um breakdown com as cinco chaves', () => {
    const build = equippedBuild(roster, XIANGLING)!;
    const variant = bank.profiles.get(XIANGLING)!.variants[0]!;
    const a = assess(build, variant, build.observedStats ?? null, bank.scoring);

    expect(a.findings).toHaveLength(5);
    expect(Object.keys(a.breakdown).sort()).toEqual(
      ['mainStats', 'set', 'substats', 'targets', 'weapon'],
    );
    expect(a.value).toBeTypeOf('number');
  });

  it('build com alvo hard violado fica ABAIXO de qualquer build sem bloqueio', () => {
    const build = equippedBuild(roster, XIANGLING)!;
    const variant = bank.profiles.get(XIANGLING)!.variants[0]!;
    const blocked = assess(build, variant, { ...build.observedStats, enerRech_: 100 }, bank.scoring);
    const fine = assess(build, variant, { ...build.observedStats, enerRech_: 250 }, bank.scoring);

    expect(blocked.blocked).toBe(true);
    expect(fine.blocked).toBe(false);
    expect(blocked.value).toBeLessThan(fine.value);
    expect(blocked.violated.length).toBeGreaterThan(0);
  });

  it('nenhuma contribuição do breakdown é escondida — soma bate com o valor sem bloqueio', () => {
    const build = equippedBuild(roster, XIANGLING)!;
    const variant = bank.profiles.get(XIANGLING)!.variants[0]!;
    const a = assess(build, variant, { ...build.observedStats, enerRech_: 250 }, bank.scoring);
    const sum = Object.values(a.breakdown).reduce((x, y) => x + y, 0);
    expect(sum).toBeCloseTo(a.value, 5);
  });
});

describe('selectVariant', () => {
  const profile = () => bank.profiles.get(XIANGLING)!;

  it('variante fixada pelo usuário vence tudo', () => {
    const build = equippedBuild(roster, XIANGLING)!;
    const choice = selectVariant(profile(), build, build.observedStats ?? null, bank.scoring, {
      pinned: 'vaporize',
    });
    expect(choice.variant.id).toBe('vaporize');
    expect(choice.reason).toBe('pinned');
  });

  it('variante exigida pelo arquétipo vence o melhor casamento', () => {
    const build = equippedBuild(roster, XIANGLING)!;
    const choice = selectVariant(profile(), build, build.observedStats ?? null, bank.scoring, {
      fromArchetype: 'national-er',
    });
    expect(choice.variant.id).toBe('national-er');
    expect(choice.reason).toBe('archetype');
  });

  it('sem contexto, escolhe a variante de maior nota e diz qual foi', () => {
    const build = equippedBuild(roster, XIANGLING)!;
    const choice = selectVariant(profile(), build, build.observedStats ?? null, bank.scoring, {});
    expect(choice.reason).toBe('best-match');
    expect(choice.explanation).toContain(choice.variant.label);
  });

  it('variante fixada inexistente cai no melhor casamento em vez de lançar', () => {
    const build = equippedBuild(roster, XIANGLING)!;
    const choice = selectVariant(profile(), build, build.observedStats ?? null, bank.scoring, {
      pinned: 'nao-existe',
    });
    expect(choice.reason).toBe('best-match');
  });
});

describe('CuratedBuildEvaluator', () => {
  // 'full' é verdade aqui: a fixture é uma extração completa do HoYoLAB.
  const make = () =>
    new CuratedBuildEvaluator({ bank, resolver: new ObservedStatResolver(), rosterCompleteness: 'full' });

  contractSuite(make, { requiresObservedStats: true });

  it('declara as capacidades da spec §6.3', () => {
    const caps = make().capabilities;
    expect(caps.kind).toBe('curated');
    expect(caps.output).toBe('ordinal');
    expect(caps.providesBounds).toBe(false);
    expect(caps.deterministic).toBe(true);
    expect([...caps.supportsAggregates]).toEqual(['sum']);
  });

  it('recusa personagem sem ficha, nomeando o motivo', () => {
    const build = equippedBuild(roster, '10000014' as CharacterKey); // barbara, sem ficha ainda
    const ctx = {
      gameVersion: '7.0',
      subject: '10000014',
      team: { schemaVersion: 1, slots: [{ build, role: [] }], teamConditionals: {} },
      objective: { schemaVersion: 1, id: 'o', label: 'O', terms: [], aggregate: 'sum' },
      constraints: [],
    } as never;
    const verdict = make().canHandle(ctx);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reasons.join(' ')).toMatch(/ficha/i);
  });

  it('explain nomeia SEMPRE a variante julgada (spec §6.4)', async () => {
    const build = equippedBuild(roster, XIANGLING)!;
    const ctx = {
      gameVersion: '7.0',
      subject: XIANGLING,
      team: { schemaVersion: 1, slots: [{ build, role: [] }], teamConditionals: {} },
      objective: { schemaVersion: 1, id: 'o', label: 'O', terms: [], aggregate: 'sum' },
      constraints: [],
    } as never;
    const prepared = await make().prepare(ctx);
    const explanation = await prepared.explain!(build);
    expect(explanation.summary).toMatch(/variante/i);
    expect(explanation.reasons.length).toBeGreaterThanOrEqual(5);
  });

  it('propaga a proveniência do dado curado para o Score', async () => {
    const build = equippedBuild(roster, XIANGLING)!;
    const ctx = {
      gameVersion: '7.0',
      subject: XIANGLING,
      team: { schemaVersion: 1, slots: [{ build, role: [] }], teamConditionals: {} },
      objective: { schemaVersion: 1, id: 'o', label: 'O', terms: [], aggregate: 'sum' },
      constraints: [],
    } as never;
    const prepared = await make().prepare(ctx);
    const [score] = await prepared.evaluate([build]);
    expect(score!.provenance.kind).toBe('curated');
    expect(score!.provenance.datasetSha).toBe(bank.datasetSha);
    expect(score!.provenance.confidence).toBe('medium'); // xiangling.json é human/medium
    expect(score!.provenance.assumptions.join(' ')).toContain('scoring v1');
  });

  it('Score.violations carrega o valor MEDIDO da build, não um zero fabricado (revisão, Achado 1)', async () => {
    const original = equippedBuild(roster, XIANGLING)!;
    // ER conhecido e abaixo do alvo hard de 200 da variante national-er.
    const build = { ...original, observedStats: { ...original.observedStats, enerRech_: 140 } };
    const ctx = {
      gameVersion: '7.0',
      subject: XIANGLING,
      team: { schemaVersion: 1, slots: [{ build, role: [] }], teamConditionals: {} },
      objective: { schemaVersion: 1, id: 'o', label: 'O', terms: [], aggregate: 'sum' },
      constraints: [],
    } as never;
    // Força a variante national-er (alvo ER 200) para o teste não depender
    // de qual variante o best-match escolheria com ER baixo.
    const evaluator = new CuratedBuildEvaluator({
      bank,
      resolver: new ObservedStatResolver(),
      rosterCompleteness: 'full',
      archetypeVariants: new Map([[XIANGLING, 'national-er']]),
    });
    const prepared = await evaluator.prepare(ctx);
    const [score] = await prepared.evaluate([build as never]);

    expect(score!.violations.length).toBeGreaterThan(0);
    expect(score!.violations[0]!.actual).toBe(140);
    expect(score!.violations[0]!.required).toBe(200);
  });

  it('archetypeVariants nomeia a variante exigida pelo arquétipo, não a fixação do usuário (revisão, Achado 2)', async () => {
    const build = equippedBuild(roster, XIANGLING)!;
    const ctx = {
      gameVersion: '7.0',
      subject: XIANGLING,
      team: { schemaVersion: 1, slots: [{ build, role: [] }], teamConditionals: {} },
      objective: { schemaVersion: 1, id: 'o', label: 'O', terms: [], aggregate: 'sum' },
      constraints: [],
    } as never;
    const evaluator = new CuratedBuildEvaluator({
      bank,
      resolver: new ObservedStatResolver(),
      rosterCompleteness: 'full',
      archetypeVariants: new Map([[XIANGLING, 'vaporize']]),
    });
    const prepared = await evaluator.prepare(ctx);
    const [score] = await prepared.evaluate([build]);

    // Reason precisa ser 'archetype', nunca 'pinned' — a fixação do usuário
    // (regra 1) é feita chamando selectVariant direto, por fora do avaliador.
    expect(score!.provenance.assumptions.join(' ')).toContain('vaporize (archetype)');
  });

  it('rosterCompleteness vem de quem constrói o avaliador, não é fabricado (revisão, Achado 3)', async () => {
    const build = equippedBuild(roster, XIANGLING)!;
    const ctx = {
      gameVersion: '7.0',
      subject: XIANGLING,
      team: { schemaVersion: 1, slots: [{ build, role: [] }], teamConditionals: {} },
      objective: { schemaVersion: 1, id: 'o', label: 'O', terms: [], aggregate: 'sum' },
      constraints: [],
    } as never;
    const partial = new CuratedBuildEvaluator({
      bank,
      resolver: new ObservedStatResolver(),
      rosterCompleteness: 'partial',
    });
    const prepared = await partial.prepare(ctx);
    const [score] = await prepared.evaluate([build]);

    expect(score!.provenance.rosterCompleteness).toBe('partial');
  });
});
