import { describe } from 'vitest';
import { NullEvaluator } from '../src/null-evaluator.js';
import { contractSuite } from '../src/contract-suite.js';

describe('NullEvaluator', () => {
  contractSuite(() => new NullEvaluator());
});
