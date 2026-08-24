# OneWash — Extrator HoYoLAB + Análise de Builds de Genshin Impact

**Data:** 2026-08-24
**Status:** Design aprovado (Fase 1) — pronto para plano de implementação
**Repositório:** `darkanum/buer`

---

## 1. Contexto e objetivo

Existe uma página do HoYoLAB (Battle Chronicle) que lista todos os personagens de uma
conta de Genshin Impact, com atributos, arma e artefatos equipados de cada um. A informação
existe, mas é presa numa interface que só exibe e carrega um personagem por vez.

O OneWash extrai esses dados de forma confiável e os transforma em duas coisas:

1. **Extrator (CLI)** — roda na máquina do jogador, obtém a sessão do HoYoLAB, chama a API
   do Battle Chronicle, e envia o resultado bruto para o site.
2. **Site (web multi-usuário)** — recebe os dados, exibe cada personagem com a mesma
   informação do HoYoLAB num layout próprio, e (num ciclo futuro) analisa builds, sugere
   times e sugere aquisições.

Esta spec cobre a **Fase 1**: o extrator, a visualização, e o **esqueleto de interfaces**
do motor de análise (contratos, sem regras de meta). As regras de avaliação de build,
composição de time e sugestão de aquisição são um **segundo ciclo de design**, escrito
depois de haver dados reais na tela.

### 1.1 Decisões tomadas no brainstorm

| Decisão | Escolha |
|---|---|
| Escopo desta fase | Extrator + visualização + esqueleto de interfaces do motor |
| Público | Produto web multi-usuário |
| Identidade | Login social (Google/Discord) + pareamento da CLI por token colado |
| Fluxo de dados | **CLI burra sobe cru; servidor normaliza e guarda os dois** (cru + normalizado) |
| Persistência | Snapshots versionados, dedupe por hash de conteúdo |
| Visualização | Mesma informação do HoYoLAB, layout próprio, imagens espelhadas |
| **Extração de cookie** | **Firefox-auto + navegador embutido (login) + colar à mão** — nenhum caminho depende de contornar o App-Bound Encryption do Chrome |

### 1.2 A decisão de cookie e o motivo

A escolha inicial foi ler o cookie store do navegador automaticamente, inclusive Chrome/Edge.
Durante a pesquisa técnica, a síntese de *como contornar o App-Bound Encryption (ABE)* do
Chrome 127+ foi cortada pelo safeguard `[cyber]` do próprio modelo — porque descrever a
decifração do cookie store de outro processo é indistinguível da receita de um infostealer.

Isso confirmou três problemas do caminho ABE que, somados, o descartam:
1. Frágil — a decifração amarra ao binário do Chrome e quebra a cada atualização.
2. Assusta antivírus dos usuários — comportamento idêntico a malware.
3. Pode ser código que a própria ferramenta se recuse a produzir.

**Caminho adotado**, que dá os mesmos dados sem nenhuma dessas questões:
- **Firefox** — `cookies.sqlite` não é cifrado; leitura automática direta.
- **Navegador embutido (Playwright)** — a pessoa faz login numa janela que a CLI abre e a
  sessão daquela janela é capturada. É login legítimo, não decifra store nenhum. Cobre
  Chrome/Edge. A sessão `ltoken_v2` persiste por semanas, então não é login a cada sync.
- **Colar à mão** — fallback universal (`--cookie "ltoken_v2=...; ltuid_v2=..."`).

---

## 2. Arquitetura e fronteiras

Monorepo pnpm + Turborepo. A divisão é **por volatilidade**: cada coisa que pode quebrar por
força externa fica isolada atrás de uma interface, para que sua quebra não se espalhe.

```
packages/
  core/       tipos + schemas Zod (protocolo), normalizador puro, interfaces do motor
  hoyolab/    cliente da API do Battle Chronicle (DS, endpoints, tipos crus) ← API de terceiro
  gi-data/    catálogo estático do jogo (gerado por script; ~2,5 MB embarcado)
  cookies/    provider de sessão do navegador     ← frágil, específico de plataforma
  db/         schema Drizzle + migrations
  engine/     interfaces do motor + implementação nula (esqueleto desta fase)
apps/
  cli/        orquestra: sessão → hoyolab → upload
  web/        Next.js: auth, /api/ingest, normalização, telas, proxy de imagem
```

Fronteiras que existem por um motivo específico:

- **`cookies/`** — único código específico de plataforma, possivelmente com binário nativo,
  e a peça com cobertura de teste mais fraca. Isolá-la concentra a fragilidade. Interface
  mínima: `getSession(): Promise<HoyolabSession>` com cadeia de providers.
- **`core/` é puro** — sem I/O, rede ou banco. Contém a normalização, que é a lógica mais
  mexida (cada campo novo do HoYoLAB passa por ela) e por ser pura é testável com fixtures.
- **`gi-data/`** — catálogo do jogo é global e finito; não vai ao banco. Gerado por script
  de sync a partir de fontes MIT, *vendorizado por SHA*, nunca fetch em runtime.

### 2.1 Fluxo de dados

```
genshin login <token>      grava o token da API OneWash em ~/.genshin/config.json (perm restrita)
genshin sync
  ├─ cookies/  obtém ltoken_v2 + ltuid_v2 (firefox-auto | embutido | --cookie)
  ├─ hoyolab/  getUserGameRolesByCookie → character/list → character/detail
  └─ POST /api/ingest  (Bearer token OneWash)   ← envia o payload CRU
                 │
                 ▼
  web /api/ingest  valida token → grava raw_object + raw_observation
                             → core.normalize() → grava snapshot + character_state + timeline
                 │
                 ▼
  site (Server Components)  lê a projeção normalizada mais recente → renderiza
```

Ponto-chave: **o servidor é a autoridade da normalização.** O `--out arquivo.json` da CLI usa
o mesmo `core.normalize()`, mas é conveniência local; se a CLI da pessoa estiver velha, o que
subiu continua correto porque quem normalizou foi o servidor. Guardar o cru permite
**re-normalizar o passado** quando o parser melhorar — o histórico inteiro ganha o campo novo
retroativamente.

### 2.2 Tratamento de erro (CLI)

Três classes, cada uma com resposta distinta:

- **Sessão não encontrada / expirada** → mensagem acionável dizendo qual provider foi tentado
  e oferecendo o fallback (`--cookie` ou `--login` embutido). É o erro mais comum; recebe a
  melhor mensagem do projeto.
