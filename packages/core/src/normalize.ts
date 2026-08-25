import { charKey } from './keys.js';
import { reconstructTiers, type StatKey } from './substat.js';
import { propKey } from './properties.js';
import { contentHash, artifactFingerprint, accountHash,
         type CharacterDoc, type CanonArtifact } from './canon.js';

export interface PromotedCols {
  charLevel: number; ascension: number; constellation: number;
  weaponId: number; weaponRefine: number;
}
export interface NormalizedSnapshot {
  characters: { charKey: string; doc: CharacterDoc; contentHash: string; promoted: PromotedCols }[];
  accountHash: string;
}

/**
 * `reconstructTiers`, degraded to a single best-effort tier (never throws)
 * instead of failing the whole character, for the cases it can't handle:
 *  - no verified roll table exists yet for this artifact's rarity — today
 *    that's anything but 5★ (see substat.ts's TIERS). Real accounts carry
 *    1-4★ "fodder" artifacts on low-priority/benched characters, for which
 *    no verified tier table exists;
 *  - the rarity/stat DOES have a table but no exact roll combination
 *    reproduces the displayed value (a safety net — not expected to trigger
 *    for 5★ substats now that `rolls` accounts for HoYoLAB's off-by-one
 *    `times` field, see below, but kept rather than a hard throw).
 * Tier `1` is a deliberately conservative placeholder, not a real
 * reconstruction, for exactly these degraded cases — every other substat
 * still gets its exact tier from `reconstructTiers`.
 */
function bestEffortTier(rarity: number, key: StatKey, displayValue: number, rolls: number): 1|2|3|4 {
  try {
    const tiers = reconstructTiers(rarity as 3|4|5, key, displayValue, rolls);
    return tiers[tiers.length - 1]!;
  } catch {
    return 1;
  }
}

export function normalize(raw: { list: unknown; detail: unknown }): NormalizedSnapshot {
  const detail = (raw.detail as any)?.list ?? [];
  const characters = detail.map((d: any) => {
    const el = d.base?.element?.toLowerCase();
    const key = charKey(d.base.id, el);
    const artifacts: CanonArtifact[] = (d.relics ?? []).map((r: any) => {
      const subs = (r.sub_property_list ?? []).map((s: any): [number, number, 1|2|3|4] => {
        const statKey = propKey(s.property_type);
        const value = parseFloat(String(s.value).replace('%', ''));
        // HoYoLAB's raw `times` counts rolls AFTER a substat's initial
        // appearance, not the total — confirmed empirically against a real
        // account's payload (e.g. a flat-HP sub with times:0 is a single
        // roll; times:2 is three rolls — every real 5★ substat in that
        // account only reconstructs exactly once this +1 is applied).
        const rolls = s.times + 1;
        const tier = bestEffortTier(r.rarity, statKey, value, rolls);
        return [s.property_type, value, tier];
      });
      const base = { slot: r.pos as 1|2|3|4|5, set: r.set.id, lvl: r.level, rarity: r.rarity as 3|4|5,
        main: [r.main_property.property_type, parseFloat(String(r.main_property.value))] as [number,number],
        subs };
      return { ...base, fp: artifactFingerprint(base) };
    });
    const doc: CharacterDoc = {
      v: 1, char: key, lvl: d.base.level, asc: d.base.promote_level ?? 0,
      cons: d.base.actived_constellation_num ?? 0, friend: d.base.fetter ?? 0,
      weapon: { id: d.weapon.id, lvl: d.weapon.level, promote: d.weapon.promote_level ?? 0,
                refine: d.weapon.affix_level ?? 1 },
      // Real HoYoLAB payloads name this field `level`, not `level_current`
      // (confirmed against a real account: 0/407 skill entries had
      // `level_current`, all 407 had `level`) — `level_current` is kept as a
      // fallback for older/synthetic fixtures that used it.
      talents: (d.skills ?? []).filter((s: any) => s.skill_type === 1)
                 .map((s: any): [number, number] => [s.skill_id, s.level_current ?? s.level]),
      artifacts,
    };
    return { charKey: key, doc, contentHash: contentHash(doc),
      promoted: { charLevel: doc.lvl, ascension: doc.asc, constellation: doc.cons,
        weaponId: doc.weapon.id, weaponRefine: doc.weapon.refine } };
  });
  return { characters, accountHash: accountHash(characters.map((c: any) => ({ charKey: c.charKey, contentHash: c.contentHash }))) };
}
