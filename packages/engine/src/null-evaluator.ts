import type {
  BuildEvaluator,
  PreparedEvaluator,
  EvaluationContext,
  EvaluatorCapabilities,
  Score,
  Build,
  CapabilityVerdict,
} from './interfaces.js';

const CAPS: EvaluatorCapabilities = {
  kind: 'curated',
  output: 'ordinal',
  supportsTermKinds: ['stat'],
  supportsAggregates: ['sum'],
  supportsConstraintKinds: [],
  supportsHitModes: ['avgHit'],
  modelsSnapshot: false,
  modelsAuraAndIcd: false,
  providesBounds: false,
  deterministic: true,
  estimatedCostPerBuildMs: 0.001,
  maxBatchSize: 100000,
  runtime: 'node',
};

export class NullEvaluator implements BuildEvaluator {
  readonly id = 'null';
  readonly capabilities = CAPS;

  canHandle(_ctx: EvaluationContext): CapabilityVerdict {
    return { ok: true };
  }

  async prepare(ctx: EvaluationContext): Promise<PreparedEvaluator> {
    const score = (): Score => ({
      value: 0,
      unit: 'score',
      violations: [],
      provenance: {
        evaluatorId: this.id,
        kind: 'curated',
        gameVersion: ctx.gameVersion ?? ('7.0' as const),
        datasetSha: 'none',
        confidence: 'low',
        assumptions: ['null evaluator'],
        rosterCompleteness: 'partial',
        cacheKey: 'null',
      },
    });

    return {
      async evaluate(builds: readonly Build[]) {
        return builds.map(score);
      },
      async [Symbol.asyncDispose]() {
        // no-op
      },
    };
  }
}
