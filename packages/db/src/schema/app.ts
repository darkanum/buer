// Espelho Drizzle das tabelas `app.*` — spec §5.2-§5.8.
// DDL source of truth: drizzle/0000_init.sql (transcrição literal da spec, incluindo
// a partição de app.raw_observation, a coluna gerada de app.character_state e os
// índices §5.8 que o Drizzle não consegue expressar aqui, ex. INCLUDE columns).

import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { character as catalogCharacter, property as catalogProperty, version as catalogVersion, weapon as catalogWeapon } from './catalog.js';
import { bytea } from './custom-types.js';

export const app = pgSchema('app');

// --- 5.1 (seed vive na migration) / versionamento do doc normalizado ---

export const docSchema = app.table('doc_schema', {
  docSchema: smallint('doc_schema').primaryKey(),
  description: text('description').notNull(),
  introducedAt: timestamp('introduced_at', { withTimezone: true }).notNull().defaultNow(),
  retiredAt: timestamp('retired_at', { withTimezone: true }), // NULL = geração viva
  canonSpec: text('canon_spec').notNull(),
});

// --- 5.2 Contas e credencial ---

export const account = app.table(
  'account',
  {
    accountId: bigint('account_id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
    ownerId: text('owner_id').notNull(), // user do Better Auth
    gameUid: text('game_uid').notNull(),
    region: text('region').notNull(),
    nickname: text('nickname'),
    isChosen: boolean('is_chosen').notNull().default(false), // multi-conta: seleção explícita
    lang: text('lang').notNull().default('pt-pt'),
    activeDocSchema: smallint('active_doc_schema')
      .notNull()
      .references(() => docSchema.docSchema),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.gameUid, t.region), check('account_lang_check', sql`${t.lang} <> 'pt-br'`)],
);

// Credencial separada, com estado explícito de ciclo de vida. O valor cifrado
// nunca é selecionado por queries de leitura do site.
export const credential = app.table(
  'credential',
  {
    accountId: bigint('account_id', { mode: 'bigint' })
      .primaryKey()
      .references(() => account.accountId, { onDelete: 'cascade' }),
    cookieSet: text('cookie_set').notNull(), // 'ltoken_v2+ltuid_v2'
    sealed: bytea('sealed').notNull(), // envelope-encrypted; chave fora do Postgres
    kmsKeyId: text('kms_key_id').notNull(),
    state: text('state').notNull(),
    canRefresh: boolean('can_refresh').notNull().default(false),
    lastOkAt: timestamp('last_ok_at', { withTimezone: true }),
    lastFailure: text('last_failure'), // retcode textual: '10001' | '10102' | '1034'
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('credential_state_check', sql`${t.state} IN ('active','expired','revoked','needs_repair')`)],
);

// --- 5.3 Raw — identidade separada de observação ---
//
// app.raw_object: NÃO particionada, PK simples raw_sha256 — alvo da FK de snapshot.
export const rawObject = app.table(
  'raw_object',
  {
    rawSha256: bytea('raw_sha256').primaryKey(),
    byteLen: integer('byte_len').notNull(),
    codec: text('codec').notNull(),
    objectKey: text('object_key'), // 'r2://buer-raw/ab/cd/<hex>.json.zst'; NULL = purgado
    purgedAt: timestamp('purged_at', { withTimezone: true }),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('raw_object_codec_check', sql`${t.codec} IN ('zstd','gzip','none')`),
    check('raw_object_object_key_check', sql`${t.objectKey} IS NOT NULL OR ${t.purgedAt} IS NOT NULL`),
  ],
);

