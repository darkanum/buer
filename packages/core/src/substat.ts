import { decimalsForStat } from './properties.js';

export type Element = import('./keys.js').Element;
export type StatKey =
  | 'hp'|'hp_'|'atk'|'atk_'|'def'|'def_'|'eleMas'|'enerRech_'
  | 'critRate_'|'critDMG_'|'heal_'|'shield_'
  | `${Element}_dmg_`|'physical_dmg_'|'dmg_';

// Valores de roll por raridade → stat → tiers (Enka affixes.json). Subset 5★
// aqui (o único confirmado byte-a-byte contra uma conta real — ver
// real-account.test.ts); 3★/4★ ficam para quando houver uma tabela
// igualmente verificada — reconstructTiers simplesmente lança para uma
// raridade sem tabela, e normalize.ts decide degradar (não este módulo).
// CRIT DMG 5★ = 4 tiers.
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

/** Tier tables carry at most 2 decimal places — summing at this fixed-point
 * scale (instead of in floating point) avoids IEEE754 drift that otherwise
 * corrupts the final rounding (confirmed against a real account: 3 flat-DEF
 * rolls of 16.20+23.15+23.15 sum to 62.499999999999996 in plain floats,
 * rounding DOWN to 62 — one off from HoYoLAB's own displayed "63", which is
 * exactly 62.5 the other way). */
const SCALE = 100;

/**
 * Finds a multiset of `rolls` tiers (repetition allowed — the same tier can
 * be rolled more than once) from the `rarity`★ `key` table whose sum,
 * rounded to that stat's own display precision (0 decimals for flat stats,
 * 1 for percentages — see `decimalsForStat`), equals `displayValue`.
 *
 * `rolls` is the TOTAL number of times this substat has been rolled,
 * including its initial appearance on the artifact — NOT HoYoLAB's raw
 * `sub_property_list[].times` field, which (confirmed empirically against a
 * real account's payload) excludes that initial roll; normalize.ts is
 * responsible for translating `times` into `rolls` (`rolls = times + 1`)
 * before calling this.
 */
export function reconstructTiers(
  rarity: 3|4|5, key: StatKey, displayValue: number, rolls: number
): (1|2|3|4)[] {
  const table = TIERS[rarity]?.[key];
  if (!table) throw new Error(`sem tabela de tier para ${rarity}★ ${key}`);
  const decimals = decimalsForStat(key);
  const scaledTable = table.map((v) => Math.round(v * SCALE));
  const targetScaled = Math.round(displayValue * 10 ** decimals);
  const matches = (sumScaled: number) => Math.round((sumScaled / SCALE) * 10 ** decimals) === targetScaled;

  const result: (1|2|3|4)[] = [];
  const dfs = (idx: number, left: number, sumScaled: number): boolean => {
    if (left === 0) return matches(sumScaled);
    for (let t = idx; t < table.length; t++) {
      result.push((t + 1) as 1|2|3|4);
      if (dfs(t, left - 1, sumScaled + scaledTable[t]!)) return true;
      result.pop();
    }
    return false;
  };
  if (!dfs(0, rolls, 0)) throw new Error(`sem combinação de ${rolls} rolls p/ ${key}=${displayValue}`);
  return [...result];
}