- **HoYoLAB recusou** → distinguir "sua sessão morreu" (`10001`) de "rate limit / captcha"
  (`10102`, `1034`, `-110`) de "conta sem Battle Chronicle vinculado". Ações diferentes.
- **Ingest falhou** → o payload cru fica salvo local e a CLI diz como reenviar, para a pessoa
  não refazer a extração.

---

## 3. O extrator (CLI)

### 3.1 Comandos

```
genshin login <token>     pareia esta máquina com a conta OneWash
genshin sync              extrai do HoYoLAB e envia
genshin doctor            diagnóstico
genshin whoami            mostra o pareamento e a conta detectada
genshin logout            apaga o token local
```

Flags de `sync`:

| Flag | Efeito |
|---|---|
| `--out build.json` | grava o normalizado local também |
| `--dry-run` | extrai e resume, sem enviar |
| `--browser firefox` | força o provider de cookie |
| `--login` | abre o navegador embutido para login |
| `--cookie "..."` | fallback manual |
| `--json` | saída estruturada |

`doctor` responde as quatro perguntas que separam as causas de falha: achou navegador? achou
cookie? o cookie ainda vale? o HoYoLAB e o site respondem? Sem ele, cada suporte é uma
investigação do zero.

### 3.2 Segurança em disco

- **O cookie do HoYoLAB nunca é gravado.** Lido, usado na execução, descartado. O único
  arquivo persistido é o token da API OneWash, revogável pelo site.
- **Redação obrigatória em toda saída.** Cookie e token nunca aparecem em log, stack trace ou
  mensagem de erro, nem truncados — porque a primeira coisa que um usuário faz ao dar erro é
  colar a saída inteira numa issue pública. Isso entra como teste, não como boa intenção.

### 3.3 A API do HoYoLAB (verificado)

Três chamadas. **Base URL configurável** (o host já mudou 2× desde 2024; a página oficial já
usa `sg-act-public-api`, sinal da próxima migração).

**1. Descobrir a conta de jogo**
```
GET https://api-account-os.hoyolab.com/binding/api/getUserGameRolesByCookie?game_biz=hk4e_global
Cookie: ltoken_v2=<...>; ltuid_v2=<...>
x-rpc-language: pt-pt
→ filtrar data.list[] por game_biz=="hk4e_global"; role_id = game_uid, server = region
```

**2. Listar personagens**
```
POST https://sg-public-api.hoyolab.com/event/game_record/genshin/api/character/list
Content-Type: application/json
Cookie: ltoken_v2=<...>; ltuid_v2=<...>
x-rpc-language: pt-pt
body: {"role_id": <uid>, "server": "<region>", "sort_type": 1}
→ data.list[] com o "base" de cada personagem
```

**3. Detalhar**
```
POST .../genshin/api/character/detail
body: {"role_id": <uid>, "server": "<region>", "character_ids": [<ids>]}
→ base, weapon, relics[], constellations[], skills[], as 4 listas de atributos,
  e os mapas globais property_map / relic_property_options / *_wiki
```

Decisões verificadas:
- **DS (Dynamic Secret) provavelmente é dispensável** nessas rotas — confirmar no spike. Se
  necessário, usar apenas **DS1**: `md5("salt=6s25p5ox5y14umn1p61aqyyvbvvl3lrt&t={t}&r={r}")`,
  header `"{t},{r},{md5}"`, com `x-rpc-app_version: 1.5.0` e `x-rpc-client_type: 5`. Nunca DS2
  nem salts chineses.
- **Cookies:** apenas `ltoken_v2` + `ltuid_v2`. Nada de `cookie_token_v2`.
- **`x-rpc-language: pt-pt`** é obrigatório na prática (sem ele, vem chinês). Atenção: o
  código é `pt-pt` mas o conteúdo é pt-BR.
- Não implementar a rota legada `/genshin/api/character` — é dead code e não devolve artefatos.
- O parser de resposta deve tolerar **corpo não-JSON** sem estourar (GET nessas rotas devolve
  "Method Not Allowed" em texto puro) e **tolerar campos novos** (é onde as implementações
  quebram).

### 3.4 Educação com a API

Detalhe aceita lista de IDs → uma requisição em lote, não 60 (o tamanho máximo do lote é
spike). Intervalo entre chamadas e retry com backoff em rate limit. O que mata ferramenta de
comunidade é virar tráfego perceptível.

### 3.5 Distribuição

Pacote npm (`npx`), bundle com tsup/tsdown (ESM+CJS), versionado com Changesets. Se `cookies/`
precisar de binário nativo (Playwright), entra como dependência opcional — quem só usa
`--cookie` não paga o download.

---

## 4. O site

### 4.1 Telas

1. **Landing + login** — Google/Discord, nenhum dado antes de logar.
2. **Onboarding da CLI** — comando de instalação, token gerado, `genshin sync`. Tela por onde
   100% dos usuários passam; também explica por que a ferramenta lê a sessão do navegador
   (código aberto e auditável é o que separa "utilitário legítimo" de "confie em mim").
3. **Grid de personagens** — cards (retrato, elemento, nível, constelações, raridade), filtros
   e ordenação; cabeçalho com nickname, UID, AR e data do último sync.
4. **Detalhe do personagem** — tudo do HoYoLAB (identidade, constelações, talentos, atributos
   completos, arma, os 5 artefatos com main+substats, bônus de conjunto) + um **painel de
   análise reservado** que nesta fase renderiza estado vazio honesto. Reservar o espaço agora
   força o layout a nascer com lugar para o motor.
5. **Histórico** — seletor de snapshot por data e diff entre dois (nível, artefato trocado,
   arma trocada, atributo que subiu).

### 4.2 Imagens

A API devolve URLs no CDN da HoYoverse. Os ~350 assets são **globais e finitos**. Script de
sync (`pnpm assets:sync`) baixa uma vez, nomeia por hash de conteúdo, sobe para **Cloudflare
R2** (egress $0) com `Cache-Control: public, max-age=31536000, immutable`, servido com
`<Image unoptimized>`. Hotlink do Enka está fora (só hospeda o que ele mesmo usa, 404 em ícones
novos; e o Image Optimization não encaminha headers ao buscar remoto).

### 4.3 Renderização

Server Components lendo Postgres direto. `/api/ingest` existe só para a CLI (cliente externo);
o site não fala HTTP consigo mesmo.

