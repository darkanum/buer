import { describe, it, expect } from 'vitest';
import type { BuildEvaluator, EvaluationContext, Build, TeamComposition } from './interfaces.js';

export interface ContractSuiteOptions {
  /**
   * Marque `true` para avaliador que depende de stats observados. Liga o
   * teste de degradação: build sem `observedStats` tem que sair por
   * `canHandle` com razões, nunca por exceção.
   *
   * Este é o teste que a Fase 3 vai usar como verificação de que trocar o
   * StatResolver por um que CALCULA stats funcionou — quando o avaliador
   * passar a aceitar build hipotética, é aqui que a mudança aparece.
   */
  readonly requiresObservedStats?: boolean;
}

/**
 * Suíte de contrato reutilizável para qualquer BuildEvaluator: lote,
 * Score bem-formado, negociação por canHandle.
 * @param make fábrica que cria uma instância nova do avaliador
 * @param opts obrigações extras conforme a natureza do avaliador
 */
export function contractSuite(make: () => BuildEvaluator, opts: ContractSuiteOptions = {}): void {
  const ctx = {} as EvaluationContext;
  const build = {} as Build;

  describe('BuildEvaluator contract', () => {
    it('evaluate returns one Score per build in batch', async () => {
      const evaluator = make();
      const prepared = await evaluator.prepare(ctx);
      const scores = await prepared.evaluate([build, build]);

      expect(scores).toHaveLength(2);
      expect(scores[0]).toBeDefined();
      expect(scores[1]).toBeDefined();
    });

    it('each Score is well-formed (value, unit, violations, provenance.kind)', async () => {
      const evaluator = make();
      const prepared = await evaluator.prepare(ctx);
      const scores = await prepared.evaluate([build]);
      const score = scores[0]!;

      expect(score).toHaveProperty('value');
      expect(typeof score.value).toBe('number');
      expect(score).toHaveProperty('unit');
      expect(score).toHaveProperty('violations');
      expect(Array.isArray(score.violations)).toBe(true);
      expect(score).toHaveProperty('provenance');
      expect(score.provenance).toHaveProperty('kind');
    });

    it('canHandle returns a well-formed CapabilityVerdict', () => {
      const evaluator = make();
      const verdict = evaluator.canHandle(ctx);

      expect(verdict).toHaveProperty('ok');
      expect(typeof verdict.ok).toBe('boolean');
    });

    if (opts.requiresObservedStats) {
      it('recusa build sem observedStats por canHandle, com razões — nunca lança', () => {
        const evaluator = make();
        const subject = 'sujeito-de-teste';
        const hypothetical = { conditionals: {}, character: { key: subject } } as unknown as Build;
        const team = {
          schemaVersion: 1,
          slots: [{ build: hypothetical, role: [] }],
          teamConditionals: {},
        } as unknown as TeamComposition;
        const hypotheticalCtx = {
          gameVersion: '7.0',
          team,
          subject,
          objective: { schemaVersion: 1, id: 't', label: 'T', terms: [], aggregate: 'sum' },
          constraints: [],
        } as unknown as EvaluationContext;

        const verdict = evaluator.canHandle(hypotheticalCtx);

        expect(verdict.ok).toBe(false);
        if (!verdict.ok) {
          expect(verdict.reasons.length).toBeGreaterThan(0);
          expect(verdict.reasons.join(' ')).toMatch(/observedStats|stats observados/i);
        }
      });
    }
  });
}
