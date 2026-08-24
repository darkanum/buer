import { describe, it, expect } from 'vitest';
import { reconstructTiers } from '../src/substat.js';

describe('reconstructTiers', () => {
  it('CRIT DMG 5★ tem 4 tiers: 5.44 6.22 6.99 7.77', () => {
    // 1 roll no tier mais baixo
    expect(reconstructTiers(5, 'critDMG_', 5.4, 1)).toEqual([1]);
    // 2 rolls: 6.99 + 7.77 = 14.8 (arredonda p/ 14.8)
    expect(reconstructTiers(5, 'critDMG_', 14.8, 2)).toEqual([3, 4]);
  });
  it('lança quando não há combinação de `times` rolls que bate o valor', () => {
    expect(() => reconstructTiers(5, 'critDMG_', 99, 1)).toThrow();
  });
});