---

## 5. Modelo de dados

DDL executável em Postgres. Correções estruturais em relação ao esboço inicial estão em
comentário.

### 5.1 Versionamento e catálogo

```sql
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
```

Nenhuma coluna de nome, descrição, efeito ou ícone em `catalog.*` — isso vive no bundle
`@onewash/gi-data`, indexado por `slug`.

### 5.2 Contas e credencial

```sql
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
```

> Nota: guardar a credencial server-side só é necessário se o site vier a re-sincronizar sem a
> CLI. Se o modelo permanecer "a CLI sempre traz a sessão", `app.credential` pode não existir
> na v1. Decidir no plano de implementação; a tabela fica documentada para o caso de o site
> assumir o refresh.

### 5.3 Raw — identidade separada de observação

O esboço ingênuo não executa: `PRIMARY KEY (raw_sha256)` + `PARTITION BY RANGE (captured_at)`
falha ("unique constraint on partitioned table must include all partitioning columns"), e com
PK composta a FK de `snapshot` falha. Solução: separar **identidade do objeto** (não
particionada, alvo da FK) de **observações** (particionada, descartável por `DROP PARTITION`).

```sql
CREATE TABLE app.raw_object (
  raw_sha256    bytea    PRIMARY KEY,
  byte_len      integer  NOT NULL,
  codec         text     NOT NULL CHECK (codec IN ('zstd','gzip','none')),
  object_key    text,                          -- 'r2://onewash-raw/ab/cd/<hex>.json.zst'; NULL = purgado
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
```

### 5.4 Snapshot

```sql
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
```

### 5.5 Estado de personagem — content-addressed

```sql
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
```

**Forma canônica de `doc_canon` (v1).** Chaves ordenadas lexicograficamente, sem nulls,
`separators=(",",":")`, números já parseados com casas fixas por `prop_id`, arrays com ordem
determinística, **zero texto de catálogo, zero valor localizado, zero stat derivado**.

```json
{"v":1,"char":"10000089","lvl":90,"asc":6,"cons":2,"friend":10,
 "weapon":{"id":13509,"lvl":90,"promote":6,"refine":1},
 "talents":[[10097,10],[10098,9],[100541,10]],
 "artifacts":[{"slot":1,"set":15025,"lvl":20,"rarity":5,
               "main":[2,4780.0],
               "subs":[[5,4.1,1],[20,7.4,2],[22,14.8,3],[23,4.0,1]],
               "fp":"15025:1:2:5x1,20x2,22x3,23x1"}]}
```

Quatro regras que corrigem defeitos herdados:
- **`talents` só com skill_type 1** (Normal + Skill + Burst). `skill_type 2` são passivas.
- **`fp`** é o fingerprint sintético do artefato (`set:slot:main:subs ordenados com tier`) —
  não existe GUID de instância; `id` de relic é id de *definição*. `slot`/`set`/`rarity`
  seguem no doc porque a UI os lê sem parsear o `fp`.
- **`subs` guarda o TIER, não o valor exibido.** `(valor, times) → tiers` é bijeção
  comprovada (0 colisões em 5★ e 4★). Remove a dependência de idioma do hash. **CRIT DMG 5★
  tem 4 tiers: 5.44 / 6.22 / 6.99 / 7.77** — não 3.
- **Nenhum `stats`.** Os quatro grupos (`base/selected/extra/element`) são derivados,
  recalculáveis, e um patch de balanceamento os muda sem mudança de conta. Se precisarem ser
  exibidos sem recomputar, vão à parte, **fora do hash**, com discriminador de grupo:

```sql
CREATE TABLE app.state_stat (
  state_id   bigint   NOT NULL REFERENCES app.character_state ON DELETE CASCADE,
  prop_group smallint NOT NULL CHECK (prop_group IN (1,2,3,4)),  -- base|selected|extra|element
  prop_id    smallint NOT NULL REFERENCES catalog.property,
  base_v     numeric,
  add_v      numeric,
  final_v    numeric,
  PRIMARY KEY (state_id, prop_group, prop_id)   -- discriminador OBRIGATÓRIO
);
```

### 5.6 Timeline — uma linha por mudança

```sql
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
```

Sobreposição no passado é prevenida por construção: todo caminho de escrita adquire advisory
lock por conta antes de tocar a timeline:

```sql
SELECT pg_advisory_xact_lock(hashtextextended('onewash.account'::text, account_id));
```

### 5.7 Eventos — projeção descartável

```sql
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
```

Nunca migrada. `DELETE` do intervalo afetado e reconstrói de `(timeline, states)`.

### 5.8 Índices

```sql
CREATE INDEX snapshot_account_time  ON app.snapshot (account_id, taken_at DESC);
CREATE INDEX snapshot_reparse       ON app.snapshot (parser_version) WHERE raw_sha256 IS NOT NULL;
CREATE INDEX timeline_open          ON app.character_timeline (account_id, char_key) WHERE valid_to IS NULL;
CREATE INDEX timeline_asof          ON app.character_timeline (account_id, valid_from DESC)
  INCLUDE (char_key, valid_to, state_id);
CREATE INDEX timeline_state         ON app.character_timeline (state_id);
CREATE INDEX timeline_char_now      ON app.character_timeline (char_key, account_id) WHERE valid_to IS NULL;
CREATE INDEX event_feed             ON app.change_event (account_id, observed_at DESC);
CREATE INDEX state_filter           ON app.character_state (account_id, char_key, char_level DESC);
```

Sem GIN — todos os padrões de acesso são por chave.

### 5.9 Protocolo de versionamento

Três eixos independentes:

| Eixo | Onde | Incrementa quando | Custo |
|---|---|---|---|
| `parser_version` | `snapshot` | qualquer bugfix no parser | barato |
| `doc_schema` | `snapshot`, `character_state`, `character_timeline`, `account.active_doc_schema` | muda o layout do doc canônico (invalida hashes) | caro |
| `catalog_version` | `snapshot` | patch do jogo | zero |

- **Bump de `parser_version`:** re-parseia os raws pendentes (`snapshot_reparse`), gera docs
  canônicos, `INSERT ... ON CONFLICT DO NOTHING`, repontua a timeline, sob advisory lock.
  Idempotente e retomável. **Hash divergente no re-parse bifurca, não reescreve:** a linha
  antiga fecha com `closed_by='superseded'` (ou `parser_version` entra na PK da timeline).
