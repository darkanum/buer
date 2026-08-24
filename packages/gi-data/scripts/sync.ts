// packages/gi-data/scripts/sync.ts
//
// Reads the vendored Enka `store/gi/*` JSONs from ../vendor plus the two
// hand-authored tables in ../data (property.json, weapon-type.json) and writes
// the derived catalogs (characters/weapons/artifact-sets/slot-main) to ../data.
//
// Contract: FAIL LOUDLY. If a field this script depends on is missing, or an id
// this script emits can't be cross-validated, it throws instead of writing a
// partial/best-guess file. This is the guard against source drift (Enka
// reshaping a JSON, or a game update changing an enum) silently producing wrong
// catalog data.
//
// Run: `pnpm --filter @onewash/gi-data sync` (plain `node scripts/sync.ts` —
// Node 24 strips TypeScript syntax natively, no build step needed).

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VENDOR = path.join(__dirname, '..', 'vendor');
const DATA = path.join(__dirname, '..', 'data');

function readJson(dir: string, file: string): unknown {
  const full = path.join(dir, file);
  let text: string;
  try {
    text = readFileSync(full, 'utf8');
  } catch (e) {
    throw new Error(`sync: fonte esperada ausente: ${full} (${(e as Error).message})`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`sync: JSON inválido em ${full}: ${(e as Error).message}`);
  }
}

