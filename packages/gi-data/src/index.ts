// packages/gi-data/src/index.ts
//
// Typed loaders over the data generated/authored under ../data. See
// ../scripts/sync.ts for how characters.json / weapons.json /
// artifact-sets.json / slot-main.json are derived from ../vendor, and
// ../data/property.json + ../data/weapon-type.json for the two hand-authored
// tables (see their provenance notes in scripts/sync.ts's header comments).

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, '..', 'data');

function readData<T>(file: string): T {
  return JSON.parse(readFileSync(path.join(DATA, file), 'utf8')) as T;
}

/** HoYoLAB/game `property_type` (FightProp) id → its meaning. */
export interface PropertyEntry {
  code: string;
  goodKey: string | null;
  isPercent: boolean;
  decimals: number;
}
export type PropertyMap = Record<number, PropertyEntry>;

/** One of the 5 weapon type encodings (internal wt_id == Enka's raw WeaponType int, 1-5). */
export interface WeaponTypeEntry {
  gameCode: string;
  enkaInt: number;
  hoyolabInt: number;
  goodKey: string;
}
export interface WeaponTypeMap {
  hoyolabToWt: Record<number, WeaponTypeEntry>;
}

export interface CharacterEntry {
  slug: string;
  rarity: number;
  weaponType: string;
  element?: string;
}
export type CharacterMap = Record<number, CharacterEntry>;

export interface WeaponEntry {
  slug: string;
  rarity: number;
  /** internal wt_id — join against loadWeaponTypeMap()'s entries' `enkaInt`. */
  wt: string;
}
export type WeaponMap = Record<number, WeaponEntry>;

export interface ArtifactSetEntry {
  slug: string;
  maxRarity: number;
  twopcNumeric: boolean;
}
export type ArtifactSetMap = Record<number, ArtifactSetEntry>;

/** slot (1=flower,2=plume,3=sands,4=goblet,5=circlet) -> allowed main-stat property_type ids. */
export type SlotMainMap = Record<number, number[]>;

export function loadProperty(): PropertyMap {
  return readData<PropertyMap>('property.json');
}

export function loadWeaponTypeMap(): WeaponTypeMap {
  const table = readData<Record<string, WeaponTypeEntry>>('weapon-type.json');
  const hoyolabToWt: Record<number, WeaponTypeEntry> = {};
  for (const entry of Object.values(table)) {
    hoyolabToWt[entry.hoyolabInt] = entry;
  }
  return { hoyolabToWt };
}

export function loadCharacters(): CharacterMap {
  return readData<CharacterMap>('characters.json');
}

export function loadWeapons(): WeaponMap {
  return readData<WeaponMap>('weapons.json');
}

export function loadArtifactSets(): ArtifactSetMap {
  return readData<ArtifactSetMap>('artifact-sets.json');
}

export function loadSlotMain(): SlotMainMap {
  return readData<SlotMainMap>('slot-main.json');
}

/** Original image URL (HoYoLAB/Enka CDN) -> mirrored R2 object key. Written
 * by ../scripts/assets-sync.ts (`pnpm --filter @buer/gi-data assets:sync`). */
export type AssetManifest = Record<string, string>;

/**
 * Reads data/assets.json. Returns `{}` (never throws) when the file doesn't
 * exist yet — the normal state until `assets:sync` has actually run against
 * live R2 credentials (never the case in dev/CI); a hash simply isn't
 * mirrored yet, which callers (apps/web's render.ts) are expected to treat
 * as "fall back to the original URL", not as an error.
 */
export function loadAssetManifest(): AssetManifest {
  const file = path.join(DATA, 'assets.json');
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, 'utf8')) as AssetManifest;
}