- **Bump de `doc_schema`:** as duas gerações coexistem (por isso `doc_schema` está na UNIQUE
  de `character_state` e na PK de `character_timeline`); a virada é um UPDATE em
  `active_doc_schema`, reversível; migração **conta a conta** porque 0,5 GB não dobra tudo.

### 5.10 Retenção

- Baratos, guardar para sempre: `snapshot`, `character_state`, `character_timeline`.
- Caro: raw. Enquanto houver `parser_version` pendente, intocável. Depois: `object_key = NULL`,
  `purged_at = now()`, delete no R2, `DROP PARTITION` das observações fora da janela.
- `VACUUM (ANALYZE)` explícito no fim do job de ingestão — autovacuum não tem janela num
  compute que suspende após 5 min com carga semanal.

### 5.11 Leitura e diff

```sql
CREATE VIEW app.account_at AS
SELECT t.account_id, t.char_key, t.valid_from, t.valid_to, t.last_seen_at, t.closed_by,
       s.state_id, s.char_level, s.ascension, s.constellation, s.weapon_id, s.doc_canon
FROM app.character_timeline t
JOIN app.character_state s USING (state_id)
JOIN app.account a ON a.account_id = t.account_id AND a.active_doc_schema = t.doc_schema;
```

Diff em 3 níveis: (0) comparar `account_hash` dos dois snapshots; (1) em SQL, `FULL JOIN` de
dois as-of sobre `state_id` para saber *quais* personagens mudaram; (2) na aplicação, diff
semântico dos poucos docs que mudaram (`fp` antes de `subs` para distinguir troca de upgrade).
Nunca expandir jsonb cru em SQL.

---

## 6. Interfaces do motor (esqueleto)

Tipos e assinaturas, zero regra de meta. A propriedade preservada: **`curated → analytic →
simulation`** entram em sequência sem tocar UI, banco ou busca. Lição dos repos: o Genshin
Optimizer acoplou solver e motor de fórmula e está preso numa migração há anos — não repetir;
o gcsim resolve energia/ICD/rotação mas é ordens de magnitude mais caro — são complementares,
logo plugins. **Objetivo e Restrições são dados serializáveis, nunca nós de um motor.**

### 6.1 Núcleo

```ts
export type SchemaVersion = 1;
export type GameVersion = `${number}.${number}`;

// unions ABERTAS: o domínio muda a cada patch
export type CharacterKey   = string & { readonly __brand: 'CharacterKey' };
export type WeaponKey      = string & { readonly __brand: 'WeaponKey' };
export type ArtifactSetKey = string & { readonly __brand: 'ArtifactSetKey' };
export type ReactionKey    = string;
export type RoleTag        = string;

export type Element = 'pyro'|'hydro'|'cryo'|'electro'|'anemo'|'geo'|'dendro';
export type ArtifactSlot = 'flower'|'plume'|'sands'|'goblet'|'circlet';
export type StatKey =
  | 'hp'|'hp_'|'atk'|'atk_'|'def'|'def_'|'eleMas'|'enerRech_'
  | 'critRate_'|'critDMG_'|'heal_'|'shield_'
  | `${Element}_dmg_`|'physical_dmg_'|'dmg_';

export interface Substat {
  readonly key: StatKey;
  readonly tiers: readonly (1|2|3|4)[];        // reconstruído de (valor, times) — bijeção
  readonly value: number;                       // soma canônica dos tiers
  readonly source: 'exact' | 'reconstructed';   // enka appendPropId vs hoyolab (valor,times)
}

export interface ArtifactPiece {
  readonly fingerprint: string;                 // não há GUID de instância
  readonly setKey: ArtifactSetKey;
  readonly slot: ArtifactSlot;
  readonly rarity: 3|4|5;                        // GOOD aceita 3-5; 1/2 rejeitados na borda
  readonly level: number;                        // 0..20
  readonly mainStatKey: StatKey;
  readonly substats: readonly Substat[];
  readonly locked: boolean;
  readonly equippedBy: CharacterKey | null;      // exclusividade global: uma peça, um portador
}

export interface WeaponInstance {
  readonly key: WeaponKey; readonly level: number;
  readonly ascension: number;                    // 0..6; BasePromote 5 OU 7 → clampar
  readonly refinement: 1|2|3|4|5;
  readonly equippedBy: CharacterKey | null;
}

export interface CharacterInstance {
  readonly key: CharacterKey;                    // composto quando Traveler
  readonly element?: Element;                     // obrigatório para Traveler
  readonly level: number; readonly ascension: number;  // par (level, ascension) SEMPRE junto
  readonly constellation: 0|1|2|3|4|5|6;
  readonly talents: { readonly auto: number; readonly skill: number; readonly burst: number };
}

export interface Roster {
  readonly schemaVersion: SchemaVersion;
  readonly characters: ReadonlyMap<CharacterKey, CharacterInstance>;
  readonly artifacts: readonly ArtifactPiece[];
  readonly weapons: readonly WeaponInstance[];
  readonly provenance: {
    readonly source: 'hoyolab'|'good-import'|'enka'|'manual'|'merged';
    readonly completeness: 'full'|'showcase-only'|'partial';
    readonly capturedAt: string;
    readonly lang: string;
  };
}
```

### 6.2 Build, time, inimigo

```ts
export interface Build {
  readonly schemaVersion: SchemaVersion;
  readonly character: CharacterInstance;
  readonly weapon: WeaponInstance;
  readonly artifacts: Readonly<Record<ArtifactSlot, ArtifactPiece | null>>;
  readonly conditionals: ConditionalState;
}

// Endereçável por string e serializável. NUNCA inferir automaticamente.
export type ConditionalState =
  Readonly<Record<string, Readonly<Record<string, string>>>>;

export interface ConditionalMigration {
  readonly from: SchemaVersion; readonly to: SchemaVersion;
  migrate(s: ConditionalState): ConditionalState;
}

export interface TeamComposition {
  readonly schemaVersion: SchemaVersion;
  readonly slots: readonly [TeamSlot, TeamSlot?, TeamSlot?, TeamSlot?];
  readonly enemy: EnemyProfile;                 // propriedade do TIME
  readonly teamConditionals: ConditionalState;  // ressonância e reação vivem aqui
}

export interface TeamSlot {
  readonly build: Build;
  readonly role: readonly RoleTag[];
  readonly onFieldShare?: number;               // 0..1; julgamento humano, não inferência
}

export interface EnemyProfile {
  readonly level: number;
  readonly res: Readonly<Partial<Record<Element|'physical', number>>>;
  readonly resShred: Readonly<Partial<Record<Element|'physical', number>>>;
  readonly defReduction: number;                // cap efetivo 0.9
  readonly defIgnore: number;                   // cap 1.0
  readonly count: number;                       // single vs AoE muda o ranking
  readonly source: 'preset'|'catalog'|'manual';
}
```