function req<T>(value: T | undefined | null, msg: string): T {
  if (value === undefined || value === null) throw new Error(`sync: ${msg}`);
  return value;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

interface PropertyEntry { code: string; goodKey: string | null; isPercent: boolean; decimals: number }
type PropertyMap = Record<string, PropertyEntry>;

interface WeaponTypeEntry { gameCode: string; enkaInt: number; hoyolabInt: number; goodKey: string }
type WeaponTypeTable = Record<string, WeaponTypeEntry>;

const property = readJson(DATA, 'property.json') as PropertyMap;
const weaponType = readJson(DATA, 'weapon-type.json') as WeaponTypeTable;

// gameCode (e.g. "WEAPON_SWORD_ONE_HAND") -> wt_id ; enkaInt (1-5, raw Enka WeaponType) -> wt_id
const gameCodeToWtId = new Map<string, string>();
const enkaIntToWtId = new Map<number, string>();
for (const [wtId, entry] of Object.entries(weaponType)) {
  req(entry.gameCode, `weapon-type.json[${wtId}] sem gameCode`);
  req(entry.enkaInt, `weapon-type.json[${wtId}] sem enkaInt`);
  req(entry.goodKey, `weapon-type.json[${wtId}] sem goodKey`);
  gameCodeToWtId.set(entry.gameCode, wtId);
  enkaIntToWtId.set(entry.enkaInt, wtId);
}
if (gameCodeToWtId.size !== 5) throw new Error('sync: weapon-type.json deveria ter 5 entradas (SWORD/CLAYMORE/BOW/POLE/CATALYST)');

interface Locs { [textHash: string]: string }
const locsAll = readJson(VENDOR, 'locs.json') as Record<string, Locs>;
const locs = req(locsAll['en'], "locs.json sem idioma 'en'");

function resolveName(hash: unknown, ctx: string): string {
  const name = locs[String(hash)];
  return req(name, `${ctx}: NameTextMapHash ${hash} não resolve em locs.json['en']`);
}

function slugify(name: string): string {
  return name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------------------
// characters.json  (avatar_id -> { slug, rarity, weaponType, element? })
// ---------------------------------------------------------------------------

const ELEMENT_MAP: Record<string, string> = {
  Fire: 'pyro', Water: 'hydro', Ice: 'cryo', Electric: 'electro',
  Wind: 'anemo', Rock: 'geo', Grass: 'dendro',
};

// The two Traveler avatar ids ship with WeaponType/Element absent in avatars.json
// (their weapon/element are chosen at runtime, not fixed in the excel row). This
// is a known, narrow exception — not a silent partial derivation. Confirmed via
// AvatarExcelConfigData's bodyType (BODY_BOY on 10000005, i.e. Aether; BODY_GIRL
// on 10000007, i.e. Lumine) that these are the male/female Traveler respectively.
// Both always start with a sword.
const TRAVELER_OVERRIDE: Record<string, { slug: string; weaponGoodKey: string }> = {
  '10000005': { slug: 'aether', weaponGoodKey: 'sword' },
  '10000007': { slug: 'lumine', weaponGoodKey: 'sword' },
};

const QUALITY_TO_RARITY: Record<string, number> = {
  QUALITY_ORANGE: 5, QUALITY_ORANGE_SP: 5, QUALITY_PURPLE: 4,
};

interface AvatarRaw {
  Element?: string; QualityType?: string; WeaponType?: string; NameTextMapHash?: number;
}
const avatarsRaw = readJson(VENDOR, 'avatars.json') as Record<string, AvatarRaw>;

const characters: Record<string, { slug: string; rarity: number; weaponType: string; element?: string }> = {};
let skippedVariants = 0;
for (const [id, a] of Object.entries(avatarsRaw)) {
  // Enka ships costume/element-variant duplicate rows as "10000005-501" etc,
  // alongside the base numeric-id row. We only catalog the base id.
  if (id.includes('-')) { skippedVariants++; continue; }

  const override = TRAVELER_OVERRIDE[id];
  const rarity = req(QUALITY_TO_RARITY[req(a.QualityType, `avatar ${id} sem QualityType`)],
    `avatar ${id}: QualityType ${a.QualityType} desconhecido`);

  let weaponGoodKey: string;
  if (override) {
    weaponGoodKey = override.weaponGoodKey;
  } else {
    const gameCode = req(a.WeaponType, `avatar ${id} sem WeaponType (e não é um Traveler conhecido)`);
    const wtId = req(gameCodeToWtId.get(gameCode), `avatar ${id}: WeaponType ${gameCode} não mapeado em weapon-type.json`);
    weaponGoodKey = req(weaponType[wtId], `wt_id ${wtId} ausente`).goodKey;
  }

  const name = override ? override.slug.replace(/^\w/, (c) => c.toUpperCase()) : resolveName(a.NameTextMapHash, `avatar ${id}`);
  const slug = override ? override.slug : slugify(name);

  let element: string | undefined;
  const rawEl = req(a.Element, `avatar ${id} sem Element`);
  if (rawEl !== 'None') {
    element = req(ELEMENT_MAP[rawEl], `avatar ${id}: Element ${rawEl} desconhecido`);
  } else if (!override) {
    throw new Error(`avatar ${id}: Element 'None' mas não é um Traveler conhecido`);
  }

  characters[id] = { slug, rarity, weaponType: weaponGoodKey, ...(element ? { element } : {}) };
}
if (Object.keys(characters).length < 80) {
  throw new Error(`sync: só ${Object.keys(characters).length} personagens após o filtro — vendor/avatars.json mudou de formato?`);
}

// ---------------------------------------------------------------------------
// weapons.json  (weapon_id -> { slug, rarity, wt })
// ---------------------------------------------------------------------------

interface WeaponRaw { Rarity?: number; WeaponType?: number; NameTextMapHash?: number }
const weaponsRaw = readJson(VENDOR, 'weapons.json') as Record<string, WeaponRaw>;

const weapons: Record<string, { slug: string; rarity: number; wt: string }> = {};
for (const [id, w] of Object.entries(weaponsRaw)) {
  const rarity = req(w.Rarity, `weapon ${id} sem Rarity`);
  const enkaInt = req(w.WeaponType, `weapon ${id} sem WeaponType`);
  const wtId = req(enkaIntToWtId.get(enkaInt), `weapon ${id}: WeaponType ${enkaInt} não mapeado em weapon-type.json`);
  const slug = slugify(resolveName(w.NameTextMapHash, `weapon ${id}`));
  weapons[id] = { slug, rarity, wt: wtId };
}
if (Object.keys(weapons).length < 100) {
  throw new Error(`sync: só ${Object.keys(weapons).length} armas — vendor/weapons.json mudou de formato?`);
}

// ---------------------------------------------------------------------------
// artifact-sets.json  (set_id -> { slug, maxRarity, twopcNumeric })
// ---------------------------------------------------------------------------

interface RelicItemRaw { Rarity?: number; EquipType?: number; SetId?: number }
interface RelicSetRaw { Name?: number; AddProps?: Record<string, number> }
interface RelicsRaw { Items: Record<string, RelicItemRaw>; Sets: Record<string, RelicSetRaw> }
const relicsRaw = readJson(VENDOR, 'relics.json') as RelicsRaw;
req(relicsRaw.Items, 'relics.json sem Items');
req(relicsRaw.Sets, 'relics.json sem Sets');

const maxRarityBySet = new Map<number, number>();
for (const item of Object.values(relicsRaw.Items)) {
  const setId = item.SetId;
  if (!setId) continue; // SetId 0 = no set (loose relic remnants), not a real set
  const rarity = req(item.Rarity, 'relic item sem Rarity');
  maxRarityBySet.set(setId, Math.max(maxRarityBySet.get(setId) ?? 0, rarity));
}

const artifactSets: Record<string, { slug: string; maxRarity: number; twopcNumeric: boolean }> = {};
for (const [id, s] of Object.entries(relicsRaw.Sets)) {
  const slug = slugify(resolveName(s.Name, `artifact set ${id}`));
  const maxRarity = req(maxRarityBySet.get(Number(id)), `set ${id}: nenhum item em relics.json.Items referencia esse SetId`);
  // Heuristic (best-effort, per task ruling): AddProps is the ReliquarySet excel
  // config's numeric bonus (the 2pc bonus for standard 4/5★ sets, or the 1pc
  // bonus for the old single-bonus 1★-3★ sets). A non-empty AddProps means that
  // bonus is expressible as a plain FightProp add (e.g. flat ATK/DEF/HP, a %
  // stat, or an elemental DMG%). An empty AddProps means the bonus is a
  // conditional/skill-based effect with no simple stat representation (e.g.
  // Noblesse Oblige's burst-dmg buff, Gambler's dmg-vs-non-elite). This is not
  // 100% precise (a couple of legacy sets carry a non-representative numeric
  // placeholder here) but is the best signal available from vendored data.
  const twopcNumeric = Object.keys(req(s.AddProps, `set ${id} sem AddProps`)).length > 0;
  artifactSets[id] = { slug, maxRarity, twopcNumeric };
}
if (Object.keys(artifactSets).length < 50) {
  throw new Error(`sync: só ${Object.keys(artifactSets).length} artifact sets — vendor/relics.json mudou de formato?`);
}

// ---------------------------------------------------------------------------
// slot-main.json  (slot 1-5 -> allowed main-stat property_type ids)
// ---------------------------------------------------------------------------
//
// The vendored files do NOT encode this rule directly: relics.json's per-item
// EquipType is Enka's internal grouping enum (not the HoYoLAB `pos` slot
// convention @onewash/core already uses — see packages/core/src/canon.ts), and
// relic_levels.json only has per-rarity substat roll magnitudes, not which main
// stats are selectable per slot. This table is the fixed, unchanged-since-launch
// game design rule (flower=HP/plume=ATK are single-option; sands/goblet/circlet
// each offer a fixed menu), authored directly per the task ruling's fallback —
// but every property_type id below is still cross-validated against
// data/property.json below, so a future property.json edit that drops one of
// these ids fails the sync loudly instead of silently shipping a bad slot rule.
//
// slot 1 = flower (HP flat only)
// slot 2 = plume (ATK flat only)
// slot 3 = sands (HP%/ATK%/DEF%/EM/ER%)
// slot 4 = goblet (HP%/ATK%/DEF%/EM/Physical DMG%/elemental DMG%)
// slot 5 = circlet (HP%/ATK%/DEF%/EM/CritRate%/CritDMG%/Healing Bonus%)
const SLOT_MAIN_RULES: Record<string, number[]> = {
  '1': [2],
  '2': [5],
  '3': [3, 6, 9, 28, 23],
  '4': [3, 6, 9, 28, 30, 40, 41, 42, 43, 44, 45, 46],
  '5': [3, 6, 9, 28, 20, 22, 26],
};
for (const [slot, ids] of Object.entries(SLOT_MAIN_RULES)) {
  for (const id of ids) {
    req(property[String(id)], `slot-main[${slot}]: property_type ${id} não existe em property.json`);
  }
}
const slotMain = SLOT_MAIN_RULES;

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

function write(file: string, data: unknown) {
  writeFileSync(path.join(DATA, file), JSON.stringify(data, null, 2) + '\n', 'utf8');
}

write('characters.json', characters);
write('weapons.json', weapons);
write('artifact-sets.json', artifactSets);
write('slot-main.json', slotMain);

console.log(
  `sync: ok — characters=${Object.keys(characters).length} (variantes ignoradas=${skippedVariants}), ` +
  `weapons=${Object.keys(weapons).length}, artifact-sets=${Object.keys(artifactSets).length}, ` +
  `slot-main=${Object.keys(slotMain).length} slots`
);