// app.raw_observation: PARTICIONADA por RANGE(captured_at) na migration SQL — é o
// ponto que a naive translation não executa (unique constraint precisa incluir a
// coluna de partição). SEM FK (integridade fica na aplicação). Este espelho Drizzle
// modela colunas + PK composta apenas para leitura tipada; a estrutura de partições
// (PARTITION BY, a partição concreta raw_observation_2026m09, ALTER ... SET STORAGE
// EXTERNAL) só existe em drizzle/0000_init.sql.
export const rawObservation = app.table(
  'raw_observation',
  {
    rawSha256: bytea('raw_sha256').notNull(),
    accountId: bigint('account_id', { mode: 'bigint' }).notNull(),
    endpoint: text('endpoint').notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
    inlineBytes: bytea('inline_bytes'), // NULL em produção (bytes vão pro R2)
  },
  (t) => [primaryKey({ columns: [t.rawSha256, t.capturedAt] })],
);

// --- 5.4 Snapshot ---

export const snapshot = app.table(
  'snapshot',
  {
    snapshotId: bigint('snapshot_id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
    accountId: bigint('account_id', { mode: 'bigint' })
      .notNull()
      .references(() => account.accountId),
    takenAt: timestamp('taken_at', { withTimezone: true }).notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
    idempotencyKey: text('idempotency_key'),
    parserVersion: integer('parser_version').notNull(),
    docSchema: smallint('doc_schema')
      .notNull()
      .references(() => docSchema.docSchema),
    catalogVersion: text('catalog_version').references(() => catalogVersion.catalogVersion),
    lang: text('lang').notNull(),
    rawSha256: bytea('raw_sha256').references(() => rawObject.rawSha256),
    accountHash: bytea('account_hash').notNull(), // sha256 do conjunto ordenado (char_key, content_hash)
    changedChars: smallint('changed_chars').notNull().default(0),
    observedChars: smallint('observed_chars').notNull(),
    cliVersion: text('cli_version'),
  },
  (t) => [
    unique().on(t.accountId, t.takenAt),
    unique().on(t.accountId, t.idempotencyKey),
    index('snapshot_account_time').on(t.accountId, t.takenAt.desc()),
    index('snapshot_reparse').on(t.parserVersion).where(sql`${t.rawSha256} IS NOT NULL`),
  ],
);

// --- 5.5 Estado de personagem — content-addressed ---
//
// content_hash é `GENERATED ALWAYS AS (sha256(doc_canon)) STORED` no Postgres
// (sha256(bytea) é IMMUTABLE desde PG 11). drizzle-orm@0.45.2 EXPÕE
// `.generatedAlwaysAs(sql`...`)` no column builder (ver pg-core/columns/common.d.ts),
// então isto é modelado como coluna gerada de fato — InferInsertModel exclui
// contentHash, então um INSERT que tente setá-la não passa o typecheck.
// DDL source of truth: drizzle/0000_init.sql.
export const characterState = app.table(
  'character_state',
  {
    stateId: bigint('state_id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
    accountId: bigint('account_id', { mode: 'bigint' })
      .notNull()
      .references(() => account.accountId),
    charKey: text('char_key')
      .notNull()
      .references(() => catalogCharacter.charKey),
    docSchema: smallint('doc_schema')
      .notNull()
      .references(() => docSchema.docSchema),
    // FONTE DA VERDADE: os bytes exatos hasheados (jsonb não serve como forma canônica).
    docCanon: bytea('doc_canon').notNull(),
    contentHash: bytea('content_hash').generatedAlwaysAs(sql`sha256(doc_canon)`),
    charLevel: smallint('char_level').notNull(),
    ascension: smallint('ascension').notNull(),
    constellation: smallint('constellation').notNull(),
    weaponId: integer('weapon_id').references(() => catalogWeapon.weaponId),
    weaponRefine: smallint('weapon_refine'),
    firstSeen: timestamp('first_seen', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.accountId, t.docSchema, t.contentHash),
    check('character_state_constellation_check', sql`${t.constellation} BETWEEN 0 AND 6`),
    check('character_state_weapon_refine_check', sql`${t.weaponRefine} BETWEEN 1 AND 5`),
    index('state_filter').on(t.accountId, t.charKey, t.charLevel.desc()),
  ],
);

// Grupos derivados (base/selected/extra/element), fora do hash. Discriminador
// prop_group é OBRIGATÓRIO na PK — sem ele duas linhas colidiriam por (state_id, prop_id).
export const stateStat = app.table(
  'state_stat',
  {
    stateId: bigint('state_id', { mode: 'bigint' })
      .notNull()
      .references(() => characterState.stateId, { onDelete: 'cascade' }),
    propGroup: smallint('prop_group').notNull(), // 1=base|2=selected|3=extra|4=element
    propId: smallint('prop_id')
      .notNull()
      .references(() => catalogProperty.propId),
    baseV: numeric('base_v'),
    addV: numeric('add_v'),
    finalV: numeric('final_v'),
  },
  (t) => [
    primaryKey({ columns: [t.stateId, t.propGroup, t.propId] }),
    check('state_stat_prop_group_check', sql`${t.propGroup} IN (1,2,3,4)`),
  ],
);

// --- 5.6 Timeline — uma linha por mudança ---
//
// Overlap no passado é prevenido por construção via advisory lock por conta em
// cada caminho de escrita (SELECT pg_advisory_xact_lock(hashtextextended(...))),
// não por EXCLUDE gist (custo de UPDATE non-HOT). Ver drizzle/0000_init.sql.
export const characterTimeline = app.table(
  'character_timeline',
  {
    accountId: bigint('account_id', { mode: 'bigint' }).notNull(),
    charKey: text('char_key').notNull(),
    docSchema: smallint('doc_schema').notNull(),
    validFrom: timestamp('valid_from', { withTimezone: true }).notNull(),
    validTo: timestamp('valid_to', { withTimezone: true }), // NULL = intervalo aberto
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(), // distingue "não mudou" de "não observado"
    closedBy: text('closed_by').notNull().default('change'),
    stateId: bigint('state_id', { mode: 'bigint' })
      .notNull()
      .references(() => characterState.stateId),
    fromSnapshot: bigint('from_snapshot', { mode: 'bigint' })
      .notNull()
      .references(() => snapshot.snapshotId),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.charKey, t.docSchema, t.validFrom] }),
    check('character_timeline_closed_by_check', sql`${t.closedBy} IN ('change','open','not_observed','superseded')`),
    // Garante no máximo um intervalo aberto por personagem (substitui EXCLUDE gist).
    uniqueIndex('character_timeline_one_open').on(t.accountId, t.charKey, t.docSchema).where(sql`${t.validTo} IS NULL`),
    index('timeline_open').on(t.accountId, t.charKey).where(sql`${t.validTo} IS NULL`),
    index('timeline_state').on(t.stateId),
    index('timeline_char_now').on(t.charKey, t.accountId).where(sql`${t.validTo} IS NULL`),
    // timeline_asof usa INCLUDE (char_key, valid_to, state_id), que esta versão do
    // drizzle-orm (0.45.2 pg-core) não expressa em IndexBuilder — só existe em
    // drizzle/0000_init.sql.
  ],
);

// --- 5.7 Eventos — projeção descartável (nunca migrada; reconstrói de timeline+states) ---

export const changeEvent = app.table(
  'change_event',
  {
    eventId: bigint('event_id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
    accountId: bigint('account_id', { mode: 'bigint' }).notNull(),
    charKey: text('char_key').notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(), // instante de OBSERVAÇÃO
    windowFrom: timestamp('window_from', { withTimezone: true }).notNull(), // resolução real do evento
    detectedIn: bigint('detected_in', { mode: 'bigint' })
      .notNull()
      .references(() => snapshot.snapshotId),
    kind: text('kind').notNull(), // level_up|ascension|constellation|talent_up|weapon_change|weapon_refine|artifact_equip|artifact_upgrade|artifact_swap
    payload: jsonb('payload').notNull(),
  },
  (t) => [index('event_feed').on(t.accountId, t.observedAt.desc())],
);