### 6.3 Objetivo e restrições (dados serializáveis)

```ts
export interface AbilityRef {
  readonly kind: 'normal'|'charged'|'plunging'|'skill'|'burst'|'named';
  readonly index?: number;                      // auto[] é lista-de-listas por componente
  readonly variant?: string;
  readonly path?: readonly string[];            // escape hatch
  readonly scalesOn: 'atk'|'def'|'hp'|'eleMas';
  readonly ignoreDefPercent?: number;
  readonly elevation?: number;
}

export type HitMode =
  | { readonly kind: 'hit' }
  | { readonly kind: 'critHit' }
  | { readonly kind: 'avgHit' }
  | { readonly kind: 'guaranteedCrit'; readonly reason: 'weakPoint'|'effect' }
  | { readonly kind: 'override'; readonly critRate?: number; readonly critDMG?: number };

export interface ReactionPremise {
  readonly reaction: ReactionKey;
  readonly uptime: number;                      // 0..1
  readonly icdGroupNote?: string;
  readonly auraTax?: number;
  readonly declaredBy: 'user'|'archetype'|'evaluator-default';
}

export type ObjectiveTerm =
  | { readonly kind: 'damage'; readonly of: CharacterKey; readonly ability: AbilityRef;
      readonly hitMode: HitMode; readonly reaction?: ReactionPremise;
      readonly infusion?: Element;
      readonly snapshot?: { readonly at: 'cast'|'hit'; readonly buffsFrom?: 'team'|'self' };
      readonly weight: number }
  | { readonly kind: 'reactionOverTime'; readonly of: CharacterKey;
      readonly reaction: ReactionKey; readonly expectedTriggers: number;
      readonly windowSeconds: number; readonly weight: number }
  | { readonly kind: 'stat'; readonly of: CharacterKey; readonly stat: StatKey; readonly weight: number }
  | { readonly kind: 'healing'|'shield'; readonly of: CharacterKey; readonly weight: number };

export interface Objective {
  readonly schemaVersion: SchemaVersion;
  readonly id: string; readonly label: string;
  readonly terms: readonly ObjectiveTerm[];     // multi-alvo ponderado desde o dia 1
  readonly aggregate: 'sum'|'min'|'rotationDPS';
  readonly rotation?: RotationRef;
}

export interface RotationRef {
  readonly id: string; readonly gameVersion: GameVersion;
  readonly providerId: string; readonly authoredBy: string;
  readonly durationSeconds: number;
}

export type Constraint =
  | { readonly kind: 'stat'; readonly of: CharacterKey; readonly stat: StatKey;
      readonly min?: number; readonly max?: number; readonly hard: boolean }
  | { readonly kind: 'energyFeasible'; readonly of: CharacterKey;
      readonly threshold: ErThreshold; readonly hard: boolean }
  | { readonly kind: 'artifactSet'; readonly setKey: ArtifactSetKey; readonly forbid: readonly (2|4)[] }
  | { readonly kind: 'mainStat'; readonly slot: ArtifactSlot; readonly allow: readonly StatKey[] };

export interface ErContext {
  readonly team: TeamComposition; readonly of: CharacterKey;
  readonly rotation: RotationRef; readonly teamSize: 1|2|3|4;
  readonly offFieldMultiplier: number;
  readonly flatEnergySources: readonly string[];
}
export type ErThreshold =
  | { readonly kind: 'literal'; readonly value: number; readonly source: string }
  | { readonly kind: 'provided'; readonly providerId: string; readonly percentile?: number };
export interface ErThresholdProvider {
  readonly id: string;
  resolve(ctx: ErContext): Promise<{ readonly value: number; readonly provenance: Provenance }>;
}
```

### 6.4 `BuildEvaluator` — o seam

```ts
export type EvaluatorKind = 'curated' | 'analytic' | 'simulation';

export interface EvaluatorCapabilities {
  readonly kind: EvaluatorKind;
  readonly output: 'ordinal' | 'relative' | 'absolute';
  readonly supportsTermKinds: readonly ObjectiveTerm['kind'][];
  readonly supportsAggregates: readonly Objective['aggregate'][];
  readonly supportsConstraintKinds: readonly Constraint['kind'][];
  readonly supportsHitModes: readonly HitMode['kind'][];
  readonly modelsSnapshot: boolean;
  readonly modelsAuraAndIcd: boolean;
  readonly providesBounds: boolean;             // habilita branch-and-bound
  readonly deterministic: boolean;
  readonly estimatedCostPerBuildMs: number;
  readonly maxBatchSize: number;
  readonly runtime: 'node'|'wasm'|'worker'|'remote';
}

export interface EvaluationContext {
  readonly gameVersion: GameVersion;
  readonly team: TeamComposition;
  readonly subject: CharacterKey;
  readonly objective: Objective;
  readonly constraints: readonly Constraint[];
  readonly signal?: AbortSignal;
}

export type CapabilityVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reasons: readonly string[]; readonly degradedTo?: Objective };

export interface BuildEvaluator {
  readonly id: string;
  readonly capabilities: EvaluatorCapabilities;
  canHandle(ctx: EvaluationContext): CapabilityVerdict;   // negociação ANTES de rodar
  prepare(ctx: EvaluationContext): Promise<PreparedEvaluator>;
}

export interface PreparedEvaluator extends AsyncDisposable {
  evaluate(builds: readonly Build[]): Promise<readonly Score[]>;   // LOTE, nunca unitário
  estimateBounds?(partial: PartialBuild): Promise<Interval>;
  explain?(build: Build): Promise<Explanation>;
}

export interface Score {
  readonly value: number;
  readonly unit: 'damage'|'dps'|'stat'|'score';
  readonly distribution?: { readonly mean: number; readonly sd: number;
                            readonly p5: number; readonly p50: number; readonly p95: number };
  readonly violations: readonly ConstraintViolation[];
  readonly breakdown?: Readonly<Record<string, number>>;
  readonly provenance: Provenance;
}

// Contrato de produto: isto é COMPARAÇÃO, não PREVISÃO.
export interface Provenance {
  readonly evaluatorId: string; readonly kind: EvaluatorKind;
  readonly gameVersion: GameVersion; readonly datasetSha: string;
  readonly confidence: 'high'|'medium'|'low';
  readonly assumptions: readonly string[];
  readonly rosterCompleteness: Roster['provenance']['completeness'];
  readonly cacheKey: string;
}

export interface ConstraintViolation {
  readonly constraint: Constraint; readonly actual: number;
  readonly required: number; readonly hard: boolean;
}
export interface Interval { readonly min: number; readonly max: number }
export type PartialBuild = Omit<Build,'artifacts'> &
  { readonly artifacts: Readonly<Partial<Record<ArtifactSlot, ArtifactPiece|null>>> };
export interface Explanation {
  readonly summary: string;
  readonly reasons: readonly { readonly claim: string; readonly evidence?: string }[];
  readonly citations?: readonly string[];
}
```

