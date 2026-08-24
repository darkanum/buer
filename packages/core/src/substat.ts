export type Element = import('./keys.js').Element;
export type StatKey =
  | 'hp'|'hp_'|'atk'|'atk_'|'def'|'def_'|'eleMas'|'enerRech_'
  | 'critRate_'|'critDMG_'|'heal_'|'shield_'
  | `${Element}_dmg_`|'physical_dmg_'|'dmg_';

// Valores de roll por raridade → stat → tiers (Enka affixes.json). Subset 5★ aqui;
// o script gi-data pode gerar o arquivo completo. CRIT DMG 5★ = 4 tiers.
const TIERS: Partial<Record<3|4|5, Partial<Record<StatKey, number[]>>>> = {
  5: {
    critDMG_: [5.44, 6.22, 6.99, 7.77],
    critRate_: [2.72, 3.11, 3.50, 3.89],
    atk_: [4.08, 4.66, 5.25, 5.83],
    hp_: [4.08, 4.66, 5.25, 5.83],
    def_: [5.10, 5.83, 6.56, 7.29],
    enerRech_: [4.53, 5.18, 5.83, 6.48],
    eleMas: [16.32, 18.65, 20.98, 23.31],
    hp: [209.13, 239.00, 268.88, 298.75],
    atk: [13.62, 15.56, 17.51, 19.45],
    def: [16.20, 18.52, 20.83, 23.15],
  },
};

/** Busca uma multiseleção de `times` tiers (com repetição) cuja soma arredondada = displayValue. */
export function reconstructTiers(
  rarity: 3|4|5, key: StatKey, displayValue: number, times: number
): (1|2|3|4)[] {
  const table = TIERS[rarity]?.[key];
  if (!table) throw new Error(`sem tabela de tier para ${rarity}★ ${key}`);
  const round = (n: number) => Math.round(n * 10) / 10;
  const target = round(displayValue);
  const result: (1|2|3|4)[] = [];
  const dfs = (idx: number, left: number, sum: number): boolean => {
    if (left === 0) return round(sum) === target;
    for (let t = idx; t < table.length; t++) {
      result.push((t + 1) as 1|2|3|4);
      if (dfs(t, left - 1, sum + table[t]!)) return true;
      result.pop();
    }
    return false;
  };
  if (!dfs(0, times, 0)) throw new Error(`sem combinação de ${times} rolls p/ ${key}=${displayValue}`);
  return [...result];
}
