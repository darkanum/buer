import { describe, it, expect } from 'vitest';
import type { BuildEvaluator, EvaluationContext, Build } from './interfaces.js';

/**
 * Reusable contract test suite for any BuildEvaluator implementation.
 * Tests the core interface obligations: batch evaluate, well-formed Score, canHandle negotiation.
 * @param make Factory function that creates a fresh evaluator instance
 */
export function contractSuite(make: () => BuildEvaluator): void {
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
  });
}