Como as três implementações encaixam sem vazar detalhe:

| | `curated` | `analytic` | `simulation` |
|---|---|---|---|
| `output` | ordinal | absolute | absolute + distribuição |
| `providesBounds` | false | **true** | false |
| `supportsAggregates` | `['sum']` | `['sum','min']` | `['sum','min','rotationDPS']` |
| `modelsSnapshot`/`modelsAuraAndIcd` | false/false | false/false | true/true |
| custo/build | ~0.01 ms | ~0.001 ms | ~200 ms |

### 6.5 Busca (separada da avaliação; time é matching)

```ts
export interface SearchPolicy {
  readonly respectLocks: boolean;
  readonly allowStealingFrom: readonly CharacterKey[];   // default [] — não roubar
  readonly assumeArtifactLevel?: number;                 // comparar +0 com +20 é injusto
  readonly maxCombinations: number;
  readonly timeBudgetMs: number;
}

export interface SearchProblem {
  readonly context: EvaluationContext;
  readonly candidates: Readonly<Record<ArtifactSlot, readonly ArtifactPiece[]>>;
  readonly weapons: readonly WeaponInstance[];
  readonly topN: number;
  readonly reservations: ReadonlyMap<string, CharacterKey>;  // fingerprint -> portador
  readonly policy: SearchPolicy;
}

export interface BuildSearcher {
  readonly id: string;
  search(p: SearchProblem, e: BuildEvaluator,
         onProgress?: (x: SearchProgress) => void): Promise<SearchResult>;
}

// Otimizar 4 personagens NÃO são 4 problemas independentes: é MATCHING.
export interface TeamSearchProblem {
  readonly context: Omit<EvaluationContext,'subject'|'objective'>;
  readonly objectives: ReadonlyMap<CharacterKey, Objective>;
  readonly inventory: Roster;
  readonly policy: SearchPolicy;
}
export interface TeamSearcher {
  readonly id: string;
  readonly strategy: 'greedy-by-slot'|'relaxed-then-swap'|'assignment';
  readonly orderDependent: boolean;
  search(p: TeamSearchProblem, e: BuildEvaluator,
         onProgress?: (x: SearchProgress) => void): Promise<TeamSearchResult>;
}

export interface SearchProgress {
  readonly tested: number; readonly failed: number; readonly skipped: number;
  readonly total: number | null; readonly perSecond: number;
}
export interface SearchResult {
  readonly builds: readonly { readonly build: Build; readonly score: Score }[];
  readonly truncated: boolean;
  readonly notes: readonly string[];            // "orçamento esgotado", "poda desabilitada"
}
export interface TeamSearchResult {
  readonly assignment: ReadonlyMap<CharacterKey, Build>;
  readonly scores: ReadonlyMap<CharacterKey, Score>;
  readonly conflicts: readonly { readonly fingerprint: string;
                                  readonly contestedBy: readonly CharacterKey[] }[];
  readonly truncated: boolean; readonly notes: readonly string[];
}
```

Regra: `providesBounds === true` → branch-and-bound com poda; `false` → amostragem/greedy com
orçamento, e `notes` diz isso ao usuário.

### 6.6 Time e aquisição

