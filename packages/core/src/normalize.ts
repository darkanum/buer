import { charKey } from './keys.js';
import { reconstructTiers, type StatKey } from './substat.js';
import { contentHash, artifactFingerprint, accountHash,
         type CharacterDoc, type CanonArtifact } from './canon.js';

// property_type do HoYoLAB → StatKey canônico (subset; gi-data gera completo)
const PROP: Record<number, StatKey> = {
  2: 'atk', 5: 'hp', 7: 'def', 20: 'critRate_', 22: 'critDMG_', 23: 'enerRech_',
  28: 'eleMas', 30: 'physical_dmg_', 40: 'pyro_dmg_', 42: 'hydro_dmg_',
  /* ...preencher via gi-data no Marco 6... */
};
const propKey = (id: number): StatKey => {
  const k = PROP[id]; if (!k) throw new Error(`property_type desconhecido: ${id}`); return k;
};

export interface PromotedCols {
  charLevel: number; ascension: number; constellation: number;
  weaponId: number; weaponRefine: number;
}
export interface NormalizedSnapshot {
  characters: { charKey: string; doc: CharacterDoc; contentHash: string; promoted: PromotedCols }[];
  accountHash: string;
}

export function normalize(raw: { list: unknown; detail: unknown }): NormalizedSnapshot {
  const detail = (raw.detail as any)?.list ?? [];
  const characters = detail.map((d: any) => {
    const el = d.base?.element?.toLowerCase();
    const key = charKey(d.base.id, el);
    const artifacts: CanonArtifact[] = (d.relics ?? []).map((r: any) => {
      const subs = (r.sub_property_list ?? []).map((s: any): [number, number, 1|2|3|4] => {
        const key = propKey(s.property_type);
        const value = parseFloat(String(s.value).replace('%', ''));
        const tiers = reconstructTiers(r.rarity, key, value, s.times);
        return [s.property_type, value, tiers[tiers.length - 1]!];
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
      talents: (d.skills ?? []).filter((s: any) => s.skill_type === 1)
                 .map((s: any): [number, number] => [s.skill_id, s.level_current]),
      artifacts,
    };
    return { charKey: key, doc, contentHash: contentHash(doc),
      promoted: { charLevel: doc.lvl, ascension: doc.asc, constellation: doc.cons,
        weaponId: doc.weapon.id, weaponRefine: doc.weapon.refine } };
  });
  return { characters, accountHash: accountHash(characters.map((c: any) => ({ charKey: c.charKey, contentHash: c.contentHash }))) };
}
