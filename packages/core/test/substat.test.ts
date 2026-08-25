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

  // Substats planos (HP/ATK/DEF/EM) exibem valor INTEIRO no HoYoLAB (ex.:
  // "209"), não 1 casa decimal como os percentuais — reconstructTiers tem
  // que arredondar na precisão do PRÓPRIO stat (0 casas p/ plano), não numa
  // regra única de 1 casa (bug real: round(209.13,1)=209.1 ≠ 209).
  it('substat plano (flat) reconstrói por valor inteiro, não 1 casa decimal', () => {
    // 1 roll no tier mais baixo de HP flat: 209.13 → exibido como "209"
    expect(reconstructTiers(5, 'hp', 209, 1)).toEqual([1]);
    // 3 rolls de DEF flat: 16.20+23.15+23.15 = 62.5 → HoYoLAB exibe "63"
    // (round-half-up); em ponto flutuante puro essa soma dá
    // 62.499999999999996, que arredondaria para 62 — regressão real
    // encontrada numa conta de verdade.
    expect(reconstructTiers(5, 'def', 63, 3)).toEqual([1, 4, 4]);
  });

  it('lança quando não há tabela para a raridade (ex.: 3★/4★, ainda não verificadas)', () => {
    expect(() => reconstructTiers(4, 'critDMG_', 5.4, 1)).toThrow(/sem tabela de tier/);
  });
});