```ts
export interface TeamEvaluator {
  readonly id: string;
  readonly capabilities: EvaluatorCapabilities;
  evaluate(team: TeamComposition, ctx: TeamEvalContext): Promise<TeamAssessment>;
}

export interface TeamAssessment {
  // Curado PRIMEIRO. Scoring computado só como desempate.
  readonly archetype: { readonly id: string; readonly label: string;
                        readonly matchConfidence: number } | null;
  readonly reactions: readonly ReactionAvailability[];
  readonly resonance: readonly ResonanceEffect[];
  readonly roleCoverage: Readonly<Record<RoleTag,'missing'|'weak'|'covered'>>;
  readonly energyFeasibility: readonly { readonly of: CharacterKey;
                                          readonly required: number; readonly actual: number }[];
  readonly score: Score;
  readonly explanation: Explanation;
}

export interface ReactionAvailability {
  readonly reaction: ReactionKey;
  readonly requires: { readonly elements: readonly Element[];
                       readonly enabledByAnyOf?: readonly CharacterKey[] };
  readonly satisfied: boolean;
  readonly missing: readonly (Element | CharacterKey)[];
}

export interface ResonanceEffect {
  readonly id: string;
  readonly stats?: Readonly<Partial<Record<StatKey, number>>>;
  readonly auraDurationMultiplier?: { readonly element: Element; readonly factor: number };
  readonly particleGeneration?: { readonly element: Element; readonly cooldownSeconds: number;
                                   readonly onReactions: readonly ReactionKey[] };
  readonly conditional?: string;
}

// Banco curado. Dado autoral, com fonte e patch — auditável e expirável.
export interface TeamArchetype {
  readonly schemaVersion: SchemaVersion;
  readonly id: string; readonly label: string;
  readonly gameVersionAdded: GameVersion;
  readonly gameVersionRetired?: GameVersion;
  readonly slots: readonly ArchetypeSlot[];
  readonly rotation?: RotationRef;
  readonly erThresholds?: ReadonlyMap<CharacterKey, number>;
  readonly sources: readonly string[];
}
export interface ArchetypeSlot {
  readonly role: readonly RoleTag[];
  readonly requires:
    | { readonly kind: 'character'; readonly anyOf: readonly CharacterKey[] }
    | { readonly kind: 'element'; readonly element: Element; readonly withRole: readonly RoleTag[] };
  readonly minConstellation?: number;
  readonly minRefinement?: number;
  readonly substitutable: boolean;
}

// Aquisição = valor marginal contra gap analysis, não tier list.
export type InvestmentAxis =
  | { readonly kind: 'artifact' }
  | { readonly kind: 'constellation'; readonly from: number; readonly to: number }
  | { readonly kind: 'talent'; readonly which: 'auto'|'skill'|'burst'; readonly from: number; readonly to: number }
  | { readonly kind: 'refinement'; readonly from: 1|2|3|4|5; readonly to: 1|2|3|4|5 }
  | { readonly kind: 'newCharacter'; readonly character: CharacterKey }
  | { readonly kind: 'newWeapon'; readonly weapon: WeaponKey };

export interface RosterAdvisor {
  advise(roster: Roster, prefs: AdvisorPreferences): Promise<AcquisitionAdvice>;
}
export interface AcquisitionAdvice {
  readonly candidates: readonly AcquisitionCandidate[];
  readonly coverageGaps: readonly CoverageGap[];
}
export interface AcquisitionCandidate {
  readonly axis: InvestmentAxis;
  readonly unlocks: readonly { readonly archetype: TeamArchetype;
                                readonly wasBlockedBy: readonly string[] }[];
  readonly improves: readonly { readonly archetype: TeamArchetype;
                                 readonly delta: Interval;
                                 readonly deltaDistribution?: Score['distribution'];
                                 readonly replaces?: CharacterKey }[];
  readonly redundancyWith: readonly CharacterKey[];
  readonly explanation: Explanation;
  readonly provenance: Provenance;
}
export interface CoverageGap {
  readonly description: string;
  readonly missing: { readonly element?: Element; readonly roles: readonly RoleTag[] };
  readonly blockedArchetypes: readonly string[];
  readonly severity: 'critical'|'notable'|'minor';
}
```

### 6.7 Acionabilidade, registry e dados

```ts
export interface EquipPlan {
  readonly steps: readonly {
    readonly order: number; readonly character: CharacterKey;
    readonly slot: ArtifactSlot | 'weapon';
    readonly equip: string;                     // fingerprint | weapon instance id
    readonly unequipsFrom?: CharacterKey;
  }[];
  readonly netLosers: readonly { readonly character: CharacterKey; readonly deltaScore: Interval }[];
}

export interface FarmPlan {
  readonly targets: readonly { readonly setKey: ArtifactSetKey; readonly slot: ArtifactSlot;
                                readonly mainStatKey: StatKey; readonly expectedDelta: Interval;
                                readonly domain?: string }[];
  readonly assumptions: readonly string[];      // probabilidades de drop NÃO estão no game data
}

export interface EvaluatorRegistry {
  register(e: BuildEvaluator): void;
  resolve(ctx: EvaluationContext, prefer?: EvaluatorKind):
    { readonly evaluator: BuildEvaluator; readonly degraded: CapabilityVerdict };
  list(): readonly EvaluatorCapabilities[];
}

export interface GameDataProvider {
  readonly version: GameVersion;
  readonly datasetSha: string;                  // pinning obrigatório
  characterCurves(k: CharacterKey): Promise<CharacterStatCurves>;
  // TRÊS fórmulas, não uma: hp/atk/def com ascensão; arma specialized SEM ascensão;
  // personagem specialized = promotion + base.critrate/critdmg quando aplicável.
  computeStats(c: CharacterInstance, w: WeaponInstance): Promise<Readonly<Partial<Record<StatKey,number>>>>;
  skillParams(k: CharacterKey): Promise<SkillParamTable>;
  artifactSet(k: ArtifactSetKey): Promise<ArtifactSetData>;  // twopcNumeric: boolean
  reactionTable(): Promise<ReactionTable>;      // NÃO está no Enka nem no allStat_gen
  enemyProfile(id: string): Promise<EnemyProfile>;
  substatTiers(rarity: 3|4|5, key: StatKey): Promise<readonly number[]>;
  reconstructSubstat(rarity: 3|4|5, key: StatKey, displayValue: string, times: number):
    Promise<readonly (1|2|3|4)[]>;
}

export interface RosterSource {
  readonly id: 'hoyolab'|'good'|'enka'|'manual';
  readonly completeness: Roster['provenance']['completeness'];
  load(input: unknown): Promise<Roster>;
}
export interface RosterMerger { merge(sources: readonly Roster[]): Roster; }
export interface GoodCodec {
  toGOOD(r: Roster): unknown;                   // {format:'GOOD', source:'onewash', version:3}
  fromGOOD(x: unknown): Roster;                 // rejeitar rarity 1|2 na borda
}
```

Nesta fase, `engine/` entrega **as interfaces + uma implementação nula** que satisfaz a suíte
de contrato. As três implementações reais (`curated`, `analytic`, `simulation`) são o segundo
ciclo.

---

## 7. Stack (verificada)

| Área | Decisão | Motivo |
|---|---|---|
| Framework | Next.js 16 App Router | — |
| Auth | Better Auth + plugin API Key (Google/Discord) | única com primitiva pronta para token de CLI; `next-auth` v5 nunca saiu do beta |
| Token CLI | prefixo `ow_live_`, SHA-256 no banco, escopo único `snapshots:write`, mostrado uma vez | padrão de mercado, revogável |
| ORM | Drizzle 0.45 estável; pooled p/ app, string direta p/ migrations | tipos sem codegen, SQL legível; evitar v1 RC sem GA |
| Postgres | Neon via Vercel Marketplace | sucessor do Vercel Postgres (morto); free 0,5 GB / 100 CU-h serve o começo |
| Imagens | espelhar em Cloudflare R2, `unoptimized`, cache immutable | egress $0; hotlink do Enka quebra |
| Validação | Zod v4 em `packages/core`, mesmo schema nos dois lados | servidor nunca confia no cliente |
| Game data | `@onewash/gi-data` gerado por script; Enka `store/gi/*` + `allStat_gen` (GO, MIT), vendorizado por SHA | AnimeGameData cru tem chaves ofuscadas que rotacionam por patch |
| Monorepo | pnpm + Turborepo + Changesets | fronteiras por volatilidade |
| Rate limit ingest | 2 camadas: WAF por IP + rate limit do plugin API Key por token | nenhuma sozinha resolve |

