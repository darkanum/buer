import { describe, it, expectTypeOf } from 'vitest';
import type { BuildEvaluator, EvaluationContext, Score } from '../src/interfaces.js';

describe('interfaces', () => {
  it('BuildEvaluator tem a forma esperada', () => {
    expectTypeOf<BuildEvaluator['id']>().toEqualTypeOf<string>();
    expectTypeOf<BuildEvaluator['canHandle']>().parameter(0).toEqualTypeOf<EvaluationContext>();
  });
});
