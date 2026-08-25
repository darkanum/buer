// Single source of truth, inside @buer/core, for HoYoLAB/game `property_type`
// (FightProp) ids. Backed by @buer/gi-data's data/property.json, which
// already encodes the correct/complete FightProp scheme (confirmed against a
// real HoYoLAB account's own `detail.property_map`: every id normalize()
// meets on real artifact main/sub stats — 2,3,5,6,8,9,20,22,23,26,28,30,40-46
// — resolves there). Centralizing the lookup here means normalize.ts
// (id -> StatKey) and canon.ts (id -> display decimals) can never drift from
// each other or from gi-data — there is exactly one hand-authored table
// (gi-data's), not a second guessed one living in @buer/core.
import { loadProperty, type PropertyMap } from '@buer/gi-data';
import type { StatKey } from './substat.js';

const PROPERTY_MAP: PropertyMap = loadProperty();

/**
 * `property_type` id -> canonical StatKey, for artifact main/sub stats.
 * Throws for an id gi-data doesn't know, or one with no `goodKey` (the
 * base-stat ids 1/4/7/10 — HP/ATK/DEF/Speed "base" values that never appear
 * as an artifact main/sub stat) — same fail-fast contract the old
 * normalize.ts-local `propKey` had.
 */
export function propKey(id: number): StatKey {
  const entry = PROPERTY_MAP[id];
  if (!entry || !entry.goodKey) throw new Error(`property_type desconhecido: ${id}`);
  return entry.goodKey as StatKey;
}

/**
 * `property_type` id -> display decimals (0 = flat/integer stat, e.g. flat
 * HP/ATK/DEF/EM; 1 = percentage stat). Used by canon.ts to format each
 * artifact main/sub value at ITS OWN precision instead of a blanket
 * `toFixed(1)` that corrupts flat integer values (e.g. flat HP "269"
 * becoming "269.0", which then fails to round-trip against HoYoLAB's own
 * displayed integer).
 *
 * Falls back to 1 decimal (the more conservative of the two — it never
 * discards a real fractional digit) for an id gi-data doesn't recognize.
 * Should not happen in practice: every id that reaches canon.ts already went
 * through `propKey` above during normalize(), which throws first.
 */
export function decimalsForId(id: number): number {
  return PROPERTY_MAP[id]?.decimals ?? 1;
}

const DECIMALS_BY_GOOD_KEY: Record<string, number> = {};
for (const entry of Object.values(PROPERTY_MAP)) {
  if (entry.goodKey) DECIMALS_BY_GOOD_KEY[entry.goodKey] = entry.decimals;
}

/**
 * StatKey -> display decimals — same source as `decimalsForId`, indexed by
 * `goodKey` instead of the numeric id, for substat.ts's `reconstructTiers`
 * (which only ever sees the StatKey, never the raw property_type id).
 * Falls back to the StatKey-naming convention (percentages end in `_`) for
 * any StatKey gi-data's table doesn't cover, so a hypothetical StatKey with
 * no matching FightProp entry still gets a sane precision.
 */
export function decimalsForStat(key: StatKey): number {
  return DECIMALS_BY_GOOD_KEY[key] ?? (key.endsWith('_') ? 1 : 0);
}