Notas de armadilha verificadas:
- **`workspace:*` só é reescrito por `pnpm publish`** — se algum CI usar `npm publish`, o
  literal vaza e o install quebra. Publicar `@onewash/core` junto, ou bundlar o core na CLI e
  deixá-lo `private`.
- **Mapa de propriedade em três dialetos** (string do jogo / int do Enka / chave GOOD) e três
  encodings só de weapon type — o trabalho de mapeamento é maior que "copiar um arquivo".
- **2pc não-numérico em ~21,5% dos sets** — a camada de efeitos escrita à mão cobre 2pc
  também, não só 4pc. É o custo real do motor (segundo ciclo).
- **Fórmula de stat é tripla, não única** — implementar só `base*curve+ascension` produz stat
  secundário de arma e crit de ascensão errados.

---

## 8. Estratégia de teste

| Alvo | Abordagem | Observação |
|---|---|---|
| `core/normalize` | fixtures de ouro (JSON cru → normalizado) | onde vivem quase todos os bugs; **scrubber obrigatório e testado** anonimiza UID/nickname antes de commitar — repo é público |
| `hoyolab/` DS | teste unitário determinístico | assinatura errada devolve retcode genérico; CI **nunca** toca a API real |
| `cookies/` Firefox | banco `cookies.sqlite` sintético commitado | caminho completo de leitura |
| `cookies/` Chrome/Edge | checklist de verificação **manual** | depende de perfil real; mock não prova nada |
| `web/api/ingest` | teste de contrato | token inválido rejeitado; payload malformado com erro útil; envelope antigo aceito; **mesmo payload 2× não cria 2 snapshots** (dedupe por hash) |
| `engine/` | suíte de contrato contra a interface | implementação nula passa; implementações reais rodam a mesma suíte |
| numérico (motor) | golden-test vs gcsim/GO | segundo ciclo; sem ele não se sabe se erramos um multiplicador |

Deliberadamente **fora**: E2E de navegador nesta fase.

Guardas específicas de repo público:
- **Secret scanning próprio** (pre-commit) para `ltoken_v2`, `ltuid_v2`, `cookie_token_v2` — os
  padrões do GitHub não conhecem cookie da HoYoverse.
- Registrar o prefixo `ow_live_` no GitHub Secret Scanning Partner Program após o launch.

---

## 9. Spikes obrigatórios

Não decidíveis sem testar empiricamente:

1. **Sessão HoYoLAB** (~30 min, conta descartável): (a) DS é mesmo dispensável? comparar sem
   DS / DS válido / DS lixo; (b) `character/detail` aceita a conta inteira num lote? decide
   cache por-personagem vs bulk.
2. **Cookie no Windows**: Firefox lê limpo (lock quando aberto)? Playwright captura a sessão e
   ela persiste por semanas? (O caminho ABE saiu de cena — este spike encolheu.)
3. **Fidelidade numérica** (segundo ciclo, motor): 1 payload HoYoLAB + 1 Enka do mesmo UID
   provam que (a) `artifact.id` casa com Enka `relics.Items`; (b) `property_map` do HoYoLAB não
   tem id fora da tabela FightProp; (c) substats arredondados reconstroem sem ambiguidade; (d)
   HP/ATK/crit calculados batem até a 4ª casa com o próprio HoYoLAB e com o gcsim.
4. **Free tier na prática**: cold start do Neon após scale-to-zero; churn semanal real por
   perfil de jogador (só medível após ~4 semanas) — o parâmetro que decide se cabe em 0,5 GB.
5. **Tamanho das ~350 imagens** — decide `/public` (limite 250 MB no free) vs R2.

---

## 10. Riscos e lacunas honestas

- **Base quantitativa de snapshot é esboço.** Os bytes/linha e timings de Postgres da pesquisa
  não têm artefato reproduzível; sustentam ordem de grandeza, não precisão. Remediar com um
  script commitado rodando contra o payload real do spike 1. As três correções que **não**
  dependem de medição já estão aplicadas na §5: stats derivados fora do hash, discriminador de
  grupo em `state_stat`, e a separação raw_object/raw_observation.
- **ToS e risco de conta** ao acessar HoYoLAB via terceiro — decisão jurídica/de produto, com
  nome de decisor, antes de convidar usuários.
- **Legalidade de espelhar assets da HoYoverse** — mesma classe; a arte pertence à HoYoverse.
- **Rate limit real do HoYoLAB** além de `10101` ("30 contas/cookie/dia") — sem header de
  rate limit; medir no spike.
- **Multiplicadores de reação por nível, RES/DEF de inimigo, fórmulas lunares (6.x)** — não
  estão nas fontes primárias; são a quinta tabela e pertencem ao segundo ciclo. Não hardcodar
  lunares até haver corroboração de código.
- **Correlação de qualquer score de time com desempenho real (Abyss/Theater)** não é validada;
  os scores abertos são pesos mágicos. Se o produto prometer "esse time é forte", a métrica de
  validação precisa ser definida antes do algoritmo. Por isso: **curado primeiro**.

---

## 11. Fora de escopo (segundo ciclo)

- Implementações reais do motor (`curated → analytic → simulation`) e o banco de arquétipos.
- Regras de meta: builds ideais, substat priority, thresholds de ER, times sugeridos,
  sugestão de aquisição.
- Leitura automática de cookie de Chrome/Edge via decifração de store (descartada; login
  embutido cobre o caso).
- E2E de navegador; conteúdo de beta/pré-release; formato binário do doc canônico (CBOR).

---

## Apêndice — proveniência da pesquisa

O design foi informado por uma pesquisa técnica de 6 frentes, cada uma verificada por um
revisor adversarial. 5 frentes concluíram (API HoYoLAB, dados do jogo, domínio de builds,
stack web, modelagem de snapshots). A 6ª (leitura de cookie no Windows) **falhou no safeguard
`[cyber]` do modelo** ao sintetizar como contornar o ABE do Chrome — o que motivou a decisão de
não depender dessa técnica (§1.2). Os datasets reais baixados durante a verificação (Enka,
`allStat_gen`, AnimeGameData) confirmam tamanhos e valores citados e servirão de base para o
script de `@onewash/gi-data`.
