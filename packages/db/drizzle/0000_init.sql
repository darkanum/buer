-- Buer — initial schema (catalog + app), hand-authored.
--
-- This file is the DDL source of truth (see Task 3.1 brief / design spec §5).
-- It is transcribed verbatim from docs/superpowers/specs/2026-08-24-onewash-design.md
-- §5.1–§5.11, with one structural fix already baked into the spec's own DDL
-- (§5.3): app.raw_object (identity, not partitioned) is split from
-- app.raw_observation (observations, partitioned by RANGE(captured_at)) so that
-- the PARTITION BY table's PK can include the partitioning column while
-- app.snapshot.raw_sha256 still has a non-partitioned FK target.
--
-- Not run in CI; drizzle.config.ts declares DATABASE_URL_DIRECT for it.

-- ============================================================================
-- §5.1 — Versionamento e catálogo
-- ============================================================================

CREATE SCHEMA catalog;
CREATE SCHEMA app;

-- Versionamento do SCHEMA NORMALIZADO. Registro explícito, não constante no código.
CREATE TABLE app.doc_schema (
  doc_schema     smallint PRIMARY KEY,
  description    text        NOT NULL,
  introduced_at  timestamptz NOT NULL DEFAULT now(),
  retired_at     timestamptz,                -- NULL = geração viva
  canon_spec     text        NOT NULL        -- hash/tag do spec de canonicalização
);
INSERT INTO app.doc_schema VALUES (1, 'v1: estado possuído, sem stats derivados', now(), NULL, 'canon-1');

CREATE TABLE catalog.version (
  catalog_version text PRIMARY KEY,           -- '7.0.0'
  game_version    text NOT NULL,
  source_sha      text NOT NULL,              -- SHA de commit do dataset (pinning)
  imported_at     timestamptz NOT NULL DEFAULT now()
);

-- property_type é a ÚNICA chave confiável de identidade de stat (name/filter_name não distinguem 1 vs 2)
CREATE TABLE catalog.property (
  prop_id     smallint PRIMARY KEY,
  code        text     NOT NULL UNIQUE,       -- FIGHT_PROP_*
  good_key    text,                           -- 'hp_', 'critDMG_' ... (dialeto GOOD)
  is_percent  boolean  NOT NULL,
  decimals    smallint NOT NULL DEFAULT 1,    -- contrato de canonicalização numérica
  is_derived  boolean  NOT NULL DEFAULT false -- true = fora do hash (stats derivados)
);

-- char_key composto: id numérico sozinho NÃO resolve o Traveler em fonte nenhuma
CREATE TABLE catalog.character (
  char_key      text    PRIMARY KEY,          -- '10000089' | '10000005:pyro'
  avatar_id     integer NOT NULL,
  element       text,                         -- NULL para não-Traveler
  slug          text    NOT NULL UNIQUE,      -- chave do bundle i18n
  weapon_type   smallint,                     -- enum INTERNO (ver catalog.weapon_type)
  rarity        smallint,
  provisional   boolean NOT NULL DEFAULT false, -- inserido pelo ingest, sem entrada no bundle
  first_seen_in text REFERENCES catalog.version,
  UNIQUE (avatar_id, element)
);

-- TRÊS encodings de weapon type na natureza (string do jogo, int 1-5 do Enka,
-- int 1/10/11/12/13 do HoYoLAB). Tradução explícita; nada de conversão implícita.
CREATE TABLE catalog.weapon_type (
  wt_id        smallint PRIMARY KEY,          -- enum interno
  game_code    text     NOT NULL UNIQUE,      -- WEAPON_SWORD_ONE_HAND
  enka_int     smallint NOT NULL UNIQUE,      -- 1..5
  hoyolab_int  smallint NOT NULL UNIQUE,      -- 1,10,11,12,13
  good_key     text     NOT NULL
);

CREATE TABLE catalog.weapon (
  weapon_id   integer PRIMARY KEY,
  slug        text    NOT NULL UNIQUE,
  wt_id       smallint REFERENCES catalog.weapon_type,
  rarity      smallint,
  main_prop   smallint REFERENCES catalog.property,
  sub_prop    smallint REFERENCES catalog.property,
  -- BasePromote tem 5 OU 7 entradas; indexar por len-1 clampado, nunca por constante
  promote_len smallint NOT NULL CHECK (promote_len IN (5,7))
);

CREATE TABLE catalog.artifact_set (
  set_id         integer PRIMARY KEY,
  slug           text    NOT NULL UNIQUE,     -- 'MarechausseeHunter'
  max_rarity     smallint,
  -- ~21,5% dos sets têm 2pc NÃO numérico → exige código, não dado
  twopc_numeric  boolean NOT NULL,
  fourpc_numeric boolean NOT NULL DEFAULT false
);

-- Main stats válidos por slot. Necessário porque relic_levels contém props que NÃO são
-- main stats selecionáveis (DEF flat, Pyro RES) e iterar as chaves gera goblets inválidos.
CREATE TABLE catalog.slot_main_allowed (
  slot    smallint NOT NULL CHECK (slot BETWEEN 1 AND 5),
  prop_id smallint NOT NULL REFERENCES catalog.property,
  PRIMARY KEY (slot, prop_id)
);

