// Espelho Drizzle das tabelas `catalog.*` — spec §5.1.
// DDL source of truth: drizzle/0000_init.sql (transcrição literal da spec).
// Nenhuma coluna de nome/descrição/ícone aqui: isso vive em @buer/gi-data, por slug.

import { sql } from 'drizzle-orm';
import { boolean, check, integer, pgSchema, primaryKey, smallint, text, timestamp, unique } from 'drizzle-orm/pg-core';

export const catalog = pgSchema('catalog');

export const version = catalog.table('version', {
  catalogVersion: text('catalog_version').primaryKey(),
  gameVersion: text('game_version').notNull(),
  sourceSha: text('source_sha').notNull(),
  importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
});

// property_type (prop_id) é a ÚNICA chave confiável de identidade de stat.
export const property = catalog.table('property', {
  propId: smallint('prop_id').primaryKey(),
  code: text('code').notNull().unique(),
  goodKey: text('good_key'),
  isPercent: boolean('is_percent').notNull(),
  decimals: smallint('decimals').notNull().default(1),
  isDerived: boolean('is_derived').notNull().default(false),
});

// char_key composto: '10000089' | '10000005:pyro' (Traveler).
export const character = catalog.table(
  'character',
  {
    charKey: text('char_key').primaryKey(),
    avatarId: integer('avatar_id').notNull(),
    element: text('element'),
    slug: text('slug').notNull().unique(),
    // Enum interno (ver catalog.weapon_type). SEM FK — assim na DDL original (§5.1).
    weaponType: smallint('weapon_type'),
    rarity: smallint('rarity'),
    provisional: boolean('provisional').notNull().default(false),
    firstSeenIn: text('first_seen_in').references(() => version.catalogVersion),
  },
  (t) => [unique().on(t.avatarId, t.element)],
);

// Três encodings de weapon type na natureza; tradução explícita.
export const weaponType = catalog.table('weapon_type', {
  wtId: smallint('wt_id').primaryKey(),
  gameCode: text('game_code').notNull().unique(),
  enkaInt: smallint('enka_int').notNull().unique(),
  hoyolabInt: smallint('hoyolab_int').notNull().unique(),
  goodKey: text('good_key').notNull(),
});

export const weapon = catalog.table(
  'weapon',
  {
    weaponId: integer('weapon_id').primaryKey(),
    slug: text('slug').notNull().unique(),
    wtId: smallint('wt_id').references(() => weaponType.wtId),
    rarity: smallint('rarity'),
    mainProp: smallint('main_prop').references(() => property.propId),
    subProp: smallint('sub_prop').references(() => property.propId),
    // BasePromote tem 5 OU 7 entradas; indexar por len-1 clampado, nunca por constante.
    promoteLen: smallint('promote_len').notNull(),
  },
  (t) => [check('weapon_promote_len_check', sql`${t.promoteLen} IN (5,7)`)],
);

export const artifactSet = catalog.table('artifact_set', {
  setId: integer('set_id').primaryKey(),
  slug: text('slug').notNull().unique(),
  maxRarity: smallint('max_rarity'),
  // ~21,5% dos sets têm 2pc NÃO numérico → exige código, não dado.
  twopcNumeric: boolean('twopc_numeric').notNull(),
  fourpcNumeric: boolean('fourpc_numeric').notNull().default(false),
});

// Main stats válidos por slot (relic_levels contém props que não são main stats selecionáveis).
export const slotMainAllowed = catalog.table(
  'slot_main_allowed',
  {
    slot: smallint('slot').notNull(),
    propId: smallint('prop_id')
      .notNull()
      .references(() => property.propId),
  },
  (t) => [
    primaryKey({ columns: [t.slot, t.propId] }),
    check('slot_main_allowed_slot_check', sql`${t.slot} BETWEEN 1 AND 5`),
  ],
);