-- Nenhuma coluna de nome, descrição, efeito ou ícone em catalog.* — isso vive no
-- bundle @buer/gi-data, indexado por slug.

-- ============================================================================
-- §5.2 — Contas e credencial
-- ============================================================================

CREATE TABLE app.account (
  account_id  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id    text        NOT NULL,           -- user do Better Auth
  game_uid    text        NOT NULL,
  region      text        NOT NULL,           -- os_usa|os_euro|os_asia|os_cht
  nickname    text,
  is_chosen   boolean     NOT NULL DEFAULT false,  -- multi-conta: seleção explícita
  lang        text        NOT NULL DEFAULT 'pt-pt' CHECK (lang <> 'pt-br'),
  active_doc_schema smallint NOT NULL REFERENCES app.doc_schema,  -- versão POR CONTA
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_uid, region)
);

-- Credencial separada, com estado explícito de ciclo de vida.
-- O valor cifrado nunca é selecionado por queries de leitura do site.
CREATE TABLE app.credential (
  account_id   bigint PRIMARY KEY REFERENCES app.account ON DELETE CASCADE,
  cookie_set   text   NOT NULL,              -- 'ltoken_v2+ltuid_v2'
  sealed       bytea  NOT NULL,              -- envelope-encrypted; chave fora do Postgres
  kms_key_id   text   NOT NULL,
  state        text   NOT NULL CHECK (state IN ('active','expired','revoked','needs_repair')),
  can_refresh  boolean NOT NULL DEFAULT false,
  last_ok_at   timestamptz,
  last_failure text,                          -- retcode textual: '10001' | '10102' | '1034'
  rotated_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- §5.3 — Raw: identidade separada de observação
--
-- O esboço ingênuo não executa: PRIMARY KEY (raw_sha256) + PARTITION BY RANGE
-- (captured_at) falha ("unique constraint on partitioned table must include
-- all partitioning columns"), e com PK composta a FK de snapshot falha.
-- Solução: separar identidade do objeto (não particionada, alvo da FK) de
-- observações (particionada, descartável por DROP PARTITION).
-- ============================================================================

CREATE TABLE app.raw_object (
  raw_sha256    bytea    PRIMARY KEY,
  byte_len      integer  NOT NULL,
  codec         text     NOT NULL CHECK (codec IN ('zstd','gzip','none')),
  object_key    text,                          -- 'r2://buer-raw/ab/cd/<hex>.json.zst'; NULL = purgado
  purged_at     timestamptz,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  CHECK (object_key IS NOT NULL OR purged_at IS NOT NULL)
);

CREATE TABLE app.raw_observation (
  raw_sha256   bytea       NOT NULL,          -- SEM FK (particionada; integridade na aplicação)
  account_id   bigint      NOT NULL,
  endpoint     text        NOT NULL,
  captured_at  timestamptz NOT NULL,
  inline_bytes bytea,                          -- NULL em produção (bytes vão pro R2)
  PRIMARY KEY (raw_sha256, captured_at)
) PARTITION BY RANGE (captured_at);
ALTER TABLE app.raw_observation ALTER COLUMN inline_bytes SET STORAGE EXTERNAL;
CREATE TABLE app.raw_observation_2026m09 PARTITION OF app.raw_observation
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');

-- ============================================================================
-- §5.4 — Snapshot
-- ============================================================================

CREATE TABLE app.snapshot (
  snapshot_id     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id      bigint      NOT NULL REFERENCES app.account,
  taken_at        timestamptz NOT NULL,
  ingested_at     timestamptz NOT NULL DEFAULT now(),
  idempotency_key text,
  parser_version  integer     NOT NULL,
  doc_schema      smallint    NOT NULL REFERENCES app.doc_schema,
  catalog_version text        REFERENCES catalog.version,
  lang            text        NOT NULL,
  raw_sha256      bytea       REFERENCES app.raw_object,
  account_hash    bytea       NOT NULL,        -- sha256 do conjunto ordenado (char_key, content_hash)
  changed_chars   smallint    NOT NULL DEFAULT 0,
  observed_chars  smallint    NOT NULL,
  cli_version     text,
  UNIQUE (account_id, taken_at),
  UNIQUE (account_id, idempotency_key)
);

-- ============================================================================
-- §5.5 — Estado de personagem, content-addressed
-- ============================================================================

CREATE TABLE app.character_state (
  state_id     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id   bigint   NOT NULL REFERENCES app.account,
  char_key     text     NOT NULL REFERENCES catalog.character,
  doc_schema   smallint NOT NULL REFERENCES app.doc_schema,

  -- FONTE DA VERDADE: os bytes exatos hasheados. jsonb NÃO serve como forma canônica
  -- (ordena chaves por comprimento e insere espaços), logo sha256(doc::text) nunca bateria.
  doc_canon    bytea    NOT NULL,
  content_hash bytea GENERATED ALWAYS AS (sha256(doc_canon)) STORED,  -- sha256(bytea) é IMMUTABLE

  -- colunas promovidas para filtro/ordenação sem detoast do doc
  char_level    smallint NOT NULL,
  ascension     smallint NOT NULL,
  constellation smallint NOT NULL CHECK (constellation BETWEEN 0 AND 6),
  weapon_id     integer  REFERENCES catalog.weapon,
  weapon_refine smallint CHECK (weapon_refine BETWEEN 1 AND 5),
  first_seen    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, doc_schema, content_hash)
);

CREATE TABLE app.state_stat (
  state_id   bigint   NOT NULL REFERENCES app.character_state ON DELETE CASCADE,
  prop_group smallint NOT NULL CHECK (prop_group IN (1,2,3,4)),  -- base|selected|extra|element
  prop_id    smallint NOT NULL REFERENCES catalog.property,
  base_v     numeric,
  add_v      numeric,
  final_v    numeric,
  PRIMARY KEY (state_id, prop_group, prop_id)   -- discriminador OBRIGATÓRIO
);

-- ============================================================================
-- §5.6 — Timeline: uma linha por mudança
-- ============================================================================

CREATE TABLE app.character_timeline (
  account_id    bigint      NOT NULL,
  char_key      text        NOT NULL,
  doc_schema    smallint    NOT NULL,
  valid_from    timestamptz NOT NULL,
  valid_to      timestamptz,                    -- NULL = intervalo aberto
  last_seen_at  timestamptz NOT NULL,           -- distingue "não mudou" de "não observado"
  closed_by     text        NOT NULL DEFAULT 'change'
                CHECK (closed_by IN ('change','open','not_observed','superseded')),
  state_id      bigint      NOT NULL REFERENCES app.character_state,
  from_snapshot bigint      NOT NULL REFERENCES app.snapshot,
  PRIMARY KEY (account_id, char_key, doc_schema, valid_from)
);

-- Garante no máximo um intervalo aberto por personagem, sem o custo de um EXCLUDE gist
-- (que tornaria os UPDATEs de fechamento non-HOT — ruim no free tier sem janela de autovacuum).
CREATE UNIQUE INDEX character_timeline_one_open
  ON app.character_timeline (account_id, char_key, doc_schema)
  WHERE valid_to IS NULL;

-- Sobreposição no passado é prevenida por construção: todo caminho de escrita adquire
-- advisory lock por conta antes de tocar a timeline — isso é uma chamada em tempo de
-- execução (SELECT pg_advisory_xact_lock(hashtextextended('buer.account', account_id))),
-- não DDL, e por isso não vive nesta migration.

-- ============================================================================
-- §5.7 — Eventos: projeção descartável (nunca migrada; DELETE + reconstrói)
-- ============================================================================

CREATE TABLE app.change_event (
  event_id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id  bigint      NOT NULL,
  char_key    text        NOT NULL,
  observed_at timestamptz NOT NULL,             -- instante de OBSERVAÇÃO
  window_from timestamptz NOT NULL,             -- resolução real do evento
  detected_in bigint      NOT NULL REFERENCES app.snapshot,
  kind        text        NOT NULL,             -- level_up|ascension|constellation|talent_up
                                                -- |weapon_change|weapon_refine
                                                -- |artifact_equip|artifact_upgrade|artifact_swap
  payload     jsonb       NOT NULL
);

-- ============================================================================
-- §5.8 — Índices (sem GIN — todos os padrões de acesso são por chave)
-- ============================================================================

CREATE INDEX snapshot_account_time  ON app.snapshot (account_id, taken_at DESC);
CREATE INDEX snapshot_reparse       ON app.snapshot (parser_version) WHERE raw_sha256 IS NOT NULL;
CREATE INDEX timeline_open          ON app.character_timeline (account_id, char_key) WHERE valid_to IS NULL;
CREATE INDEX timeline_asof          ON app.character_timeline (account_id, valid_from DESC)
  INCLUDE (char_key, valid_to, state_id);
CREATE INDEX timeline_state         ON app.character_timeline (state_id);
CREATE INDEX timeline_char_now      ON app.character_timeline (char_key, account_id) WHERE valid_to IS NULL;
CREATE INDEX event_feed             ON app.change_event (account_id, observed_at DESC);
CREATE INDEX state_filter           ON app.character_state (account_id, char_key, char_level DESC);

-- ============================================================================
-- §5.11 — Leitura e diff
-- ============================================================================

CREATE VIEW app.account_at AS
SELECT t.account_id, t.char_key, t.valid_from, t.valid_to, t.last_seen_at, t.closed_by,
       s.state_id, s.char_level, s.ascension, s.constellation, s.weapon_id, s.doc_canon
FROM app.character_timeline t
JOIN app.character_state s USING (state_id)
JOIN app.account a ON a.account_id = t.account_id AND a.active_doc_schema = t.doc_schema;
