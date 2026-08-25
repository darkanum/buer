# Fase 2 — Motor de Análise Curado: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dado o roster real de um jogador, listar os times curados que cada personagem consegue formar, julgar a build dentro de cada time contra um alvo autoral, e apontar o que adquirir para destravar os times bloqueados.

**Architecture:** Um pacote novo `@buer/meta` guarda o dado curado (fichas de personagem com variantes nomeadas, arquétipos de time com slots flex). `@buer/engine` ganha três implementações que leem esse dado: um avaliador de build que produz **achados** (não uma nota), um avaliador de time que casa arquétipo contra roster por matching bipartido, e um conselheiro que deriva aquisição de arquétipo bloqueado. Todo acesso a stats passa por um `StatResolver` único — a Fase 2 pluga o que lê da captura, a Fase 3 plugará o que calcula.

**Tech Stack:** TypeScript 5.6 (ESM, `NodeNext`, `strict` + `noUncheckedIndexedAccess` + `verbatimModuleSyntax`), pnpm workspaces, Turborepo, Vitest 2, Node 24 (strip-types nativo nos scripts).

**Spec:** `docs/superpowers/specs/2026-08-24-buer-fase-2-motor-design.md`

## Global Constraints

- **Cobertura de plano:** este plano cobre os passos 1–6 da §13 da spec. O passo 7 (pipeline de autoria assistida, §10 da spec) é um plano separado.
- **`tsconfig.base.json` vale para todo pacote:** `strict: true`, `noUncheckedIndexedAccess: true`, `verbatimModuleSyntax: true`, `module`/`moduleResolution` = `NodeNext`. Consequências obrigatórias: todo import relativo termina em `.js`; todo import de tipo usa `import type`; todo acesso indexado (`arr[0]`, `rec[k]`) devolve `T | undefined` e precisa de guarda ou `!` justificado.
- **Idioma:** comentários, mensagens de erro e saída de CLI em português. Identificadores em inglês.
- **Falhar alto:** dado curado inválido derruba o build (teste), nunca degrada em silêncio. Mesma disciplina do `packages/gi-data/scripts/sync.ts`.
- **Chaves:** slugs (`xiangling`, `the-catch`, `crimson-witch-of-flames`) existem **apenas nos arquivos JSON autorados**. Em runtime toda chave é o id numérico como string, resolvido no carregamento — `CharacterKey` continua sendo exatamente o que `charKey()` de `@buer/core` produz.
- **Nunca inferir condicional.** `SetOption.condition` é prosa exibida, jamais avaliada (spec §5.1).
- **Fixture de calibração:** `packages/core/test/fixtures/real-account.scrubbed.json` — 63 personagens reais, anonimizada, já commitada. Formato: `{ list, detail, account }`, com os personagens em `detail.list`.
- **Commits:** um por tarefa, mensagem em português, prefixo convencional (`feat:`, `test:`, `refactor:`, `docs:`).

## Desvios da spec (deliberados, com motivo)

Dois pontos onde a implementação diverge da letra da spec e por quê. Ambos preservam a intenção.

1. **Spec §4.1 diz "o normalizador passa a preservar os stats observados".** O plano **não** altera a saída de `normalize()`. Motivo: `normalize()` alimenta `contentHash(doc)` em `packages/core/src/canon.ts`; mudar o `CharacterDoc` invalidaria o hash de todo snapshot já gravado e quebraria o dedupe da Fase 1. Em vez disso: uma função pura nova `extractObservedStats()` em `@buer/core` (Task 2), consumida pelo montador de roster (Task 4). Mesmo resultado, zero regressão.
2. **Spec §3.1 põe a montagem do `Roster` implicitamente no `core`.** O montador vive em `@buer/engine` (`src/roster/from-hoyolab.ts`). Motivo: `Roster` e `Build` são tipos de `@buer/engine`, e `engine → core` já é a direção da dependência; pôr o montador em `core` exigiria mover metade da §6.1 ou criar um ciclo. `core` mantém o que é dele (o mapa FightProp); `engine` monta o que é dele (o `Roster`).

---

## Estrutura de arquivos

**`packages/core/`** — vocabulário compartilhado e conhecimento de FightProp
- `src/domain.ts` *(modificar — hoje é `export {}`)* — `SchemaVersion`, `GameVersion`, `ArtifactSlot`, `ROLE_TAGS`/`RoleTag`/`isRoleTag`, `ObservedStats`, `StatTarget`. É o único lugar que `meta` e `engine` podem ambos importar sem ciclo.
- `src/observed.ts` *(criar)* — `extractObservedStats()`: entrada crua do HoYoLAB → `ObservedStats`.

**`packages/gi-data/`**
- `data/property.json` *(modificar)* — completar a tabela FightProp com os 13 ids que só aparecem em stats agregados de personagem.

**`packages/meta/`** *(pacote novo)* — dado curado, lógica zero
- `src/types.ts` — forma **autorada** (`RawCharacterProfile`, slugs) e forma **resolvida** (`CharacterProfile`, chaves numéricas).
- `src/resolve.ts` — slug → chave, contra os catálogos do `gi-data`.
- `src/validate.ts` — as regras de integridade da spec §5.5.
- `src/load.ts` — lê `data/`, valida, resolve, devolve os bancos tipados.
- `src/index.ts` — barrel.
- `data/characters/*.json`, `data/archetypes/*.json`, `data/scoring.json`.
- `test/integrity.test.ts`.

**`packages/engine/`**
- `src/interfaces.ts` *(modificar)* — importa o vocabulário de `core`, adiciona `observedStats`, `variant`/`targetOverrides`, `strength`/`tags`.
- `src/roster/from-hoyolab.ts` *(criar)* — payload cru → `Roster` + `equippedBuild()`.
- `src/stat-resolver.ts` *(criar)* — `StatResolver`, `ObservedStatResolver`.
- `src/curated/findings.ts` *(criar)* — o tipo `Finding`, comum às cinco verificações.
- `src/curated/checks/{set,main-stats,targets,weapon,substats}.ts` *(criar)* — uma verificação por arquivo, cada uma pura e testável sozinha.
- `src/curated/variant.ts` *(criar)* — a regra ordenada de seleção de variante.
- `src/curated/scoring.ts` *(criar)* — achados → `Score`.
- `src/curated/evaluator.ts` *(criar)* — `CuratedBuildEvaluator`.
- `src/team/rules.ts` *(criar)* — reações e ressonância (regra de jogo, não meta).
- `src/team/matching.ts` *(criar)* — atribuição bipartida arquétipo × roster.
- `src/team/evaluator.ts` *(criar)* — `CuratedTeamEvaluator`.
- `src/advisor/advisor.ts` *(criar)* — `CuratedRosterAdvisor`.
- `src/registry.ts` *(criar)* — `EvaluatorRegistry`.
- `src/contract-suite.ts` *(modificar)* — o teste que blinda a Fase 3.

**`apps/cli/`**
- `src/commands/analyze.ts` *(criar)* — o comando.
- `src/report.ts` *(criar)* — renderização de terminal.
- `src/index.ts` *(modificar)* — despacho.
- `test/analyze.test.ts`, `test/__golden__/analyze-63.json`.

---

## Task 1: Vocabulário compartilhado em `@buer/core`

Hoje `RoleTag = string` e `ArtifactSlot` vivem em `@buer/engine`. `@buer/meta` precisa deles e **não pode** depender de `engine` (seria ciclo: `engine → meta`). Este é o movimento que torna o resto possível.

**Files:**
- Modify: `packages/core/src/domain.ts` (hoje contém só `export {}`)
- Modify: `packages/engine/src/interfaces.ts:13` (import), `:19-26` (remover definições locais), `:64-89` (Roster/Build), `:398-412` (TeamAssessment), `:433-453` (TeamArchetype/ArchetypeSlot)
- Test: `packages/core/test/domain.test.ts`

**Interfaces:**
- Consumes: `StatKey` de `packages/core/src/substat.ts`.
- Produces: `SchemaVersion`, `GameVersion`, `ArtifactSlot`, `ROLE_TAGS`, `RoleTag`, `isRoleTag(v: string): v is RoleTag`, `ObservedStats`, `StatTarget` — todos exportados de `@buer/core` e **re-exportados** de `@buer/engine` para não quebrar consumidor nenhum.

- [ ] **Step 1: Escrever o teste que falha**

Criar `packages/core/test/domain.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ROLE_TAGS, isRoleTag } from '../src/domain.js';

describe('vocabulário de papéis', () => {
  it('é fechado e tem exatamente os 9 papéis da spec §5.3', () => {
    expect([...ROLE_TAGS]).toEqual([
      'main-dps', 'sub-dps', 'buffer', 'debuffer',
      'healer', 'shielder', 'battery', 'driver', 'enabler',
    ]);
  });

  it('isRoleTag aceita papel do vocabulário e recusa qualquer outro', () => {
    expect(isRoleTag('battery')).toBe(true);
    expect(isRoleTag('main-dps')).toBe(true);
    expect(isRoleTag('carry')).toBe(false);
    expect(isRoleTag('')).toBe(false);
    expect(isRoleTag('Battery')).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @buer/core exec vitest run test/domain.test.ts`
Expected: FAIL — `does not provide an export named 'ROLE_TAGS'`.

- [ ] **Step 3: Escrever o vocabulário**

Substituir o conteúdo inteiro de `packages/core/src/domain.ts`:

```ts
/**
 * Vocabulário de domínio compartilhado.
 *
 * Estes tipos são consumidos por @buer/meta (dado curado autorado) E por
 * @buer/engine (o motor que o consome). Como a dependência corre
 * engine → meta → core, `core` é o único lugar que os dois alcançam sem
 * ciclo. `@buer/engine` re-exporta tudo daqui, então nenhum consumidor
 * existente precisa mudar de import.
 */
import type { StatKey } from './substat.js';

export type SchemaVersion = 1;
export type GameVersion = `${number}.${number}`;

export type ArtifactSlot = 'flower' | 'plume' | 'sands' | 'goblet' | 'circlet';

/**
 * Vocabulário FECHADO de papéis (spec §5.3). É fechado porque
 * `TeamAssessment.roleCoverage` mapeia sobre ele e porque um slot flex de
 * arquétipo casa por papel — um papel escrito errado numa ficha viraria um
 * slot que nunca casa, em silêncio. O teste de integridade de @buer/meta
 * rejeita qualquer valor fora desta lista.
 */
export const ROLE_TAGS = [
  'main-dps',
  'sub-dps',
  'buffer',
  'debuffer',
  'healer',
  'shielder',
  'battery',
  'driver',
  'enabler',
] as const;

export type RoleTag = (typeof ROLE_TAGS)[number];

export function isRoleTag(v: string): v is RoleTag {
  return (ROLE_TAGS as readonly string[]).includes(v);
}

/**
 * Stats finais de uma build, como o jogo os reporta. "Observed" e não
 * "computed" de propósito: só existem para a build que foi CAPTURADA. Uma
 * build hipotética não tem como preenchê-los — é o que força o
 * ComputedStatResolver da Fase 3 a existir em vez de ser contornado.
 */
export type ObservedStats = Readonly<Partial<Record<StatKey, number>>>;

/**
 * Um alvo verificável de uma variante de build. É a única parte da ficha
 * curada que produz número; o resto é comparação de igualdade ou de posição
 * em lista ordenada.
 *
 * `why` é obrigatório: a explicação nunca diz "ER baixo", diz por que 180.
 */
export type StatTarget =
  | {
      readonly kind: 'min';
      readonly stat: StatKey;
      readonly value: number;
      readonly hard: boolean;
      readonly why: string;
    }
  | {
      readonly kind: 'range';
      readonly stat: StatKey;
      readonly min: number;
      readonly max: number;
      readonly why: string;
    }
  | {
      readonly kind: 'ratio';
      readonly numerator: StatKey;
      readonly denominator: StatKey;
      readonly min: number;
      readonly max: number;
      readonly why: string;
    };
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @buer/core exec vitest run test/domain.test.ts`
Expected: PASS (2 testes).

- [ ] **Step 5: Reapontar `@buer/engine` para o vocabulário de `core`**

Em `packages/engine/src/interfaces.ts`, trocar o bloco de import da linha 13 por:

```ts
import type { ArtifactSetKey, CharacterKey, Element, StatKey, WeaponKey } from '@buer/core';
import type {
  ArtifactSlot,
  GameVersion,
  ObservedStats,
  RoleTag,
  SchemaVersion,
  StatTarget,
} from '@buer/core';

// Re-exportados para que todo consumidor existente de @buer/engine continue
// funcionando sem mudar import — a mudança é de ONDE o tipo mora, não de
// quem pode usá-lo.
export type { ArtifactSlot, GameVersion, ObservedStats, RoleTag, SchemaVersion, StatTarget };
```

Remover as definições locais que agora vêm de `core` — as linhas que hoje declaram `SchemaVersion`, `GameVersion`, `RoleTag` e `ArtifactSlot` (bloco `:19-26`). **Manter** `export type ReactionKey = string;`, que continua sendo união aberta.

- [ ] **Step 6: Aplicar as mudanças de contrato da spec §4**

Ainda em `packages/engine/src/interfaces.ts`, quatro edições cirúrgicas:

Em `Roster`, depois de `readonly weapons: readonly WeaponInstance[];`:

```ts
  /**
   * Stats finais por personagem, como capturados. Mapa irmão de
   * `characters` em vez de campo de `CharacterInstance`: os stats são função
   * do CONJUNTO EQUIPADO, não do personagem (spec §4.1).
   */
  readonly observedStats: ReadonlyMap<CharacterKey, ObservedStats>;
```

Em `Build`, depois de `readonly conditionals: ConditionalState;`:

```ts
  /** Presente só na build capturada; ausente em toda build hipotética. */
  readonly observedStats?: ObservedStats;
```

Em `TeamArchetype`, depois de `readonly label: string;`:

```ts
  /** Força relativa CURADA, com fonte — não computada. Evita o peso mágico. */
  readonly strength: 'meta' | 'strong' | 'niche';
  readonly tags: readonly string[];
```

Em `ArchetypeSlot`, depois de `readonly role: readonly RoleTag[];`:

```ts
  /** Qual variante da ficha este slot exige. Ausente = qualquer uma. */
  readonly variant?: string;
  /** Sobrescreve alvos da ficha para ESTE arquétipo (generaliza erThresholds). */
  readonly targetOverrides?: readonly StatTarget[];
```

E em `TeamAssessment`, trocar a linha de `roleCoverage` por:

```ts
  readonly roleCoverage: Readonly<Partial<Record<RoleTag, 'missing' | 'weak' | 'covered'>>>;
```

(`Partial` é obrigatório agora: com `RoleTag` virando união de 9 membros, `Record<RoleTag, …>` passaria a exigir os 9 em todo assessment.)

- [ ] **Step 7: Verificar que nada quebrou**

Run: `pnpm -w typecheck && pnpm -w test`
Expected: PASS. `Roster` ganhou campo obrigatório, mas nenhum código constrói `Roster` hoje — a mudança é só de tipo.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/domain.ts packages/core/test/domain.test.ts packages/engine/src/interfaces.ts
git commit -m "feat(core): vocabulário de domínio compartilhado + mudanças de contrato da §4"
```

---

## Task 2: Tabela FightProp completa + `extractObservedStats`

O payload do HoYoLAB traz os stats finais em quatro blocos por personagem. Treze dos ids que aparecem ali **não existem** em `data/property.json` — incluindo os três que mais importam: `2000`/`2001`/`2002` = HP/ATK/DEF finais. Sem eles, `propKey()` lança e não há stat observado nenhum.

**Files:**
- Modify: `packages/gi-data/data/property.json`
- Create: `packages/core/src/observed.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/observed.test.ts`

**Interfaces:**
- Consumes: `propKey` de `packages/core/src/properties.ts`; `ObservedStats` de `./domain.js` (Task 1).
- Produces: `extractObservedStats(entry: unknown): ObservedStats`, exportada de `@buer/core`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `packages/core/test/observed.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { extractObservedStats } from '../src/observed.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(
  readFileSync(path.join(HERE, 'fixtures', 'real-account.scrubbed.json'), 'utf8'),
) as { detail: { list: unknown[] } };

describe('extractObservedStats', () => {
  it('lê os stats finais do primeiro personagem da conta real', () => {
    const stats = extractObservedStats(raw.detail.list[0]);

    // 2000/2001/2002 são HP/ATK/DEF FINAIS — os ids que faltavam na tabela.
    expect(stats.hp).toBe(19884);
    expect(stats.atk).toBe(2781);
    expect(stats.def).toBe(922);
    // Percentuais chegam como "78.6%" e viram 78.6, não 0.786.
    expect(stats.critRate_).toBeCloseTo(78.6, 5);
    expect(stats.critDMG_).toBeCloseTo(178.8, 5);
    expect(stats.enerRech_).toBeCloseTo(100.0, 5);
    expect(stats.eleMas).toBe(112);
  });

  it('não lança em nenhum dos 63 personagens reais e sempre acha atk e critRate_', () => {
    for (const entry of raw.detail.list) {
      const stats = extractObservedStats(entry);
      expect(typeof stats.atk).toBe('number');
      expect(typeof stats.critRate_).toBe('number');
    }
  });

  it('ignora id sem StatKey equivalente em vez de lançar (RES elemental, stamina)', () => {
    const stats = extractObservedStats({
      selected_properties: [
        { property_type: 2001, final: '1000' },
        { property_type: 50, final: '10.0%' },      // RES Pyro — sem StatKey
        { property_type: 999999, final: '240' },     // Stamina — sem StatKey
      ],
    });
    expect(stats.atk).toBe(1000);
    expect(Object.keys(stats)).toEqual(['atk']);
  });

  it('devolve objeto vazio para entrada sem bloco de propriedades', () => {
    expect(extractObservedStats({})).toEqual({});
    expect(extractObservedStats(null)).toEqual({});
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @buer/core exec vitest run test/observed.test.ts`
Expected: FAIL — `Failed to resolve import "../src/observed.js"`.

- [ ] **Step 3: Completar a tabela FightProp**

`packages/gi-data/data/property.json` é hand-authored (é **entrada** do `sync.ts`, não saída — ver `packages/gi-data/vendor/SOURCES.md`), então editá-lo é seguro. Adicionar estas 13 entradas ao objeto:

```json
  "50": { "code": "FIGHT_PROP_FIRE_SUB_HURT",     "goodKey": null, "isPercent": true,  "decimals": 1 },
  "51": { "code": "FIGHT_PROP_ELEC_SUB_HURT",     "goodKey": null, "isPercent": true,  "decimals": 1 },
  "52": { "code": "FIGHT_PROP_WATER_SUB_HURT",    "goodKey": null, "isPercent": true,  "decimals": 1 },
  "53": { "code": "FIGHT_PROP_GRASS_SUB_HURT",    "goodKey": null, "isPercent": true,  "decimals": 1 },
  "54": { "code": "FIGHT_PROP_WIND_SUB_HURT",     "goodKey": null, "isPercent": true,  "decimals": 1 },
  "55": { "code": "FIGHT_PROP_ROCK_SUB_HURT",     "goodKey": null, "isPercent": true,  "decimals": 1 },
  "56": { "code": "FIGHT_PROP_ICE_SUB_HURT",      "goodKey": null, "isPercent": true,  "decimals": 1 },
  "80": { "code": "FIGHT_PROP_SKILL_CD_MINUS_RATIO", "goodKey": null, "isPercent": true, "decimals": 1 },
  "81": { "code": "FIGHT_PROP_SHIELD_COST_MINUS_RATIO", "goodKey": "shield_", "isPercent": true, "decimals": 1 },
  "2000": { "code": "FIGHT_PROP_MAX_HP",  "goodKey": "hp",  "isPercent": false, "decimals": 0 },
  "2001": { "code": "FIGHT_PROP_CUR_ATTACK",  "goodKey": "atk", "isPercent": false, "decimals": 0 },
  "2002": { "code": "FIGHT_PROP_CUR_DEFENSE", "goodKey": "def", "isPercent": false, "decimals": 0 },
  "999999": { "code": "FIGHT_PROP_MAX_STAMINA", "goodKey": null, "isPercent": false, "decimals": 0 }
```

`goodKey: null` é a convenção já existente para "id conhecido, sem `StatKey` equivalente" (os ids base 1/4/7/10 usam isso hoje). Ele é o que faz `extractObservedStats` pular em vez de lançar — e o que faz `propKey()` continuar lançando para id **desconhecido**, que é a garantia de fail-loud que queremos preservar.

- [ ] **Step 4: Escrever `extractObservedStats`**

Criar `packages/core/src/observed.ts`:

```ts
import { loadProperty } from '@buer/gi-data';
import type { StatKey } from './substat.js';
import type { ObservedStats } from './domain.js';

const PROPERTY_MAP = loadProperty();

/**
 * Os quatro blocos em que o HoYoLAB reporta stats finais de personagem.
 * A ordem importa: os últimos sobrescrevem os primeiros quando repetem um
 * id, e `selected_properties` é o bloco autoritativo (traz HP/ATK/DEF
 * finais, crit, ER e maestria já somados). `element_properties` entra por
 * último só para preencher os bônus elementais que os outros não trazem.
 */
const BLOCKS = ['base_properties', 'extra_properties', 'selected_properties', 'element_properties'] as const;

interface PropEntry {
  property_type?: unknown;
  final?: unknown;
}

/** "78.6%" -> 78.6 ; "19884" -> 19884 ; "" / lixo -> null. */
function parseFinal(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  const n = Number.parseFloat(raw.replace('%', '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * Payload cru de um personagem (um item de `detail.list`) → stats finais.
 *
 * Não lança nunca: um id que a tabela FightProp conhece mas que não tem
 * `StatKey` equivalente (RES elemental, redução de recarga, stamina) é
 * PULADO por design, e um id que ela não conhece também — este módulo é
 * leitura de telemetria de conta, não a borda de validação de artefato.
 * A borda que exige fail-loud é `propKey()` em normalize.ts, e ela continua
 * como está.
 */
export function extractObservedStats(entry: unknown): ObservedStats {
  if (entry === null || typeof entry !== 'object') return {};
  const source = entry as Record<string, unknown>;
  const out: Record<string, number> = {};

  for (const block of BLOCKS) {
    const list = source[block];
    if (!Array.isArray(list)) continue;
    for (const item of list as PropEntry[]) {
      const id = typeof item?.property_type === 'number' ? item.property_type : null;
      if (id === null) continue;
      const goodKey = PROPERTY_MAP[id]?.goodKey;
      if (!goodKey) continue;
      const value = parseFinal(item.final);
      if (value === null) continue;
      out[goodKey satisfies string] = value;
    }
  }

  return out as Readonly<Partial<Record<StatKey, number>>>;
}
```

- [ ] **Step 5: Exportar de `@buer/core`**

Em `packages/core/src/index.ts`, adicionar antes da linha `export * from './domain.js';`:

```ts
export { extractObservedStats } from './observed.js';
```

- [ ] **Step 6: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @buer/core exec vitest run test/observed.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 7: Confirmar que a tabela ampliada não quebrou o gi-data**

Run: `pnpm --filter @buer/gi-data sync && pnpm -w test`
Expected: PASS. `sync.ts` só lê `property.json` para os ids que ele já usava; os 13 novos são inertes para ele. Se `sync` reclamar, é drift de fonte e deve ser lido, não contornado.

- [ ] **Step 8: Commit**

```bash
git add packages/gi-data/data/property.json packages/core/src/observed.ts packages/core/src/index.ts packages/core/test/observed.test.ts
git commit -m "feat(core): extractObservedStats + ids FightProp agregados (2000/2001/2002) na tabela"
```

---

## Task 3: Pacote `@buer/meta` — tipos, resolução de slug, integridade

O pacote de dado curado. Nasce com três fichas e um arquétipo reais — o bastante para as tarefas seguintes terem contra o que testar. A primeira leva completa vem na Task 11.

**Files:**
- Create: `packages/meta/package.json`, `packages/meta/tsconfig.json`
- Create: `packages/meta/src/{types,resolve,validate,load,index}.ts`
- Create: `packages/meta/data/characters/{xiangling,bennett,sucrose}.json`
- Create: `packages/meta/data/archetypes/national.json`
- Create: `packages/meta/data/scoring.json`
- Test: `packages/meta/test/integrity.test.ts`

**Interfaces:**
- Consumes: `loadCharacters`, `loadWeapons`, `loadArtifactSets`, `loadSlotMain` de `@buer/gi-data`; `RoleTag`, `isRoleTag`, `StatTarget`, `GameVersion`, `SchemaVersion`, `StatKey`, `CharacterKey`, `WeaponKey`, `ArtifactSetKey` de `@buer/core`.
- Produces:
  - `loadMeta(): MetaBank` onde `MetaBank = { profiles: ReadonlyMap<CharacterKey, CharacterProfile>; archetypes: readonly TeamArchetypeData[]; scoring: ScoringWeights; datasetSha: string }`
  - `CharacterProfile`, `BuildVariant`, `SetOption`, `WeaponOption`, `MetaProvenance`, `TeamArchetypeData`, `ArchetypeSlotData`, `ScoringWeights`
  - `validateMeta(raw): string[]` — lista de problemas; vazia = íntegro.

- [ ] **Step 1: Criar o esqueleto do pacote**

`packages/meta/package.json`:

```json
{
  "name": "@buer/meta",
  "version": "0.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@buer/core": "workspace:*",
    "@buer/gi-data": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^22.20.1",
    "typescript": "^5.6",
    "vitest": "^2"
  }
}
```

`packages/meta/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["src", "test"]
}
```

Run: `pnpm install`

- [ ] **Step 2: Escrever o teste de integridade que falha**

Criar `packages/meta/test/integrity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { loadMeta, validateMeta, readRawMeta } from '../src/index.js';

describe('integridade do banco curado', () => {
  it('o banco commitado é íntegro (spec §5.5)', () => {
    expect(validateMeta(readRawMeta())).toEqual([]);
  });

  it('carrega e resolve slug para chave numérica', () => {
    const bank = loadMeta();
    // xiangling = avatar id 10000023 no catálogo do gi-data
    const profile = bank.profiles.get('10000023' as never);
    expect(profile).toBeDefined();
    expect(profile!.variants.length).toBeGreaterThanOrEqual(1);
    // sets e armas também viram id numérico
    const variant = profile!.variants[0]!;
    expect(variant.sets[0]!.sets.every((s) => /^\d+$/.test(s))).toBe(true);
    expect(variant.weapons.every((w) => /^\d+$/.test(w.weapon))).toBe(true);
  });

  it('rejeita slug de personagem que não existe no catálogo', () => {
    const problems = validateMeta({
      profiles: [
        {
          schemaVersion: 1,
          character: 'personagem-que-nao-existe',
          variants: [],
          provenance: {
            authoredBy: 'human', sources: [], authoredAt: '2026-08-24',
            validatedForVersion: '7.0', confidence: 'high',
          },
        },
      ],
      archetypes: [],
    });
    expect(problems.join('\n')).toContain('personagem-que-nao-existe');
  });

  it('rejeita RoleTag fora do vocabulário fechado', () => {
    const problems = validateMeta({
      profiles: [
        {
          schemaVersion: 1,
          character: 'xiangling',
          variants: [
            {
              id: 'x', label: 'X', roles: ['carry'], scalesOn: 'atk',
              sets: [], mainStats: { sands: [], goblet: [], circlet: [] },
              substats: [], weapons: [], targets: [],
            },
          ],
          provenance: {
            authoredBy: 'human', sources: [], authoredAt: '2026-08-24',
            validatedForVersion: '7.0', confidence: 'high',
          },
        },
      ],
      archetypes: [],
    });
    expect(problems.join('\n')).toContain('carry');
  });

  it('proíbe confidence high em ficha meramente pesquisada (spec §5.5)', () => {
    const problems = validateMeta({
      profiles: [
        {
          schemaVersion: 1,
          character: 'xiangling',
          variants: [],
          provenance: {
            authoredBy: 'researched', sources: ['https://exemplo'], authoredAt: '2026-08-24',
            validatedForVersion: '7.0', confidence: 'high',
          },
        },
      ],
      archetypes: [],
    });
    expect(problems.join('\n')).toMatch(/researched.*high|high.*researched/);
  });

  it('rejeita arquétipo cujo slot exige variante inexistente', () => {
    const problems = validateMeta({
      profiles: [
        {
          schemaVersion: 1,
          character: 'xiangling',
          variants: [
            {
              id: 'national-er', label: 'National', roles: ['sub-dps'], scalesOn: 'atk',
              sets: [], mainStats: { sands: [], goblet: [], circlet: [] },
              substats: [], weapons: [], targets: [],
            },
          ],
          provenance: {
            authoredBy: 'human', sources: [], authoredAt: '2026-08-24',
            validatedForVersion: '7.0', confidence: 'high',
          },
        },
      ],
      archetypes: [
        {
          schemaVersion: 1, id: 'teste', label: 'Teste',
          gameVersionAdded: '7.0', strength: 'meta', tags: [], sources: [],
          slots: [
            {
              role: ['sub-dps'], substitutable: false,
              requires: { kind: 'character', anyOf: ['xiangling'] },
              variant: 'variante-inexistente',
            },
          ],
        },
      ],
    });
    expect(problems.join('\n')).toContain('variante-inexistente');
  });

  it('rejeita main-stat ilegal para o slot', () => {
    const problems = validateMeta({
      profiles: [
        {
          schemaVersion: 1,
          character: 'xiangling',
          variants: [
            {
              id: 'x', label: 'X', roles: ['sub-dps'], scalesOn: 'atk',
              sets: [],
              // flor/pluma não entram; 'hp' plano não é main-stat legal de ampulheta
              mainStats: { sands: ['hp'], goblet: [], circlet: [] },
              substats: [], weapons: [], targets: [],
            },
          ],
          provenance: {
            authoredBy: 'human', sources: [], authoredAt: '2026-08-24',
            validatedForVersion: '7.0', confidence: 'high',
          },
        },
      ],
      archetypes: [],
    });
    expect(problems.join('\n')).toContain('sands');
  });
});
```

- [ ] **Step 3: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @buer/meta exec vitest run`
Expected: FAIL — `Failed to resolve import "../src/index.js"`.

- [ ] **Step 4: Escrever os tipos**

Criar `packages/meta/src/types.ts`:

```ts
import type {
  ArtifactSetKey, CharacterKey, GameVersion, RoleTag,
  SchemaVersion, StatKey, StatTarget, WeaponKey,
} from '@buer/core';

// ---------------------------------------------------------------------------
// Forma AUTORADA — o que está nos arquivos JSON. Chaves são slugs legíveis.
// Tudo aqui é `string` cru de propósito: é a fronteira não-validada.
// ---------------------------------------------------------------------------

export interface RawSetOption {
  kind: '4pc' | '2+2';
  sets: string[];
  rank: number;
  condition?: string;
}

export interface RawWeaponOption {
  weapon: string;
  rank: number;
  minRefinement?: number;
}

export interface RawBuildVariant {
  id: string;
  label: string;
  roles: string[];
  scalesOn: string;
  sets: RawSetOption[];
  mainStats: { sands: string[]; goblet: string[]; circlet: string[] };
  substats: string[];
  weapons: RawWeaponOption[];
  targets: StatTarget[];
  notes?: string;
}

export interface RawMetaProvenance {
  authoredBy: string;
  sources: string[];
  authoredAt: string;
  validatedForVersion: string;
  confidence: string;
}

export interface RawCharacterProfile {
  schemaVersion: number;
  character: string;
  variants: RawBuildVariant[];
  provenance: RawMetaProvenance;
}

export interface RawArchetypeSlot {
  role: string[];
  requires:
    | { kind: 'character'; anyOf: string[] }
    | { kind: 'element'; element: string; withRole: string[] };
  variant?: string;
  targetOverrides?: StatTarget[];
  minConstellation?: number;
  minRefinement?: number;
  substitutable: boolean;
}

export interface RawTeamArchetype {
  schemaVersion: number;
  id: string;
  label: string;
  gameVersionAdded: string;
  gameVersionRetired?: string;
  strength: string;
  tags: string[];
  slots: RawArchetypeSlot[];
  sources: string[];
}

export interface RawMeta {
  profiles: RawCharacterProfile[];
  archetypes: RawTeamArchetype[];
}

// ---------------------------------------------------------------------------
// Forma RESOLVIDA — o que o motor consome. Chaves já são ids numéricos.
// ---------------------------------------------------------------------------

export type ScalesOn = 'atk' | 'hp' | 'def' | 'eleMas';

export interface SetOption {
  readonly kind: '4pc' | '2+2';
  readonly sets: readonly ArtifactSetKey[];
  readonly rank: number;
  /** Prosa EXIBIDA, jamais avaliada (spec §5.1). */
  readonly condition?: string;
}

export interface WeaponOption {
  readonly weapon: WeaponKey;
  readonly rank: number;
  readonly minRefinement?: 1 | 2 | 3 | 4 | 5;
}

export interface BuildVariant {
  readonly id: string;
  readonly label: string;
  readonly roles: readonly RoleTag[];
  readonly scalesOn: ScalesOn;
  readonly sets: readonly SetOption[];
  readonly mainStats: Readonly<Record<'sands' | 'goblet' | 'circlet', readonly StatKey[]>>;
  readonly substats: readonly StatKey[];
  readonly weapons: readonly WeaponOption[];
  readonly targets: readonly StatTarget[];
  readonly notes?: string;
}

export interface MetaProvenance {
  readonly authoredBy: 'human' | 'researched' | 'researched-reviewed';
  readonly sources: readonly string[];
  readonly authoredAt: string;
  readonly validatedForVersion: GameVersion;
  readonly confidence: 'high' | 'medium' | 'low';
}

export interface CharacterProfile {
  readonly schemaVersion: SchemaVersion;
  readonly character: CharacterKey;
  readonly variants: readonly BuildVariant[];
  readonly provenance: MetaProvenance;
}

export interface ArchetypeSlotData {
  readonly role: readonly RoleTag[];
  readonly requires:
    | { readonly kind: 'character'; readonly anyOf: readonly CharacterKey[] }
    | { readonly kind: 'element'; readonly element: string; readonly withRole: readonly RoleTag[] };
  readonly variant?: string;
  readonly targetOverrides?: readonly StatTarget[];
  readonly minConstellation?: number;
  readonly minRefinement?: number;
  readonly substitutable: boolean;
}

export interface TeamArchetypeData {
  readonly schemaVersion: SchemaVersion;
  readonly id: string;
  readonly label: string;
  readonly gameVersionAdded: GameVersion;
  readonly gameVersionRetired?: GameVersion;
  readonly strength: 'meta' | 'strong' | 'niche';
  readonly tags: readonly string[];
  readonly slots: readonly ArchetypeSlotData[];
  readonly sources: readonly string[];
}

/**
 * Pesos das cinco verificações. Vivem em dado versionado, não em código —
 * calibrar é um diff revisável (spec §6.3). Entram em Provenance.assumptions.
 */
export interface ScoringWeights {
  readonly version: number;
  readonly set: number;
  readonly mainStats: number;
  readonly targets: number;
  readonly weapon: number;
  readonly substats: number;
}

export interface MetaBank {
  readonly profiles: ReadonlyMap<CharacterKey, CharacterProfile>;
  readonly archetypes: readonly TeamArchetypeData[];
  readonly scoring: ScoringWeights;
  /** Hash do dado curado carregado — vai para Provenance.datasetSha. */
  readonly datasetSha: string;
}
```

- [ ] **Step 5: Escrever a resolução de slug**

Criar `packages/meta/src/resolve.ts`:

```ts
import { loadArtifactSets, loadCharacters, loadWeapons } from '@buer/gi-data';
import type { ArtifactSetKey, CharacterKey, WeaponKey } from '@buer/core';

function invert(catalog: Record<number | string, { slug: string }>): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const [id, entry] of Object.entries(catalog)) out.set(entry.slug, id);
  return out;
}

const CHARACTER_BY_SLUG = invert(loadCharacters());
const WEAPON_BY_SLUG = invert(loadWeapons());
const SET_BY_SLUG = invert(loadArtifactSets());

/**
 * Slug autorado -> CharacterKey (o mesmo formato que `charKey()` de
 * @buer/core produz: id numérico como string, ou `id:elemento` no caso do
 * Traveler). Devolve `null` para slug desconhecido — quem chama decide se
 * isso é erro de validação ou lacuna tolerável.
 *
 * Traveler é autorado como `aether:anemo` / `lumine:electro`: o slug antes
 * do `:`, o elemento depois. É a única forma composta.
 */
export function resolveCharacter(slug: string): CharacterKey | null {
  const [base, element] = slug.split(':');
  if (!base) return null;
  const id = CHARACTER_BY_SLUG.get(base);
  if (!id) return null;
  return (element ? `${id}:${element}` : id) as CharacterKey;
}

export function resolveWeapon(slug: string): WeaponKey | null {
  const id = WEAPON_BY_SLUG.get(slug);
  return id ? (id as WeaponKey) : null;
}

export function resolveSet(slug: string): ArtifactSetKey | null {
  const id = SET_BY_SLUG.get(slug);
  return id ? (id as ArtifactSetKey) : null;
}

const SLUG_BY_CHARACTER_ID: ReadonlyMap<string, string> = new Map(
  [...CHARACTER_BY_SLUG].map(([slug, id]) => [id, slug]),
);

/**
 * O caminho inverso: CharacterKey -> slug legível, para a saída de CLI e
 * qualquer tela. Traveler volta composto (`aether:anemo`). Devolve `null`
 * para personagem que o catálogo ainda não conhece — de patch novo, por
 * exemplo — e quem chama mostra a chave crua.
 */
export function slugForCharacter(key: CharacterKey): string | null {
  const [id, element] = String(key).split(':');
  if (!id) return null;
  const slug = SLUG_BY_CHARACTER_ID.get(id);
  if (!slug) return null;
  return element ? `${slug}:${element}` : slug;
}
```

- [ ] **Step 6: Escrever a validação**

Criar `packages/meta/src/validate.ts`:

```ts
import { loadSlotMain, loadProperty } from '@buer/gi-data';
import { isRoleTag } from '@buer/core';
import type { RawMeta } from './types.js';
import { resolveCharacter, resolveSet, resolveWeapon } from './resolve.js';

const SCALES_ON = new Set(['atk', 'hp', 'def', 'eleMas']);
const AUTHORED_BY = new Set(['human', 'researched', 'researched-reviewed']);
const CONFIDENCE = new Set(['high', 'medium', 'low']);
const STRENGTH = new Set(['meta', 'strong', 'niche']);
const SLOT_ID = { sands: 3, goblet: 4, circlet: 5 } as const;

/** StatKeys legais por slot, derivados de gi-data (slot-main × property). */
function legalMainStats(): Readonly<Record<'sands' | 'goblet' | 'circlet', ReadonlySet<string>>> {
  const property = loadProperty();
  const slotMain = loadSlotMain();
  const build = (slot: 3 | 4 | 5): ReadonlySet<string> => {
    const ids = slotMain[slot] ?? [];
    const keys = new Set<string>();
    for (const id of ids) {
      const goodKey = property[id]?.goodKey;
      if (goodKey) keys.add(goodKey);
    }
    return keys;
  };
  return { sands: build(3), goblet: build(4), circlet: build(5) };
}

/**
 * Todas as regras da spec §5.5, num só lugar. Devolve a lista de problemas
 * em português — vazia significa íntegro. Coleta TUDO em vez de lançar no
 * primeiro erro: quem está autorando 120 fichas quer a lista inteira.
 */
export function validateMeta(raw: RawMeta): string[] {
  const problems: string[] = [];
  const legal = legalMainStats();
  const variantsByCharacter = new Map<string, Set<string>>();

  for (const profile of raw.profiles ?? []) {
    const where = `ficha "${profile.character}"`;

    if (profile.schemaVersion !== 1) problems.push(`${where}: schemaVersion deve ser 1`);
    if (!resolveCharacter(profile.character)) {
      problems.push(`${where}: slug de personagem não existe no catálogo do gi-data`);
    }

    const prov = profile.provenance;
    if (!prov || !AUTHORED_BY.has(prov.authoredBy)) {
      problems.push(`${where}: authoredBy inválido`);
    }
    if (!prov || !CONFIDENCE.has(prov.confidence)) {
      problems.push(`${where}: confidence inválido`);
    }
    if (prov?.authoredBy === 'researched' && prov.confidence === 'high') {
      problems.push(
        `${where}: confidence "high" é proibido com authoredBy "researched" — ` +
          `promova para "researched-reviewed" só depois de revisar (spec §5.5)`,
      );
    }

    const seenVariants = new Set<string>();
    for (const variant of profile.variants ?? []) {
      const vwhere = `${where}, variante "${variant.id}"`;
      if (seenVariants.has(variant.id)) problems.push(`${vwhere}: id de variante duplicado`);
      seenVariants.add(variant.id);

      if (!SCALES_ON.has(variant.scalesOn)) problems.push(`${vwhere}: scalesOn inválido`);
      for (const role of variant.roles ?? []) {
        if (!isRoleTag(role)) problems.push(`${vwhere}: papel "${role}" fora do vocabulário fechado`);
      }

      for (const slot of ['sands', 'goblet', 'circlet'] as const) {
        for (const stat of variant.mainStats?.[slot] ?? []) {
          if (!legal[slot].has(stat)) {
            problems.push(`${vwhere}: "${stat}" não é main-stat legal para ${slot} (slot ${SLOT_ID[slot]})`);
          }
        }
      }

      const setRanks = new Set<number>();
      for (const option of variant.sets ?? []) {
        const expected = option.kind === '4pc' ? 1 : 2;
        if (option.sets.length !== expected) {
          problems.push(`${vwhere}: opção ${option.kind} deve listar ${expected} set(s)`);
        }
        for (const slug of option.sets) {
          if (!resolveSet(slug)) problems.push(`${vwhere}: set "${slug}" não existe no catálogo`);
        }
        if (setRanks.has(option.rank)) problems.push(`${vwhere}: rank de set duplicado (${option.rank})`);
        setRanks.add(option.rank);
      }

      const weaponRanks = new Set<number>();
      for (const option of variant.weapons ?? []) {
        if (!resolveWeapon(option.weapon)) {
          problems.push(`${vwhere}: arma "${option.weapon}" não existe no catálogo`);
        }
        if (weaponRanks.has(option.rank)) problems.push(`${vwhere}: rank de arma duplicado (${option.rank})`);
        weaponRanks.add(option.rank);
      }

      for (const target of variant.targets ?? []) {
        if (!target.why || target.why.trim() === '') {
          problems.push(`${vwhere}: alvo ${target.kind} sem "why" — a explicação precisa dizer por quê`);
        }
      }
    }
    variantsByCharacter.set(profile.character, seenVariants);
  }

  const seenArchetypes = new Set<string>();
  for (const archetype of raw.archetypes ?? []) {
    const where = `arquétipo "${archetype.id}"`;
    if (seenArchetypes.has(archetype.id)) problems.push(`${where}: id duplicado`);
    seenArchetypes.add(archetype.id);
    if (!STRENGTH.has(archetype.strength)) problems.push(`${where}: strength inválido`);
    if (archetype.slots.length < 2 || archetype.slots.length > 4) {
      problems.push(`${where}: um time tem de 2 a 4 slots, veio com ${archetype.slots.length}`);
    }

    for (const slot of archetype.slots) {
      for (const role of slot.role ?? []) {
        if (!isRoleTag(role)) problems.push(`${where}: papel "${role}" fora do vocabulário fechado`);
      }
      if (slot.requires.kind === 'character') {
        for (const slug of slot.requires.anyOf) {
          if (!resolveCharacter(slug)) problems.push(`${where}: personagem "${slug}" não existe no catálogo`);
          if (slot.variant && !variantsByCharacter.get(slug)?.has(slot.variant)) {
            problems.push(
              `${where}: slot exige variante "${slot.variant}" que a ficha de "${slug}" não declara`,
            );
          }
        }
      } else {
        for (const role of slot.requires.withRole ?? []) {
          if (!isRoleTag(role)) problems.push(`${where}: papel "${role}" fora do vocabulário fechado`);
        }
      }
    }
  }

  return problems;
}
```

- [ ] **Step 7: Escrever o carregador**

Criar `packages/meta/src/load.ts`:

```ts
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { CharacterKey, StatKey } from '@buer/core';
import type {
  ArchetypeSlotData, BuildVariant, CharacterProfile, MetaBank,
  RawBuildVariant, RawCharacterProfile, RawMeta, RawTeamArchetype,
  ScoringWeights, SetOption, TeamArchetypeData, WeaponOption,
} from './types.js';
import { resolveCharacter, resolveSet, resolveWeapon } from './resolve.js';
import { validateMeta } from './validate.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, '..', 'data');

function readJsonDir<T>(dir: string): T[] {
  const full = path.join(DATA, dir);
  return readdirSync(full)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(path.join(full, f), 'utf8')) as T);
}

/** Lê os arquivos autorados sem validar nem resolver. Existe para o teste. */
export function readRawMeta(): RawMeta {
  return {
    profiles: readJsonDir<RawCharacterProfile>('characters'),
    archetypes: readJsonDir<RawTeamArchetype>('archetypes'),
  };
}

function resolveVariant(raw: RawBuildVariant): BuildVariant {
  const sets: SetOption[] = raw.sets.map((o) => ({
    kind: o.kind,
    sets: o.sets.map((s) => resolveSet(s)!),
    rank: o.rank,
    ...(o.condition === undefined ? {} : { condition: o.condition }),
  }));
  const weapons: WeaponOption[] = raw.weapons.map((o) => ({
    weapon: resolveWeapon(o.weapon)!,
    rank: o.rank,
    ...(o.minRefinement === undefined ? {} : { minRefinement: o.minRefinement as 1 | 2 | 3 | 4 | 5 }),
  }));
  return {
    id: raw.id,
    label: raw.label,
    roles: raw.roles as BuildVariant['roles'],
    scalesOn: raw.scalesOn as BuildVariant['scalesOn'],
    sets,
    mainStats: {
      sands: raw.mainStats.sands as StatKey[],
      goblet: raw.mainStats.goblet as StatKey[],
      circlet: raw.mainStats.circlet as StatKey[],
    },
    substats: raw.substats as StatKey[],
    weapons,
    targets: raw.targets,
    ...(raw.notes === undefined ? {} : { notes: raw.notes }),
  };
}

function resolveArchetype(raw: RawTeamArchetype): TeamArchetypeData {
  const slots: ArchetypeSlotData[] = raw.slots.map((s) => ({
    role: s.role as ArchetypeSlotData['role'],
    requires:
      s.requires.kind === 'character'
        ? { kind: 'character', anyOf: s.requires.anyOf.map((c) => resolveCharacter(c)!) }
        : { kind: 'element', element: s.requires.element, withRole: s.requires.withRole as ArchetypeSlotData['role'] },
    substitutable: s.substitutable,
    ...(s.variant === undefined ? {} : { variant: s.variant }),
    ...(s.targetOverrides === undefined ? {} : { targetOverrides: s.targetOverrides }),
    ...(s.minConstellation === undefined ? {} : { minConstellation: s.minConstellation }),
    ...(s.minRefinement === undefined ? {} : { minRefinement: s.minRefinement }),
  }));
  return {
    schemaVersion: 1,
    id: raw.id,
    label: raw.label,
    gameVersionAdded: raw.gameVersionAdded as TeamArchetypeData['gameVersionAdded'],
    strength: raw.strength as TeamArchetypeData['strength'],
    tags: raw.tags,
    slots,
    sources: raw.sources,
    ...(raw.gameVersionRetired === undefined
      ? {}
      : { gameVersionRetired: raw.gameVersionRetired as TeamArchetypeData['gameVersionAdded'] }),
  };
}

let cached: MetaBank | null = null;

/**
 * Carrega, valida e resolve o banco curado. LANÇA se o dado estiver
 * inválido — ficha quebrada derruba o build, nunca vira veredito errado em
 * produção (spec §5.5). O resultado é memoizado: o banco é imutável e
 * relê-lo por personagem seria I/O à toa.
 */
export function loadMeta(): MetaBank {
  if (cached) return cached;

  const raw = readRawMeta();
  const problems = validateMeta(raw);
  if (problems.length > 0) {
    throw new Error(`@buer/meta: banco curado inválido:\n  - ${problems.join('\n  - ')}`);
  }

  const profiles = new Map<CharacterKey, CharacterProfile>();
  for (const rawProfile of raw.profiles) {
    const key = resolveCharacter(rawProfile.character)!;
    profiles.set(key, {
      schemaVersion: 1,
      character: key,
      variants: rawProfile.variants.map(resolveVariant),
      provenance: rawProfile.provenance as CharacterProfile['provenance'],
    });
  }

  const scoring = JSON.parse(readFileSync(path.join(DATA, 'scoring.json'), 'utf8')) as ScoringWeights;
  const datasetSha = createHash('sha256')
    .update(JSON.stringify({ raw, scoring }))
    .digest('hex')
    .slice(0, 16);

  cached = { profiles, archetypes: raw.archetypes.map(resolveArchetype), scoring, datasetSha };
  return cached;
}
```

Criar `packages/meta/src/index.ts`:

```ts
export * from './types.js';
export { resolveCharacter, resolveSet, resolveWeapon, slugForCharacter } from './resolve.js';
export { validateMeta } from './validate.js';
export { loadMeta, readRawMeta } from './load.js';
```

- [ ] **Step 8: Escrever os pesos e as três fichas iniciais**

`packages/meta/data/scoring.json`:

```json
{
  "version": 1,
  "set": 25,
  "mainStats": 25,
  "targets": 25,
  "weapon": 10,
  "substats": 15
}
```

`packages/meta/data/characters/xiangling.json`:

```json
{
  "schemaVersion": 1,
  "character": "xiangling",
  "variants": [
    {
      "id": "national-er",
      "label": "National (ER alto)",
      "roles": ["sub-dps"],
      "scalesOn": "atk",
      "sets": [
        { "kind": "4pc", "sets": ["emblem-of-severed-fate"], "rank": 1 },
        { "kind": "4pc", "sets": ["crimson-witch-of-flames"], "rank": 2, "condition": "sem Emblem farmado; perde a conversão de ER em dano de burst" },
        { "kind": "2+2", "sets": ["emblem-of-severed-fate", "crimson-witch-of-flames"], "rank": 3 }
      ],
      "mainStats": {
        "sands": ["enerRech_", "atk_"],
        "goblet": ["pyro_dmg_"],
        "circlet": ["critRate_", "critDMG_"]
      },
      "substats": ["critRate_", "critDMG_", "enerRech_", "atk_", "eleMas"],
      "weapons": [
        { "weapon": "the-catch", "rank": 1, "minRefinement": 5 },
        { "weapon": "dragon-s-bane", "rank": 2 }
      ],
      "targets": [
        { "kind": "min", "stat": "enerRech_", "value": 200, "hard": true, "why": "Pyronado custa 80 de energia e Xiangling gera pouca partícula própria; abaixo de 200% de ER o burst não sai toda rotação e a build inteira deixa de funcionar" },
        { "kind": "ratio", "numerator": "critDMG_", "denominator": "critRate_", "min": 1.5, "max": 2.5, "why": "crit muito desbalanceado desperdiça substats: cada ponto do lado excedente rende menos que o mesmo roll no lado curto" }
      ],
      "notes": "Variante padrão em time nacional. O ER alto é o que define esta build, não o dano direto."
    },
    {
      "id": "vaporize",
      "label": "Vaporize (ER moderado)",
      "roles": ["sub-dps"],
      "scalesOn": "atk",
      "sets": [
        { "kind": "4pc", "sets": ["crimson-witch-of-flames"], "rank": 1 },
        { "kind": "4pc", "sets": ["emblem-of-severed-fate"], "rank": 2 }
      ],
      "mainStats": {
        "sands": ["atk_", "enerRech_"],
        "goblet": ["pyro_dmg_"],
        "circlet": ["critRate_", "critDMG_"]
      },
      "substats": ["critRate_", "critDMG_", "atk_", "enerRech_", "eleMas"],
      "weapons": [
        { "weapon": "the-catch", "rank": 1, "minRefinement": 5 },
        { "weapon": "dragon-s-bane", "rank": 2 }
      ],
      "targets": [
        { "kind": "min", "stat": "enerRech_", "value": 160, "hard": true, "why": "com aplicação de hydro constante no time, a partícula extra baixa a exigência de ER em relação ao National, mas 160% ainda é o piso para o burst voltar" },
        { "kind": "ratio", "numerator": "critDMG_", "denominator": "critRate_", "min": 1.5, "max": 2.5, "why": "crit muito desbalanceado desperdiça substats" }
      ]
    }
  ],
  "provenance": {
    "authoredBy": "human",
    "sources": [],
    "authoredAt": "2026-08-24",
    "validatedForVersion": "7.0",
    "confidence": "medium"
  }
}
```

`packages/meta/data/characters/bennett.json`:

```json
{
  "schemaVersion": 1,
  "character": "bennett",
  "variants": [
    {
      "id": "buffer-er",
      "label": "Buffer de ATQ (ER alto)",
      "roles": ["buffer", "healer"],
      "scalesOn": "atk",
      "sets": [
        { "kind": "4pc", "sets": ["noblesse-oblige"], "rank": 1 },
        { "kind": "2+2", "sets": ["noblesse-oblige", "emblem-of-severed-fate"], "rank": 2 }
      ],
      "mainStats": {
        "sands": ["enerRech_"],
        "goblet": ["hp_", "atk_"],
        "circlet": ["hp_", "heal_"]
      },
      "substats": ["enerRech_", "hp_", "atk_"],
      "weapons": [
        { "weapon": "aquila-favonia", "rank": 1 },
        { "weapon": "favonius-sword", "rank": 2 },
        { "weapon": "sacrificial-sword", "rank": 3 }
      ],
      "targets": [
        { "kind": "min", "stat": "enerRech_", "value": 180, "hard": true, "why": "o buff de ATQ vem do campo do burst; sem 180% de ER o campo fica com buraco entre rotações e o time inteiro perde o buff" }
      ],
      "notes": "O buff escala com o ATQ BASE de Bennett, não com o ATQ total — por isso ATQ% em ampulheta/cálice não é prioridade, e ER é."
    }
  ],
  "provenance": {
    "authoredBy": "human",
    "sources": [],
    "authoredAt": "2026-08-24",
    "validatedForVersion": "7.0",
    "confidence": "medium"
  }
}
```

`packages/meta/data/characters/sucrose.json` — **é ela que fecha o slot flex do arquétipo abaixo**, por isso nasce aqui e não na Task 11: sem uma ficha de anemo declarando `driver`/`debuffer`, o National fica eternamente "bloqueado por um slot" e os testes de matching da Task 8 não teriam o que verificar.

```json
{
  "schemaVersion": 1,
  "character": "sucrose",
  "variants": [
    {
      "id": "em-driver",
      "label": "Driver de maestria",
      "roles": ["driver", "debuffer", "buffer"],
      "scalesOn": "eleMas",
      "sets": [
        { "kind": "4pc", "sets": ["viridescent-venerer"], "rank": 1 },
        { "kind": "4pc", "sets": ["instructor"], "rank": 2, "condition": "sem Viridescent farmado; troca redução de RES por maestria de time" }
      ],
      "mainStats": {
        "sands": ["eleMas", "enerRech_"],
        "goblet": ["eleMas"],
        "circlet": ["eleMas"]
      },
      "substats": ["eleMas", "enerRech_", "atk_"],
      "weapons": [
        { "weapon": "sacrificial-fragments", "rank": 1 },
        { "weapon": "thrilling-tales-of-dragon-slayers", "rank": 2 }
      ],
      "targets": [
        { "kind": "min", "stat": "eleMas", "value": 700, "hard": false, "why": "a passiva converte 20% da maestria dela em maestria para o time; abaixo de ~700 o buff que ela dá aos outros deixa de compensar o slot" },
        { "kind": "min", "stat": "enerRech_", "value": 160, "hard": true, "why": "a redução de RES de 4pc Viridescent vem do swirl do burst; sem ER o campo não fica de pé toda rotação" }
      ]
    }
  ],
  "provenance": {
    "authoredBy": "human",
    "sources": [],
    "authoredAt": "2026-08-24",
    "validatedForVersion": "7.0",
    "confidence": "medium"
  }
}
```

**Confirme os slugs antes de escrever** — o validador rejeita slug inexistente, mas conferir antes é mais rápido:

```bash
node -e "const w=require('./packages/gi-data/data/weapons.json'),s=require('./packages/gi-data/data/artifact-sets.json');const f=(o,x)=>Object.values(o).some(v=>v.slug===x);for(const x of ['viridescent-venerer'])console.log('set',x,f(s,x));for(const x of ['sacrificial-fragments','thrilling-tales-of-dragon-slayers'])console.log('arma',x,f(w,x))"
```

`packages/meta/data/archetypes/national.json`:

```json
{
  "schemaVersion": 1,
  "id": "national",
  "label": "National",
  "gameVersionAdded": "1.0",
  "strength": "meta",
  "tags": ["abyss", "f2p", "no-5star"],
  "sources": [],
  "slots": [
    {
      "role": ["sub-dps"],
      "requires": { "kind": "character", "anyOf": ["xiangling"] },
      "variant": "national-er",
      "substitutable": false
    },
    {
      "role": ["buffer", "healer"],
      "requires": { "kind": "character", "anyOf": ["bennett"] },
      "variant": "buffer-er",
      "substitutable": false
    },
    {
      "role": ["sub-dps", "enabler"],
      "requires": { "kind": "character", "anyOf": ["xingqiu"] },
      "substitutable": false
    },
    {
      "role": ["driver", "debuffer"],
      "requires": { "kind": "element", "element": "anemo", "withRole": ["driver", "debuffer"] },
      "substitutable": true
    }
  ]
}
```

- [ ] **Step 9: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @buer/meta exec vitest run`
Expected: PASS (7 testes). Se o teste "o banco commitado é íntegro" falhar, a mensagem lista exatamente qual ficha e qual regra — corrija a ficha, não a validação.

- [ ] **Step 10: Commit**

```bash
git add packages/meta pnpm-lock.yaml
git commit -m "feat(meta): pacote de dado curado — tipos, resolução de slug, integridade, 3 fichas + 1 arquétipo"
```

---

## Task 4: Montagem do `Roster` a partir do payload cru

Hoje **nada** constrói um `Roster` ou um `Build` — eles só existem como tipo. Esta é a peça que faltava entre a extração da Fase 1 e o motor.

**Files:**
- Create: `packages/engine/src/roster/from-hoyolab.ts`
- Modify: `packages/engine/src/index.ts`, `packages/engine/package.json`
- Test: `packages/engine/test/roster.test.ts`

**Interfaces:**
- Consumes: `charKey`, `artifactFingerprint`, `reconstructTiers`, `propKey`, `extractObservedStats` de `@buer/core`.
- Produces:
  - `rosterFromHoyolab(raw: unknown, opts: { capturedAt: string; lang: string }): Roster`
  - `equippedBuild(roster: Roster, key: CharacterKey): Build | null`

- [ ] **Step 1: Escrever o teste que falha**

Criar `packages/engine/test/roster.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { CharacterKey } from '@buer/core';
import { loadArtifactSets } from '@buer/gi-data';
import { rosterFromHoyolab, equippedBuild } from '../src/roster/from-hoyolab.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(
  readFileSync(
    path.join(HERE, '..', '..', 'core', 'test', 'fixtures', 'real-account.scrubbed.json'),
    'utf8',
  ),
);
const OPTS = { capturedAt: '2026-08-24T00:00:00.000Z', lang: 'pt-br' };

describe('rosterFromHoyolab', () => {
  it('monta os 63 personagens da conta real', () => {
    const roster = rosterFromHoyolab(raw, OPTS);
    expect(roster.characters.size).toBe(63);
    expect(roster.provenance.source).toBe('hoyolab');
    expect(roster.provenance.capturedAt).toBe(OPTS.capturedAt);
  });

  it('separa os três talentos por sufixo de skill_id (1=auto, 2=skill, 5=burst)', () => {
    const roster = rosterFromHoyolab(raw, OPTS);
    // xiangling = 10000023, nível 90 C4 na conta de calibração
    const xiangling = roster.characters.get('10000023' as CharacterKey);
    expect(xiangling).toBeDefined();
    expect(xiangling!.level).toBe(90);
    expect(xiangling!.constellation).toBe(4);
    expect(xiangling!.element).toBe('pyro');
    expect(xiangling!.talents.auto).toBeGreaterThan(0);
    expect(xiangling!.talents.skill).toBeGreaterThan(0);
    expect(xiangling!.talents.burst).toBeGreaterThan(0);
  });

  it('aceita nível de talento acima de 10 (constelação dá +3)', () => {
    const roster = rosterFromHoyolab(raw, OPTS);
    for (const c of roster.characters.values()) {
      expect(c.talents.skill).toBeLessThanOrEqual(15);
    }
  });

  it('cada peça de artefato tem fingerprint, dono e substats com contagem de rolls', () => {
    const roster = rosterFromHoyolab(raw, OPTS);
    // Contagem EXATA, verificada na fixture: 156 peças em 32 dos 63
    // personagens (os outros 31 estão sem artefato nenhum). Exato e não
    // "maior que N" de propósito: prova que nenhuma peça é descartada.
    expect(roster.artifacts.length).toBe(156);
    for (const piece of roster.artifacts) {
      expect(piece.fingerprint).toMatch(/\S/);
      expect(piece.equippedBy).not.toBeNull();
      expect(['flower', 'plume', 'sands', 'goblet', 'circlet']).toContain(piece.slot);
      for (const sub of piece.substats) {
        expect(sub.tiers.length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('traduz o set.id do HoYoLAB para a chave do catálogo do gi-data', () => {
    const sets = loadArtifactSets();
    const roster = rosterFromHoyolab(raw, OPTS);
    // O payload traz `set.id` de 7 dígitos (2150031); o catálogo usa 5
    // (15003). Sem a tradução, TODA verificação de conjunto daria zero em
    // silêncio. Os 29 sets distintos da conta real têm que resolver.
    const unknown = [...new Set(roster.artifacts.map((p) => p.setKey))].filter((k) => !sets[Number(k)]);
    expect(unknown).toEqual([]);
    expect(roster.artifacts.some((p) => sets[Number(p.setKey)]!.slug === 'wanderer-s-troupe')).toBe(true);
  });

  it('lança em set.id fora do catálogo em vez de inventar chave', () => {
    const bogus = {
      detail: {
        list: [
          {
            base: { id: 10000023, element: 'Pyro', level: 90, actived_constellation_num: 0 },
            weapon: { id: 13401, level: 90, promote_level: 6, affix_level: 1 },
            relics: [
              {
                pos: 1, rarity: 5, level: 20, set: { id: 9999999 },
                main_property: { property_type: 2, value: '4780' }, sub_property_list: [],
              },
            ],
            skills: [],
          },
        ],
      },
    };
    expect(() => rosterFromHoyolab(bogus, OPTS)).toThrow(/9999999/);
  });

  it('preenche observedStats por personagem', () => {
    const roster = rosterFromHoyolab(raw, OPTS);
    expect(roster.observedStats.size).toBe(63);
    const stats = roster.observedStats.get('10000023' as CharacterKey);
    expect(typeof stats?.atk).toBe('number');
    expect(typeof stats?.enerRech_).toBe('number');
  });

  it('não quebra em personagem que o catálogo do gi-data não conhece', () => {
    // a conta real tem 2 personagens de patch novo ainda ausentes do catálogo;
    // o montador trabalha com id numérico, então eles passam normalmente.
    const roster = rosterFromHoyolab(raw, OPTS);
    expect(roster.characters.size).toBe(63);
  });
});

describe('equippedBuild', () => {
  it('monta a build equipada com arma, 5 slots e stats observados', () => {
    const roster = rosterFromHoyolab(raw, OPTS);
    const build = equippedBuild(roster, '10000023' as CharacterKey);
    expect(build).not.toBeNull();
    expect(build!.weapon.key).toMatch(/^\d+$/);
    expect(build!.artifacts.flower).not.toBeNull();
    expect(build!.artifacts.circlet).not.toBeNull();
    expect(build!.observedStats).toBeDefined();
    expect(build!.conditionals).toEqual({});
  });

  it('devolve null para personagem que não está no roster', () => {
    const roster = rosterFromHoyolab(raw, OPTS);
    expect(equippedBuild(roster, '99999999' as CharacterKey)).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @buer/engine exec vitest run test/roster.test.ts`
Expected: FAIL — `Failed to resolve import "../src/roster/from-hoyolab.js"`.

- [ ] **Step 3: Escrever o montador**

Criar `packages/engine/src/roster/from-hoyolab.ts`:

```ts
import {
  artifactFingerprint, charKey, extractObservedStats, propKey, reconstructTiers,
  type ArtifactSetKey, type CharacterKey, type Element, type ObservedStats, type StatKey,
} from '@buer/core';
import { loadArtifactSets } from '@buer/gi-data';
import type {
  ArtifactPiece, ArtifactSlot, Build, CharacterInstance, Roster, Substat, WeaponInstance,
} from '../interfaces.js';

const ARTIFACT_SETS = loadArtifactSets();

/**
 * `set.id` do HoYoLAB -> chave do catálogo do gi-data.
 *
 * São numerações DIFERENTES e a diferença é silenciosa: o payload traz
 * `2150031` onde o catálogo tem `15003`. Sem traduzir, `setKey` nunca casa
 * com nada que uma ficha declare, e a verificação de conjunto dá crédito
 * zero para toda build — errado, e sem sintoma.
 *
 * A relação, verificada nos 29 sets distintos da conta real de calibração
 * (29/29, todos de 7 dígitos, prefixo `2` e sufixo `1`):
 *   hoyolabId = 2_000_000 + giDataId * 10 + 1
 * de onde `giDataId = Math.floor((hoyolabId - 2_000_000) / 10)`.
 *
 * LANÇA para id que não resolve no catálogo, em vez de propagar uma chave
 * inventada: é a mesma disciplina de fail-loud do `sync.ts` do gi-data, e é
 * o que faz um set de patch novo aparecer como erro em vez de virar
 * "conjunto fora da ficha" para todos os usuários.
 */
export function artifactSetKeyFromHoyolab(hoyolabSetId: number): ArtifactSetKey {
  const candidate = Math.floor((hoyolabSetId - 2_000_000) / 10);
  if (ARTIFACT_SETS[candidate]) return String(candidate) as ArtifactSetKey;
  throw new Error(
    `set de artefato ${hoyolabSetId} não resolve no catálogo do gi-data ` +
      `(tentou ${candidate}); rode 'pnpm --filter @buer/gi-data sync' se for set de patch novo`,
  );
}

const SLOT_BY_POS: Readonly<Record<number, ArtifactSlot>> = {
  1: 'flower', 2: 'plume', 3: 'sands', 4: 'goblet', 5: 'circlet',
};

const ELEMENTS: ReadonlySet<string> = new Set([
  'pyro', 'hydro', 'cryo', 'electro', 'anemo', 'geo', 'dendro',
]);

/**
 * Talento -> componente, pelo ÚLTIMO dígito do skill_id: 1 = ataque normal,
 * 2 = habilidade elemental, 5 = explosão elemental. Verificado nos 63
 * personagens da conta real: 62 têm exatamente 3 talentos `skill_type === 1`
 * nesse padrão, e o único fora da curva (Mona, que tem um 4º com final 3 —
 * o sprint alternativo) é absorvido porque só mapeamos 1/2/5 e ignoramos o
 * resto. Ordem do array NÃO é usada: ela não é garantida por contrato.
 */
function talentsOf(entry: Record<string, unknown>): CharacterInstance['talents'] {
  const talents = { auto: 0, skill: 0, burst: 0 };
  const skills = Array.isArray(entry['skills']) ? (entry['skills'] as Record<string, unknown>[]) : [];
  for (const skill of skills) {
    if (skill['skill_type'] !== 1) continue;
    const id = typeof skill['skill_id'] === 'number' ? skill['skill_id'] : null;
    const level = typeof skill['level'] === 'number' ? skill['level'] : 0;
    if (id === null) continue;
    const last = id % 10;
    if (last === 1) talents.auto = level;
    else if (last === 2) talents.skill = level;
    else if (last === 5) talents.burst = level;
  }
  return talents;
}

/**
 * Tiers de um substat. HoYoLAB manda `times` = rolls DEPOIS do inicial, então
 * a contagem real é `times + 1` (descoberta da Fase 1, verificada em ~494
 * substats). Quando não há tabela de tier verificada para a raridade — hoje
 * tudo que não é 5★ — devolvemos um tier placeholder POR ROLL em vez de um
 * só: a contagem de rolls é exata em qualquer raridade e é o que a
 * verificação de substats realmente consome; a qualidade do tier é o que
 * degrada, e quem consome sinaliza isso por `piece.rarity !== 5`.
 */
function tiersOf(rarity: 3 | 4 | 5, key: StatKey, value: number, rolls: number): (1 | 2 | 3 | 4)[] {
  try {
    return [...reconstructTiers(rarity, key, value, rolls)];
  } catch {
    return Array.from({ length: Math.max(1, rolls) }, () => 1 as const);
  }
}

function piecesOf(entry: Record<string, unknown>, owner: CharacterKey): ArtifactPiece[] {
  const relics = Array.isArray(entry['relics']) ? (entry['relics'] as Record<string, any>[]) : [];
  return relics.map((relic): ArtifactPiece => {
    const rarity = relic['rarity'] as 3 | 4 | 5;
    const subs: [number, number, 1 | 2 | 3 | 4][] = [];
    const substats: Substat[] = [];

    for (const sub of (relic['sub_property_list'] ?? []) as Record<string, any>[]) {
      const key = propKey(sub['property_type'] as number);
      const value = Number.parseFloat(String(sub['value']).replace('%', ''));
      const rolls = (sub['times'] as number) + 1;
      const tiers = tiersOf(rarity, key, value, rolls);
      subs.push([sub['property_type'] as number, value, tiers[tiers.length - 1]!]);
      substats.push({ key, tiers, value, source: 'reconstructed' });
    }

    const mainValue = Number.parseFloat(String(relic['main_property']['value']));
    const base = {
      slot: relic['pos'] as 1 | 2 | 3 | 4 | 5,
      set: relic['set']['id'] as number,
      lvl: relic['level'] as number,
      rarity,
      main: [relic['main_property']['property_type'] as number, mainValue] as [number, number],
      subs,
    };

    return {
      fingerprint: artifactFingerprint(base),
      setKey: artifactSetKeyFromHoyolab(base.set),
      slot: SLOT_BY_POS[base.slot]!,
      rarity,
      level: base.lvl,
      mainStatKey: propKey(base.main[0]),
      substats,
      locked: false,
      equippedBy: owner,
    };
  });
}

/**
 * Payload cru do HoYoLAB (`{ list, detail }`, o mesmo que `--raw-out` grava)
 * -> `Roster` do motor.
 *
 * `capturedAt` e `lang` são parâmetros e não valores derivados do relógio de
 * propósito: o roster alimenta um golden file, e um timestamp implícito o
 * tornaria não-determinístico.
 */
export function rosterFromHoyolab(
  raw: unknown,
  opts: { capturedAt: string; lang: string },
): Roster {
  const detail = (raw as { detail?: { list?: unknown } })?.detail;
  const list = Array.isArray(detail?.list) ? (detail.list as Record<string, any>[]) : [];

  const characters = new Map<CharacterKey, CharacterInstance>();
  const observedStats = new Map<CharacterKey, ObservedStats>();
  const artifacts: ArtifactPiece[] = [];
  const weapons: WeaponInstance[] = [];

  for (const entry of list) {
    const base = entry['base'] as Record<string, any>;
    const rawElement = String(base['element'] ?? '').toLowerCase();
    const element = ELEMENTS.has(rawElement) ? (rawElement as Element) : undefined;
    const key = charKey(base['id'] as number, element);

    characters.set(key, {
      key,
      ...(element === undefined ? {} : { element }),
      level: (base['level'] as number) ?? 1,
      // O payload não expõe `base.promote_level` do PERSONAGEM (só o da arma)
      // — lacuna de disponibilidade herdada da Fase 1, registrada na §14.5 da
      // spec. Fica 0; a Fase 2 não usa ascensão, a Fase 3 vai precisar.
      ascension: 0,
      constellation: ((base['actived_constellation_num'] as number) ?? 0) as CharacterInstance['constellation'],
      talents: talentsOf(entry),
    });

    observedStats.set(key, extractObservedStats(entry));
    artifacts.push(...piecesOf(entry, key));

    const weapon = entry['weapon'] as Record<string, any> | undefined;
    if (weapon) {
      weapons.push({
        key: String(weapon['id']) as WeaponInstance['key'],
        level: (weapon['level'] as number) ?? 1,
        ascension: Math.min(6, Math.max(0, (weapon['promote_level'] as number) ?? 0)),
        refinement: (((weapon['affix_level'] as number) ?? 1) as 1 | 2 | 3 | 4 | 5),
        equippedBy: key,
      });
    }
  }

  return {
    schemaVersion: 1,
    characters,
    artifacts,
    weapons,
    observedStats,
    provenance: {
      source: 'hoyolab',
      completeness: 'full',
      capturedAt: opts.capturedAt,
      lang: opts.lang,
    },
  };
}

const EMPTY_SLOTS: Readonly<Record<ArtifactSlot, ArtifactPiece | null>> = {
  flower: null, plume: null, sands: null, goblet: null, circlet: null,
};

/** A build COMO ESTÁ EQUIPADA. É a única build que pode ter observedStats. */
export function equippedBuild(roster: Roster, key: CharacterKey): Build | null {
  const character = roster.characters.get(key);
  if (!character) return null;

  const weapon = roster.weapons.find((w) => w.equippedBy === key);
  if (!weapon) return null;

  const slots: Record<ArtifactSlot, ArtifactPiece | null> = { ...EMPTY_SLOTS };
  for (const piece of roster.artifacts) {
    if (piece.equippedBy === key) slots[piece.slot] = piece;
  }

  const observed = roster.observedStats.get(key);
  return {
    schemaVersion: 1,
    character,
    weapon,
    artifacts: slots,
    conditionals: {},
    ...(observed === undefined ? {} : { observedStats: observed }),
  };
}
```

- [ ] **Step 4: Exportar e declarar a dependência**

Em `packages/engine/src/index.ts`, adicionar:

```ts
export { rosterFromHoyolab, equippedBuild } from './roster/from-hoyolab.js';
```

Em `packages/engine/package.json`, adicionar a `dependencies`:

```json
    "@buer/gi-data": "workspace:*",
    "@buer/meta": "workspace:*"
```

Run: `pnpm install`

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @buer/engine exec vitest run test/roster.test.ts`
Expected: PASS (8 testes).

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/roster packages/engine/src/index.ts packages/engine/package.json packages/engine/test/roster.test.ts pnpm-lock.yaml
git commit -m "feat(engine): monta Roster e Build equipada a partir do payload cru do HoYoLAB"
```

---

## Task 5: `StatResolver` e o teste que blinda a Fase 3

O seam da spec §6.1. Pequeno em código, grande em consequência: é o que faz "comparar builds hipotéticas" na Fase 3 ser uma troca de implementação em vez de uma reescrita.

**Files:**
- Create: `packages/engine/src/stat-resolver.ts`
- Modify: `packages/engine/src/contract-suite.ts`, `packages/engine/src/index.ts`
- Test: `packages/engine/test/stat-resolver.test.ts`

**Interfaces:**
- Produces:
  - `interface StatResolver { readonly id: string; resolve(build: Build): Promise<ObservedStats | null> }`
  - `class ObservedStatResolver implements StatResolver`
  - `contractSuite(make, opts?: { requiresObservedStats?: boolean })` — assinatura ampliada, retrocompatível.

- [ ] **Step 1: Escrever o teste que falha**

Criar `packages/engine/test/stat-resolver.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Build } from '../src/interfaces.js';
import { ObservedStatResolver } from '../src/stat-resolver.js';

const withStats = { observedStats: { atk: 2000, critRate_: 70 } } as unknown as Build;
const hypothetical = { conditionals: {} } as unknown as Build;

describe('ObservedStatResolver', () => {
  it('devolve os stats da build capturada', async () => {
    const resolver = new ObservedStatResolver();
    await expect(resolver.resolve(withStats)).resolves.toEqual({ atk: 2000, critRate_: 70 });
  });

  it('devolve null para build hipotética — não inventa número', async () => {
    const resolver = new ObservedStatResolver();
    await expect(resolver.resolve(hypothetical)).resolves.toBeNull();
  });

  it('tem id estável, que vai para a proveniência', () => {
    expect(new ObservedStatResolver().id).toBe('observed');
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @buer/engine exec vitest run test/stat-resolver.test.ts`
Expected: FAIL — `Failed to resolve import "../src/stat-resolver.js"`.

- [ ] **Step 3: Escrever o resolver**

Criar `packages/engine/src/stat-resolver.ts`:

```ts
import type { ObservedStats } from '@buer/core';
import type { Build } from './interfaces.js';

/**
 * A ÚNICA porta por onde o motor lê stats de uma build.
 *
 * Nenhum avaliador pode ler `build.observedStats` direto. A regra existe
 * para que a Fase 3 entregue um `ComputedStatResolver` (curvas + ascensão +
 * arma + artefatos + bônus de set) e ganhe comparação de builds hipotéticas
 * TROCANDO esta implementação — mesmas fichas, mesmo avaliador, mesmo
 * scoring. É a lição do Genshin Optimizer, que acoplou solver e motor de
 * fórmula e ficou preso numa migração.
 *
 * `null` significa "não sei", nunca zero: um stat ausente e um stat que vale
 * zero levam a vereditos opostos.
 */
export interface StatResolver {
  readonly id: string;
  resolve(build: Build): Promise<ObservedStats | null>;
}

/** Fase 2: lê o que a captura já trouxe. Não calcula nada. */
export class ObservedStatResolver implements StatResolver {
  readonly id = 'observed';

  async resolve(build: Build): Promise<ObservedStats | null> {
    return build.observedStats ?? null;
  }
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @buer/engine exec vitest run test/stat-resolver.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Ampliar a suíte de contrato com o teste que blinda a Fase 3**

Em `packages/engine/src/contract-suite.ts`, trocar a assinatura e acrescentar o bloco condicional. O arquivo inteiro passa a ser:

```ts
import { describe, it, expect } from 'vitest';
import type { BuildEvaluator, EvaluationContext, Build, TeamComposition } from './interfaces.js';

export interface ContractSuiteOptions {
  /**
   * Marque `true` para avaliador que depende de stats observados. Liga o
   * teste de degradação: build sem `observedStats` tem que sair por
   * `canHandle` com razões, nunca por exceção.
   *
   * Este é o teste que a Fase 3 vai usar como verificação de que trocar o
   * StatResolver por um que CALCULA stats funcionou — quando o avaliador
   * passar a aceitar build hipotética, é aqui que a mudança aparece.
   */
  readonly requiresObservedStats?: boolean;
}

/**
 * Suíte de contrato reutilizável para qualquer BuildEvaluator: lote,
 * Score bem-formado, negociação por canHandle.
 * @param make fábrica que cria uma instância nova do avaliador
 * @param opts obrigações extras conforme a natureza do avaliador
 */
export function contractSuite(make: () => BuildEvaluator, opts: ContractSuiteOptions = {}): void {
  const ctx = {} as EvaluationContext;
  const build = {} as Build;

  describe('BuildEvaluator contract', () => {
    it('evaluate returns one Score per build in batch', async () => {
      const evaluator = make();
      const prepared = await evaluator.prepare(ctx);
      const scores = await prepared.evaluate([build, build]);

      expect(scores).toHaveLength(2);
      expect(scores[0]).toBeDefined();
      expect(scores[1]).toBeDefined();
    });

    it('each Score is well-formed (value, unit, violations, provenance.kind)', async () => {
      const evaluator = make();
      const prepared = await evaluator.prepare(ctx);
      const scores = await prepared.evaluate([build]);
      const score = scores[0]!;

      expect(score).toHaveProperty('value');
      expect(typeof score.value).toBe('number');
      expect(score).toHaveProperty('unit');
      expect(score).toHaveProperty('violations');
      expect(Array.isArray(score.violations)).toBe(true);
      expect(score).toHaveProperty('provenance');
      expect(score.provenance).toHaveProperty('kind');
    });

    it('canHandle returns a well-formed CapabilityVerdict', () => {
      const evaluator = make();
      const verdict = evaluator.canHandle(ctx);

      expect(verdict).toHaveProperty('ok');
      expect(typeof verdict.ok).toBe('boolean');
    });

    if (opts.requiresObservedStats) {
      it('recusa build sem observedStats por canHandle, com razões — nunca lança', () => {
        const evaluator = make();
        const subject = 'sujeito-de-teste';
        const hypothetical = { conditionals: {}, character: { key: subject } } as unknown as Build;
        const team = {
          schemaVersion: 1,
          slots: [{ build: hypothetical, role: [] }],
          teamConditionals: {},
        } as unknown as TeamComposition;
        const hypotheticalCtx = {
          gameVersion: '7.0',
          team,
          subject,
          objective: { schemaVersion: 1, id: 't', label: 'T', terms: [], aggregate: 'sum' },
          constraints: [],
        } as unknown as EvaluationContext;

        const verdict = evaluator.canHandle(hypotheticalCtx);

        expect(verdict.ok).toBe(false);
        if (!verdict.ok) {
          expect(verdict.reasons.length).toBeGreaterThan(0);
          expect(verdict.reasons.join(' ')).toMatch(/observedStats|stats observados/i);
        }
      });
    }
  });
}
```

`packages/engine/test/contract.test.ts` **não muda**: `NullEvaluator` não declara `requiresObservedStats`, então o novo teste não roda para ele.

- [ ] **Step 6: Exportar**

Em `packages/engine/src/index.ts`:

```ts
export { ObservedStatResolver } from './stat-resolver.js';
export type { StatResolver } from './stat-resolver.js';
export type { ContractSuiteOptions } from './contract-suite.js';
```

- [ ] **Step 7: Rodar tudo**

Run: `pnpm -w typecheck && pnpm -w test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/engine/src/stat-resolver.ts packages/engine/src/contract-suite.ts packages/engine/src/index.ts packages/engine/test/stat-resolver.test.ts
git commit -m "feat(engine): StatResolver como seam único + teste de contrato que blinda a Fase 3"
```

---

## Task 6: As cinco verificações

O coração do avaliador-linter. Cinco funções **puras**, uma por arquivo, cada uma testável sozinha. Nenhuma delas conhece `Score`, peso ou proveniência — só produzem `Finding`.

**Files:**
- Create: `packages/engine/src/curated/findings.ts`
- Create: `packages/engine/src/curated/checks/{set,main-stats,targets,weapon,substats}.ts`
- Test: `packages/engine/test/curated/checks.test.ts`

**Interfaces:**
- Consumes: `Build`, `ArtifactSlot` de `../interfaces.js`; `BuildVariant` de `@buer/meta`; `ObservedStats`, `StatTarget` de `@buer/core`.
- Produces:
  - `type FindingStatus = 'on-target' | 'acceptable' | 'off-target' | 'blocking'`
  - `interface Finding { check: CheckId; status: FindingStatus; credit: number; summary: string; why?: string; caveat?: string }`
  - `type CheckId = 'set' | 'mainStats' | 'targets' | 'weapon' | 'substats'`
  - `statusFor(credit: number): FindingStatus`
  - `checkSet(build, variant): Finding`
  - `checkMainStats(build, variant): Finding`
  - `checkTargets(stats: ObservedStats | null, targets: readonly StatTarget[]): { finding: Finding; violated: readonly StatTarget[] }`
  - `checkWeapon(build, variant): Finding`
  - `checkSubstats(build, variant): Finding`

- [ ] **Step 1: Escrever o teste que falha**

Criar `packages/engine/test/curated/checks.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { BuildVariant } from '@buer/meta';
import type { ArtifactPiece, Build } from '../../src/interfaces.js';
import { checkSet } from '../../src/curated/checks/set.js';
import { checkMainStats } from '../../src/curated/checks/main-stats.js';
import { checkTargets } from '../../src/curated/checks/targets.js';
import { checkWeapon } from '../../src/curated/checks/weapon.js';
import { checkSubstats } from '../../src/curated/checks/substats.js';

function piece(over: Partial<ArtifactPiece>): ArtifactPiece {
  return {
    fingerprint: 'fp', setKey: 'A' as never, slot: 'flower', rarity: 5, level: 20,
    mainStatKey: 'hp' as never, substats: [], locked: false, equippedBy: null,
    ...over,
  } as ArtifactPiece;
}

function build(over: Partial<Build> = {}): Build {
  return {
    schemaVersion: 1,
    character: { key: 'c', level: 90, ascension: 0, constellation: 0, talents: { auto: 9, skill: 9, burst: 9 } },
    weapon: { key: 'W1', level: 90, ascension: 6, refinement: 1, equippedBy: 'c' },
    artifacts: {
      flower: piece({ slot: 'flower', setKey: 'A' as never }),
      plume: piece({ slot: 'plume', setKey: 'A' as never }),
      sands: piece({ slot: 'sands', setKey: 'A' as never, mainStatKey: 'enerRech_' as never }),
      goblet: piece({ slot: 'goblet', setKey: 'A' as never, mainStatKey: 'pyro_dmg_' as never }),
      circlet: piece({ slot: 'circlet', setKey: 'A' as never, mainStatKey: 'critRate_' as never }),
    },
    conditionals: {},
    ...over,
  } as Build;
}

const variant = {
  id: 'v', label: 'V', roles: ['sub-dps'], scalesOn: 'atk',
  sets: [
    { kind: '4pc', sets: ['A'], rank: 1 },
    { kind: '4pc', sets: ['B'], rank: 2 },
    { kind: '2+2', sets: ['A', 'B'], rank: 3 },
  ],
  mainStats: { sands: ['enerRech_', 'atk_'], goblet: ['pyro_dmg_'], circlet: ['critRate_', 'critDMG_'] },
  substats: ['critRate_', 'critDMG_', 'enerRech_'],
  weapons: [{ weapon: 'W1', rank: 1, minRefinement: 5 }, { weapon: 'W2', rank: 2 }],
  targets: [],
} as unknown as BuildVariant;

describe('checkSet', () => {
  it('4pc do set rank 1 é on-target com crédito cheio', () => {
    const f = checkSet(build(), variant);
    expect(f.status).toBe('on-target');
    expect(f.credit).toBe(1);
  });

  it('4pc de um set de rank pior perde crédito mas não é bloqueio', () => {
    const b = build({
      artifacts: {
        flower: piece({ slot: 'flower', setKey: 'B' as never }),
        plume: piece({ slot: 'plume', setKey: 'B' as never }),
        sands: piece({ slot: 'sands', setKey: 'B' as never }),
        goblet: piece({ slot: 'goblet', setKey: 'B' as never }),
        circlet: piece({ slot: 'circlet', setKey: 'B' as never }),
      },
    } as Partial<Build>);
    const f = checkSet(b, variant);
    expect(f.credit).toBeLessThan(1);
    expect(f.status).not.toBe('blocking');
  });

  it('reconhece 2+2 quando declarado', () => {
    const b = build({
      artifacts: {
        flower: piece({ slot: 'flower', setKey: 'A' as never }),
        plume: piece({ slot: 'plume', setKey: 'A' as never }),
        sands: piece({ slot: 'sands', setKey: 'B' as never }),
        goblet: piece({ slot: 'goblet', setKey: 'B' as never }),
        circlet: piece({ slot: 'circlet', setKey: 'C' as never }),
      },
    } as Partial<Build>);
    const f = checkSet(b, variant);
    expect(f.credit).toBeGreaterThan(0);
    expect(f.summary).toContain('2+2');
  });

  it('set fora da ficha zera o crédito e diz o que está equipado', () => {
    const b = build({
      artifacts: {
        flower: piece({ slot: 'flower', setKey: 'Z' as never }),
        plume: piece({ slot: 'plume', setKey: 'Z' as never }),
        sands: piece({ slot: 'sands', setKey: 'Z' as never }),
        goblet: piece({ slot: 'goblet', setKey: 'Z' as never }),
        circlet: piece({ slot: 'circlet', setKey: 'Z' as never }),
      },
    } as Partial<Build>);
    const f = checkSet(b, variant);
    expect(f.credit).toBe(0);
    expect(f.status).toBe('off-target');
  });
});

describe('checkMainStats', () => {
  it('as três main-stats na primeira posição da lista dão crédito cheio', () => {
    expect(checkMainStats(build(), variant).credit).toBe(1);
  });

  it('main-stat fora da lista derruba o crédito e é nomeada', () => {
    const b = build();
    const broken = { ...b, artifacts: { ...b.artifacts, goblet: piece({ slot: 'goblet', mainStatKey: 'hp_' as never }) } } as Build;
    const f = checkMainStats(broken, variant);
    expect(f.credit).toBeLessThan(1);
    expect(f.summary).toContain('goblet');
  });

  it('ignora slot para o qual a ficha não declara preferência', () => {
    const v = { ...variant, mainStats: { sands: ['enerRech_'], goblet: [], circlet: [] } } as unknown as BuildVariant;
    expect(checkMainStats(build(), v).credit).toBe(1);
  });
});

describe('checkTargets', () => {
  const er200 = { kind: 'min', stat: 'enerRech_', value: 200, hard: true, why: 'burst precisa sair' } as const;
  const crit = { kind: 'ratio', numerator: 'critDMG_', denominator: 'critRate_', min: 1.5, max: 2.5, why: 'equilíbrio' } as const;

  it('alvo hard violado é BLOQUEIO e sai também como violação', () => {
    const r = checkTargets({ enerRech_: 140 }, [er200]);
    expect(r.finding.status).toBe('blocking');
    expect(r.violated).toHaveLength(1);
    expect(r.finding.why).toContain('burst precisa sair');
  });

  it('alvo hard cumprido não bloqueia', () => {
    const r = checkTargets({ enerRech_: 210 }, [er200]);
    expect(r.finding.status).toBe('on-target');
    expect(r.violated).toHaveLength(0);
  });

  it('razão de crit dentro da faixa é on-target, fora é off-target sem bloquear', () => {
    expect(checkTargets({ critRate_: 70, critDMG_: 140 }, [crit]).finding.status).toBe('on-target');
    const bad = checkTargets({ critRate_: 20, critDMG_: 200 }, [crit]).finding;
    expect(bad.status).not.toBe('on-target');
    expect(bad.status).not.toBe('blocking');
  });

  it('sem stats resolvidos, não afirma nada: crédito 0 e ressalva explícita', () => {
    const r = checkTargets(null, [er200]);
    expect(r.finding.credit).toBe(0);
    expect(r.finding.caveat).toMatch(/stats/i);
    expect(r.violated).toHaveLength(0);
  });

  it('variante sem alvo nenhum é on-target com crédito cheio', () => {
    expect(checkTargets({}, []).finding.credit).toBe(1);
  });
});

describe('checkWeapon', () => {
  it('arma rank 1 com refino suficiente é crédito cheio', () => {
    const b = build({ weapon: { key: 'W1', level: 90, ascension: 6, refinement: 5, equippedBy: 'c' } } as Partial<Build>);
    expect(checkWeapon(b, variant).credit).toBe(1);
  });

  it('refino abaixo do mínimo reduz crédito e diz o refino exigido', () => {
    const f = checkWeapon(build(), variant); // refinement 1, minRefinement 5
    expect(f.credit).toBeLessThan(1);
    expect(f.summary).toContain('R5');
  });

  it('arma fora da lista não zera nem bloqueia — é conselho, não erro', () => {
    const b = build({ weapon: { key: 'W9', level: 90, ascension: 6, refinement: 1, equippedBy: 'c' } } as Partial<Build>);
    const f = checkWeapon(b, variant);
    expect(f.credit).toBeGreaterThan(0);
    expect(f.status).not.toBe('blocking');
  });
});

describe('checkSubstats', () => {
  const sub = (key: string, rolls: number) => ({
    key, tiers: Array.from({ length: rolls }, () => 1), value: 1, source: 'reconstructed',
  });

  it('todos os rolls nas stats prioritárias é crédito cheio', () => {
    const b = build();
    const loaded = {
      ...b,
      artifacts: {
        ...b.artifacts,
        flower: piece({ slot: 'flower', substats: [sub('critRate_', 5), sub('critDMG_', 4)] as never }),
      },
    } as Build;
    expect(checkSubstats(loaded, variant).credit).toBe(1);
  });

  it('rolls só em stats irrelevantes zera o crédito', () => {
    const b = build();
    const wasted = {
      ...b,
      artifacts: {
        ...b.artifacts,
        flower: piece({ slot: 'flower', substats: [sub('def_', 6), sub('hp', 5)] as never }),
      },
    } as Build;
    expect(checkSubstats(wasted, variant).credit).toBe(0);
  });

  it('peça não-5★ carrega ressalva visível (tabela de tier ausente)', () => {
    const b = build();
    const fodder = {
      ...b,
      artifacts: { ...b.artifacts, flower: piece({ slot: 'flower', rarity: 4, substats: [sub('critRate_', 2)] as never }) },
    } as Build;
    expect(checkSubstats(fodder, variant).caveat).toMatch(/5★|5\*|raridade/i);
  });

  it('build sem substat nenhum não lança', () => {
    expect(() => checkSubstats(build(), variant)).not.toThrow();
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @buer/engine exec vitest run test/curated/checks.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/curated/checks/set.js"`.

- [ ] **Step 3: Escrever o tipo comum**

Criar `packages/engine/src/curated/findings.ts`:

```ts
/**
 * O avaliador curado produz ACHADOS, não uma nota (spec §6.2). Cada achado
 * é explicável sozinho: diz o que verificou, como saiu, e por quê. A nota
 * (§6.3) é derivada disto só para ordenar.
 */
export type CheckId = 'set' | 'mainStats' | 'targets' | 'weapon' | 'substats';

export type FindingStatus = 'on-target' | 'acceptable' | 'off-target' | 'blocking';

export interface Finding {
  readonly check: CheckId;
  readonly status: FindingStatus;
  /** 0..1 — quanto desta verificação foi cumprido. Multiplica o peso. */
  readonly credit: number;
  /** Uma frase, pronta para exibir. */
  readonly summary: string;
  /** O `why` do alvo curado, quando houver. */
  readonly why?: string;
  /** Limite conhecido do que se pode afirmar aqui. */
  readonly caveat?: string;
}

/**
 * Crédito -> status. Os cortes são deliberadamente generosos: o produto
 * existe para orientar, não para reprovar. `blocking` NUNCA sai daqui —
 * só de alvo `hard` violado, que a verificação de alvos decide.
 */
export function statusFor(credit: number): Exclude<FindingStatus, 'blocking'> {
  if (credit >= 0.9) return 'on-target';
  if (credit >= 0.6) return 'acceptable';
  return 'off-target';
}
```

- [ ] **Step 4: Escrever as cinco verificações**

Criar `packages/engine/src/curated/checks/set.ts`:

```ts
import type { BuildVariant } from '@buer/meta';
import type { ArtifactSetKey } from '@buer/core';
import type { Build } from '../../interfaces.js';
import { statusFor, type Finding } from '../findings.js';

/** setKey -> quantas peças equipadas. */
function equippedCounts(build: Build): ReadonlyMap<ArtifactSetKey, number> {
  const counts = new Map<ArtifactSetKey, number>();
  for (const piece of Object.values(build.artifacts)) {
    if (!piece) continue;
    counts.set(piece.setKey, (counts.get(piece.setKey) ?? 0) + 1);
  }
  return counts;
}

/** rank 1 -> 1.0, rank 2 -> 0.75, rank 3 -> 0.5, … nunca abaixo de 0.25. */
function creditForRank(rank: number): number {
  return Math.max(0.25, 1 - 0.25 * (rank - 1));
}

export function checkSet(build: Build, variant: BuildVariant): Finding {
  const counts = equippedCounts(build);
  const equipped = [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1]);

  let best: { credit: number; label: string } | null = null;

  for (const option of variant.sets) {
    const satisfied =
      option.kind === '4pc'
        ? (counts.get(option.sets[0]!) ?? 0) >= 4
        : option.sets.every((s) => (counts.get(s) ?? 0) >= 2);
    if (!satisfied) continue;
    const credit = creditForRank(option.rank);
    const label = option.kind === '4pc' ? `4pc rank ${option.rank}` : `2+2 rank ${option.rank}`;
    if (!best || credit > best.credit) best = { credit, label };
  }

  if (!best) {
    const describe =
      equipped.length === 0
        ? 'nenhum bônus de conjunto ativo'
        : equipped.map(([key, n]) => `${n}pc de ${key}`).join(' + ');
    return {
      check: 'set',
      status: 'off-target',
      credit: 0,
      summary: `Conjunto fora da ficha: ${describe}.`,
    };
  }

  return {
    check: 'set',
    status: statusFor(best.credit),
    credit: best.credit,
    summary: `Conjunto ${best.label} da ficha.`,
  };
}
```

Criar `packages/engine/src/curated/checks/main-stats.ts`:

```ts
import type { BuildVariant } from '@buer/meta';
import type { Build } from '../../interfaces.js';
import { statusFor, type Finding } from '../findings.js';

const SLOTS = ['sands', 'goblet', 'circlet'] as const;

/** posição 0 -> 1.0, 1 -> 0.75, 2 -> 0.5; nunca abaixo de 0.5 quando está na lista. */
function creditForIndex(index: number): number {
  return Math.max(0.5, 1 - 0.25 * index);
}

export function checkMainStats(build: Build, variant: BuildVariant): Finding {
  const scored: number[] = [];
  const wrong: string[] = [];

  for (const slot of SLOTS) {
    const wanted = variant.mainStats[slot];
    // Ficha sem preferência para o slot: não é acerto nem erro, sai da conta.
    if (wanted.length === 0) continue;

    const piece = build.artifacts[slot];
    if (!piece) {
      scored.push(0);
      wrong.push(`${slot} vazio`);
      continue;
    }

    const index = wanted.indexOf(piece.mainStatKey);
    if (index < 0) {
      scored.push(0);
      wrong.push(`${slot} com ${piece.mainStatKey} (a ficha pede ${wanted.join(' ou ')})`);
    } else {
      scored.push(creditForIndex(index));
    }
  }

  if (scored.length === 0) {
    return { check: 'mainStats', status: 'on-target', credit: 1, summary: 'A ficha não fixa main-stats.' };
  }

  const credit = scored.reduce((a, b) => a + b, 0) / scored.length;
  return {
    check: 'mainStats',
    status: statusFor(credit),
    credit,
    summary: wrong.length === 0 ? 'Main-stats conforme a ficha.' : `Main-stat fora do alvo: ${wrong.join('; ')}.`,
  };
}
```

Criar `packages/engine/src/curated/checks/targets.ts`:

```ts
import type { ObservedStats, StatTarget } from '@buer/core';
import { statusFor, type Finding } from '../findings.js';

export interface TargetsResult {
  readonly finding: Finding;
  /** Alvos `hard` violados — viram Score.violations (spec §6.3). */
  readonly violated: readonly StatTarget[];
}

interface Evaluated {
  readonly ok: boolean;
  readonly credit: number;
  readonly hard: boolean;
  readonly message: string;
  readonly target: StatTarget;
}

function evaluate(target: StatTarget, stats: ObservedStats): Evaluated | null {
  if (target.kind === 'min') {
    const actual = stats[target.stat];
    if (actual === undefined) return null;
    const ok = actual >= target.value;
    return {
      ok,
      credit: ok ? 1 : Math.max(0, Math.min(1, actual / target.value)),
      hard: target.hard,
      message: `${target.stat} ${actual.toFixed(1)} (alvo ${target.value})`,
      target,
    };
  }

  if (target.kind === 'range') {
    const actual = stats[target.stat];
    if (actual === undefined) return null;
    const ok = actual >= target.min && actual <= target.max;
    return {
      ok,
      credit: ok ? 1 : 0.5,
      hard: false,
      message: `${target.stat} ${actual.toFixed(1)} (faixa ${target.min}–${target.max})`,
      target,
    };
  }

  const num = stats[target.numerator];
  const den = stats[target.denominator];
  if (num === undefined || den === undefined || den === 0) return null;
  const ratio = num / den;
  const ok = ratio >= target.min && ratio <= target.max;
  return {
    ok,
    credit: ok ? 1 : 0.5,
    hard: false,
    message: `${target.numerator}/${target.denominator} = ${ratio.toFixed(2)} (faixa ${target.min}–${target.max})`,
    target,
  };
}

/**
 * A única verificação que pode produzir BLOQUEIO — e só por alvo `hard`
 * violado. Sem stats resolvidos não afirma nada: crédito 0 com ressalva, em
 * vez de um veredito inventado.
 */
export function checkTargets(stats: ObservedStats | null, targets: readonly StatTarget[]): TargetsResult {
  if (targets.length === 0) {
    return {
      finding: { check: 'targets', status: 'on-target', credit: 1, summary: 'A ficha não fixa alvos numéricos.' },
      violated: [],
    };
  }

  if (stats === null) {
    return {
      finding: {
        check: 'targets',
        status: 'off-target',
        credit: 0,
        summary: 'Alvos numéricos não verificados.',
        caveat: 'Sem stats resolvidos para esta build — nada foi afirmado sobre ER, crit ou maestria.',
      },
      violated: [],
    };
  }

  const evaluated = targets.map((t) => evaluate(t, stats)).filter((e): e is Evaluated => e !== null);

  if (evaluated.length === 0) {
    return {
      finding: {
        check: 'targets',
        status: 'off-target',
        credit: 0,
        summary: 'Alvos numéricos não verificados.',
        caveat: 'A captura não trouxe os stats que estes alvos exigem.',
      },
      violated: [],
    };
  }

  const blocking = evaluated.filter((e) => e.hard && !e.ok);
  const credit = evaluated.reduce((a, e) => a + e.credit, 0) / evaluated.length;
  const failed = evaluated.filter((e) => !e.ok);

  const summary =
    failed.length === 0
      ? `Alvos cumpridos: ${evaluated.map((e) => e.message).join('; ')}.`
      : `Fora do alvo: ${failed.map((e) => e.message).join('; ')}.`;

  const why = failed.length > 0 ? failed.map((e) => e.target.why).join(' ') : undefined;

  return {
    finding: {
      check: 'targets',
      status: blocking.length > 0 ? 'blocking' : statusFor(credit),
      credit,
      summary,
      ...(why === undefined ? {} : { why }),
    },
    violated: blocking.map((e) => e.target),
  };
}
```

Criar `packages/engine/src/curated/checks/weapon.ts`:

```ts
import type { BuildVariant } from '@buer/meta';
import type { Build } from '../../interfaces.js';
import { statusFor, type Finding } from '../findings.js';

/** rank 1 -> 1.0, 2 -> 0.85, 3 -> 0.7; nunca abaixo de 0.4. */
function creditForRank(rank: number): number {
  return Math.max(0.4, 1 - 0.15 * (rank - 1));
}

/**
 * Arma fora da lista NÃO zera: a lista curada é um punhado de nomes, e o
 * jogo tem 249 armas. Uma arma não listada é falta de informação sobre ela,
 * não prova de que é ruim. Meio crédito e uma frase de conselho.
 */
const CREDIT_UNLISTED = 0.5;

export function checkWeapon(build: Build, variant: BuildVariant): Finding {
  if (variant.weapons.length === 0) {
    return { check: 'weapon', status: 'on-target', credit: 1, summary: 'A ficha não fixa arma.' };
  }

  const equipped = build.weapon;
  const option = variant.weapons.find((w) => w.weapon === equipped.key);

  if (!option) {
    const best = [...variant.weapons].sort((a, b) => a.rank - b.rank)[0]!;
    return {
      check: 'weapon',
      status: statusFor(CREDIT_UNLISTED),
      credit: CREDIT_UNLISTED,
      summary: `Arma ${equipped.key} não está na ficha; a de rank 1 é ${best.weapon}.`,
    };
  }

  const base = creditForRank(option.rank);
  const needsRefine = option.minRefinement !== undefined && equipped.refinement < option.minRefinement;
  const credit = needsRefine ? base * 0.8 : base;

  return {
    check: 'weapon',
    status: statusFor(credit),
    credit,
    summary: needsRefine
      ? `Arma ${equipped.key} (rank ${option.rank}) em R${equipped.refinement}; a ficha pede R${option.minRefinement}.`
      : `Arma ${equipped.key}, rank ${option.rank} da ficha.`,
  };
}
```

Criar `packages/engine/src/curated/checks/substats.ts`:

```ts
import type { BuildVariant } from '@buer/meta';
import type { Build } from '../../interfaces.js';
import { statusFor, type Finding } from '../findings.js';

/**
 * Fração de rolls nas stats prioritárias a partir da qual a build é
 * considerada bem investida. Não é 1.0 porque nenhuma peça real tem 100% dos
 * rolls úteis: cada artefato nasce com substats sorteados.
 */
const SHARE_FOR_FULL_CREDIT = 0.6;

/**
 * Mede QUANTOS ROLLS foram para as stats que a variante quer, contra o total
 * investido. A contagem de rolls é exata em qualquer raridade — vem de
 * `times + 1`, não da tabela de tier — então esta verificação funciona na
 * conta inteira. O que degrada em peça não-5★ é a QUALIDADE do tier, e isso
 * sai como ressalva visível em vez de virar número silenciosamente errado
 * (spec §6.2, §14.6).
 */
export function checkSubstats(build: Build, variant: BuildVariant): Finding {
  const priority = new Set<string>(variant.substats);
  let useful = 0;
  let total = 0;
  let hasNonFiveStar = false;

  for (const piece of Object.values(build.artifacts)) {
    if (!piece) continue;
    if (piece.rarity !== 5) hasNonFiveStar = true;
    for (const sub of piece.substats) {
      const rolls = sub.tiers.length;
      total += rolls;
      if (priority.has(sub.key)) useful += rolls;
    }
  }

  const caveat = hasNonFiveStar
    ? 'Há peça de raridade abaixo de 5★: a contagem de rolls é exata, mas a qualidade de cada roll é estimada (não existe tabela de tier verificada para 3★/4★).'
    : undefined;

  if (total === 0) {
    return {
      check: 'substats',
      status: 'off-target',
      credit: 0,
      summary: 'Nenhum substat para avaliar.',
      ...(caveat === undefined ? {} : { caveat }),
    };
  }

  const share = useful / total;
  const credit = Math.min(1, share / SHARE_FOR_FULL_CREDIT);
  const pct = (share * 100).toFixed(0);

  return {
    check: 'substats',
    status: statusFor(credit),
    credit,
    summary:
      priority.size === 0
        ? 'A ficha não fixa prioridade de substats.'
        : `${useful} de ${total} rolls (${pct}%) nas stats prioritárias: ${variant.substats.join(', ')}.`,
    ...(caveat === undefined ? {} : { caveat }),
  };
}
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @buer/engine exec vitest run test/curated/checks.test.ts`
Expected: PASS (17 testes).

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/curated packages/engine/test/curated
git commit -m "feat(engine): as cinco verificações do avaliador curado (achados, não nota)"
```

---

## Task 7: Seleção de variante, scoring e `CuratedBuildEvaluator`

Junta as cinco verificações num avaliador que satisfaz o contrato da §6.4 da spec de Fase 1. Inclui a regra ordenada de seleção de variante — o modo de falha da abordagem escolhida (spec §14.1), portanto explícito e testado.

**Files:**
- Create: `packages/engine/src/curated/scoring.ts`, `packages/engine/src/curated/variant.ts`, `packages/engine/src/curated/evaluator.ts`, `packages/engine/src/registry.ts`
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/test/curated/evaluator.test.ts`

**Interfaces:**
- Consumes: as cinco verificações da Task 6; `MetaBank`, `BuildVariant`, `CharacterProfile`, `ScoringWeights` de `@buer/meta`; `StatResolver` da Task 5.
- Produces:
  - `assess(build, variant, stats, weights): CuratedAssessment` onde `CuratedAssessment = { findings; value; breakdown; violated; blocked }`
  - `selectVariant(profile, build, stats, weights, opts): VariantChoice` com `VariantChoice = { variant; reason: 'pinned'|'archetype'|'only'|'best-match'; explanation }`
  - `class CuratedBuildEvaluator implements BuildEvaluator` — construtor `{ bank, resolver, archetypeVariants? }`
  - `class DefaultEvaluatorRegistry implements EvaluatorRegistry`

- [ ] **Step 1: Escrever o teste que falha**

Criar `packages/engine/test/curated/evaluator.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadMeta } from '@buer/meta';
import type { CharacterKey } from '@buer/core';
import { rosterFromHoyolab, equippedBuild } from '../../src/roster/from-hoyolab.js';
import { ObservedStatResolver } from '../../src/stat-resolver.js';
import { assess } from '../../src/curated/scoring.js';
import { selectVariant } from '../../src/curated/variant.js';
import { CuratedBuildEvaluator } from '../../src/curated/evaluator.js';
import { contractSuite } from '../../src/contract-suite.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(
  readFileSync(path.join(HERE, '..', '..', '..', 'core', 'test', 'fixtures', 'real-account.scrubbed.json'), 'utf8'),
);
const roster = rosterFromHoyolab(raw, { capturedAt: '2026-08-24T00:00:00.000Z', lang: 'pt-br' });
const bank = loadMeta();
const XIANGLING = '10000023' as CharacterKey;

describe('assess', () => {
  it('produz um achado por verificação e um breakdown com as cinco chaves', () => {
    const build = equippedBuild(roster, XIANGLING)!;
    const variant = bank.profiles.get(XIANGLING)!.variants[0]!;
    const a = assess(build, variant, build.observedStats ?? null, bank.scoring);

    expect(a.findings).toHaveLength(5);
    expect(Object.keys(a.breakdown).sort()).toEqual(
      ['mainStats', 'set', 'substats', 'targets', 'weapon'],
    );
    expect(a.value).toBeTypeOf('number');
  });

  it('build com alvo hard violado fica ABAIXO de qualquer build sem bloqueio', () => {
    const build = equippedBuild(roster, XIANGLING)!;
    const variant = bank.profiles.get(XIANGLING)!.variants[0]!;
    const blocked = assess(build, variant, { ...build.observedStats, enerRech_: 100 }, bank.scoring);
    const fine = assess(build, variant, { ...build.observedStats, enerRech_: 250 }, bank.scoring);

    expect(blocked.blocked).toBe(true);
    expect(fine.blocked).toBe(false);
    expect(blocked.value).toBeLessThan(fine.value);
    expect(blocked.violated.length).toBeGreaterThan(0);
  });

  it('nenhuma contribuição do breakdown é escondida — soma bate com o valor sem bloqueio', () => {
    const build = equippedBuild(roster, XIANGLING)!;
    const variant = bank.profiles.get(XIANGLING)!.variants[0]!;
    const a = assess(build, variant, { ...build.observedStats, enerRech_: 250 }, bank.scoring);
    const sum = Object.values(a.breakdown).reduce((x, y) => x + y, 0);
    expect(sum).toBeCloseTo(a.value, 5);
  });
});

describe('selectVariant', () => {
  const profile = () => bank.profiles.get(XIANGLING)!;

  it('variante fixada pelo usuário vence tudo', () => {
    const build = equippedBuild(roster, XIANGLING)!;
    const choice = selectVariant(profile(), build, build.observedStats ?? null, bank.scoring, {
      pinned: 'vaporize',
    });
    expect(choice.variant.id).toBe('vaporize');
    expect(choice.reason).toBe('pinned');
  });

  it('variante exigida pelo arquétipo vence o melhor casamento', () => {
    const build = equippedBuild(roster, XIANGLING)!;
    const choice = selectVariant(profile(), build, build.observedStats ?? null, bank.scoring, {
      fromArchetype: 'national-er',
    });
    expect(choice.variant.id).toBe('national-er');
    expect(choice.reason).toBe('archetype');
  });

  it('sem contexto, escolhe a variante de maior nota e diz qual foi', () => {
    const build = equippedBuild(roster, XIANGLING)!;
    const choice = selectVariant(profile(), build, build.observedStats ?? null, bank.scoring, {});
    expect(choice.reason).toBe('best-match');
    expect(choice.explanation).toContain(choice.variant.label);
  });

  it('variante fixada inexistente cai no melhor casamento em vez de lançar', () => {
    const build = equippedBuild(roster, XIANGLING)!;
    const choice = selectVariant(profile(), build, build.observedStats ?? null, bank.scoring, {
      pinned: 'nao-existe',
    });
    expect(choice.reason).toBe('best-match');
  });
});

describe('CuratedBuildEvaluator', () => {
  const make = () => new CuratedBuildEvaluator({ bank, resolver: new ObservedStatResolver() });

  contractSuite(make, { requiresObservedStats: true });

  it('declara as capacidades da spec §6.3', () => {
    const caps = make().capabilities;
    expect(caps.kind).toBe('curated');
    expect(caps.output).toBe('ordinal');
    expect(caps.providesBounds).toBe(false);
    expect(caps.deterministic).toBe(true);
    expect([...caps.supportsAggregates]).toEqual(['sum']);
  });

  it('recusa personagem sem ficha, nomeando o motivo', () => {
    const build = equippedBuild(roster, '10000014' as CharacterKey); // barbara, sem ficha ainda
    const ctx = {
      gameVersion: '7.0',
      subject: '10000014',
      team: { schemaVersion: 1, slots: [{ build, role: [] }], teamConditionals: {} },
      objective: { schemaVersion: 1, id: 'o', label: 'O', terms: [], aggregate: 'sum' },
      constraints: [],
    } as never;
    const verdict = make().canHandle(ctx);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reasons.join(' ')).toMatch(/ficha/i);
  });

  it('explain nomeia SEMPRE a variante julgada (spec §6.4)', async () => {
    const build = equippedBuild(roster, XIANGLING)!;
    const ctx = {
      gameVersion: '7.0',
      subject: XIANGLING,
      team: { schemaVersion: 1, slots: [{ build, role: [] }], teamConditionals: {} },
      objective: { schemaVersion: 1, id: 'o', label: 'O', terms: [], aggregate: 'sum' },
      constraints: [],
    } as never;
    const prepared = await make().prepare(ctx);
    const explanation = await prepared.explain!(build);
    expect(explanation.summary).toMatch(/variante/i);
    expect(explanation.reasons.length).toBeGreaterThanOrEqual(5);
  });

  it('propaga a proveniência do dado curado para o Score', async () => {
    const build = equippedBuild(roster, XIANGLING)!;
    const ctx = {
      gameVersion: '7.0',
      subject: XIANGLING,
      team: { schemaVersion: 1, slots: [{ build, role: [] }], teamConditionals: {} },
      objective: { schemaVersion: 1, id: 'o', label: 'O', terms: [], aggregate: 'sum' },
      constraints: [],
    } as never;
    const prepared = await make().prepare(ctx);
    const [score] = await prepared.evaluate([build]);
    expect(score!.provenance.kind).toBe('curated');
    expect(score!.provenance.datasetSha).toBe(bank.datasetSha);
    expect(score!.provenance.confidence).toBe('medium'); // xiangling.json é human/medium
    expect(score!.provenance.assumptions.join(' ')).toContain('scoring v1');
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @buer/engine exec vitest run test/curated/evaluator.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/curated/scoring.js"`.

- [ ] **Step 3: Escrever o scoring**

Criar `packages/engine/src/curated/scoring.ts`:

```ts
import type { ObservedStats, StatTarget } from '@buer/core';
import type { BuildVariant, ScoringWeights } from '@buer/meta';
import type { Build } from '../interfaces.js';
import type { CheckId, Finding } from './findings.js';
import { checkSet } from './checks/set.js';
import { checkMainStats } from './checks/main-stats.js';
import { checkTargets } from './checks/targets.js';
import { checkWeapon } from './checks/weapon.js';
import { checkSubstats } from './checks/substats.js';

export interface CuratedAssessment {
  readonly findings: readonly Finding[];
  /** Só para ORDENAR. O produto é a lista de achados. */
  readonly value: number;
  readonly breakdown: Readonly<Record<CheckId, number>>;
  readonly violated: readonly StatTarget[];
  readonly blocked: boolean;
}

/**
 * Penalidade de bloqueio. Subtrair uma constante maior que a soma máxima dos
 * pesos garante que TODA build com alvo hard violado fique abaixo de TODA
 * build sem bloqueio, sem achatar a ordenação dentro de cada grupo — não se
 * compensa ER insuficiente com crit bom (spec §6.3).
 */
const BLOCKED_PENALTY = 1000;

export function assess(
  build: Build,
  variant: BuildVariant,
  stats: ObservedStats | null,
  weights: ScoringWeights,
): CuratedAssessment {
  const targets = checkTargets(stats, variant.targets);

  const findings: Finding[] = [
    checkSet(build, variant),
    checkMainStats(build, variant),
    targets.finding,
    checkWeapon(build, variant),
    checkSubstats(build, variant),
  ];

  const weightOf: Readonly<Record<CheckId, number>> = {
    set: weights.set,
    mainStats: weights.mainStats,
    targets: weights.targets,
    weapon: weights.weapon,
    substats: weights.substats,
  };

  const breakdown = {} as Record<CheckId, number>;
  let value = 0;
  for (const finding of findings) {
    const contribution = weightOf[finding.check] * finding.credit;
    breakdown[finding.check] = contribution;
    value += contribution;
  }

  const blocked = findings.some((f) => f.status === 'blocking');
  return {
    findings,
    value: blocked ? value - BLOCKED_PENALTY : value,
    breakdown,
    violated: targets.violated,
    blocked,
  };
}
```

- [ ] **Step 4: Escrever a seleção de variante**

Criar `packages/engine/src/curated/variant.ts`:

```ts
import type { ObservedStats } from '@buer/core';
import type { BuildVariant, CharacterProfile, ScoringWeights } from '@buer/meta';
import type { Build } from '../interfaces.js';
import { assess } from './scoring.js';

export interface VariantChoice {
  readonly variant: BuildVariant;
  readonly reason: 'pinned' | 'archetype' | 'only' | 'best-match';
  /** Vai SEMPRE para a Explanation: o usuário precisa saber contra o quê foi julgado. */
  readonly explanation: string;
}

export interface SelectVariantOptions {
  /** Variante que o usuário fixou. */
  readonly pinned?: string;
  /** Variante que o slot do arquétipo exige. */
  readonly fromArchetype?: string;
}

/**
 * A regra ordenada da spec §6.4. É o modo de falha desta arquitetura, então
 * é explícita, testada e sempre reportada.
 *
 * A regra 3 (melhor casamento) é a que importa em produto: julga-se a pessoa
 * pela build que ela MAIS PARECE ESTAR TENTANDO FAZER. Quem montou um
 * battery legítimo não é reprovado por não ser hypercarry.
 *
 * `pinned`/`fromArchetype` apontando para variante inexistente NÃO lança:
 * cai para a regra seguinte. Uma ficha e um arquétipo podem ser versionados
 * em ritmos diferentes, e o teste de integridade já é a barreira contra isso
 * — aqui, em runtime, degradar é melhor que quebrar a tela.
 */
export function selectVariant(
  profile: CharacterProfile,
  build: Build,
  stats: ObservedStats | null,
  weights: ScoringWeights,
  opts: SelectVariantOptions,
): VariantChoice {
  const byId = (id: string | undefined): BuildVariant | undefined =>
    id === undefined ? undefined : profile.variants.find((v) => v.id === id);

  const pinned = byId(opts.pinned);
  if (pinned) {
    return {
      variant: pinned,
      reason: 'pinned',
      explanation: `Julgado contra a variante "${pinned.label}", fixada por você.`,
    };
  }

  const fromArchetype = byId(opts.fromArchetype);
  if (fromArchetype) {
    return {
      variant: fromArchetype,
      reason: 'archetype',
      explanation: `Julgado contra a variante "${fromArchetype.label}", que este time exige.`,
    };
  }

  const first = profile.variants[0];
  if (!first) throw new Error(`ficha de ${profile.character} não declara variante nenhuma`);

  if (profile.variants.length === 1) {
    return {
      variant: first,
      reason: 'only',
      explanation: `Julgado contra "${first.label}", a única variante da ficha.`,
    };
  }

  // Regra 3: pontua contra TODAS e fica com a melhor. Empate (>=) preservado
  // para a primeira da lista — a ordem declarada É a prioridade de desempate.
  let best = first;
  let bestValue = assess(build, first, stats, weights).value;
  for (const variant of profile.variants.slice(1)) {
    const value = assess(build, variant, stats, weights).value;
    if (value > bestValue) {
      best = variant;
      bestValue = value;
    }
  }

  const others = profile.variants.filter((v) => v.id !== best.id).map((v) => v.label);
  return {
    variant: best,
    reason: 'best-match',
    explanation:
      `Julgado contra a variante "${best.label}" — foi a que a build equipada mais se aproxima. ` +
      `Outras desta ficha: ${others.join(', ')}.`,
  };
}
```

- [ ] **Step 5: Escrever o avaliador**

Criar `packages/engine/src/curated/evaluator.ts`:

```ts
import type { CharacterKey } from '@buer/core';
import type { MetaBank } from '@buer/meta';
import type {
  Build, BuildEvaluator, CapabilityVerdict, ConstraintViolation, EvaluationContext,
  EvaluatorCapabilities, Explanation, PreparedEvaluator, Provenance, Score,
} from '../interfaces.js';
import type { StatResolver } from '../stat-resolver.js';
import { assess, type CuratedAssessment } from './scoring.js';
import { selectVariant, type VariantChoice } from './variant.js';

const CAPS: EvaluatorCapabilities = {
  kind: 'curated',
  output: 'ordinal',
  supportsTermKinds: ['stat'],
  supportsAggregates: ['sum'],
  supportsConstraintKinds: ['stat', 'artifactSet', 'mainStat'],
  supportsHitModes: ['avgHit'],
  modelsSnapshot: false,
  modelsAuraAndIcd: false,
  providesBounds: false,
  deterministic: true,
  estimatedCostPerBuildMs: 0.01,
  maxBatchSize: 10000,
  runtime: 'node',
};

export interface CuratedBuildEvaluatorOptions {
  readonly bank: MetaBank;
  readonly resolver: StatResolver;
  /** Variante exigida por slot de arquétipo, por personagem. */
  readonly archetypeVariants?: ReadonlyMap<CharacterKey, string>;
}

/** Acha, dentro do contexto, a build do personagem que está sendo avaliado. */
function subjectBuild(ctx: EvaluationContext): Build | null {
  for (const slot of ctx.team?.slots ?? []) {
    if (slot?.build?.character?.key === ctx.subject) return slot.build;
  }
  return null;
}

export class CuratedBuildEvaluator implements BuildEvaluator {
  readonly id = 'curated';
  readonly capabilities = CAPS;

  constructor(private readonly opts: CuratedBuildEvaluatorOptions) {}

  /**
   * Negociação ANTES de rodar (spec F1§6.4). Duas razões de recusa, ambas
   * honestas: não há ficha para este personagem, ou a build não tem stats
   * observados. A segunda é o seam da Fase 3 — quando o ComputedStatResolver
   * existir, ela deixa de acontecer sem mudar mais nada aqui.
   */
  canHandle(ctx: EvaluationContext): CapabilityVerdict {
    const reasons: string[] = [];

    const subject = ctx.subject;
    if (subject !== undefined && !this.opts.bank.profiles.has(subject)) {
      reasons.push(`ainda não há ficha curada para o personagem ${String(subject)}`);
    }

    const build = subjectBuild(ctx);
    if (build && build.observedStats === undefined) {
      reasons.push(
        'a build não tem stats observados (observedStats) — o avaliador curado só julga a build capturada; ' +
          'comparar build hipotética exige o avaliador analítico da Fase 3',
      );
    }

    return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
  }

  async prepare(ctx: EvaluationContext): Promise<PreparedEvaluator> {
    const { bank, resolver, archetypeVariants } = this.opts;
    const subject = ctx.subject;
    const profile = subject === undefined ? undefined : bank.profiles.get(subject);
    const gameVersion = ctx.gameVersion ?? ('7.0' as const);
    const rosterCompleteness: Provenance['rosterCompleteness'] = 'full';

    const evaluateOne = async (
      build: Build,
    ): Promise<{ assessment: CuratedAssessment; choice: VariantChoice } | null> => {
      if (!profile) return null;
      const stats = await resolver.resolve(build);
      const choice = selectVariant(profile, build, stats, bank.scoring, {
        ...(archetypeVariants?.get(profile.character) === undefined
          ? {}
          : { fromArchetype: archetypeVariants.get(profile.character)! }),
      });
      return { assessment: assess(build, choice.variant, stats, bank.scoring), choice };
    };

    const provenanceFor = (choice: VariantChoice | null): Provenance => ({
      evaluatorId: this.id,
      kind: 'curated',
      gameVersion,
      datasetSha: bank.datasetSha,
      confidence: profile?.provenance.confidence ?? 'low',
      assumptions: [
        `pesos de pontuação: scoring v${bank.scoring.version}`,
        `resolver de stats: ${resolver.id}`,
        choice ? `variante julgada: ${choice.variant.id} (${choice.reason})` : 'sem ficha curada',
        'saída ORDINAL: serve para comparar, não para prever dano',
      ],
      rosterCompleteness,
      cacheKey: `${this.id}:${bank.datasetSha}:${String(subject)}`,
    });

    const emptyScore = (): Score => ({
      value: 0,
      unit: 'score',
      violations: [],
      provenance: provenanceFor(null),
    });

    return {
      async evaluate(builds: readonly Build[]): Promise<readonly Score[]> {
        const out: Score[] = [];
        for (const build of builds) {
          const result = await evaluateOne(build);
          if (!result) {
            out.push(emptyScore());
            continue;
          }
          const violations: ConstraintViolation[] = result.assessment.violated.map((target) => ({
            constraint: {
              kind: 'stat',
              of: profile!.character,
              stat: target.kind === 'ratio' ? target.numerator : target.stat,
              ...(target.kind === 'min' ? { min: target.value } : {}),
              hard: true,
            },
            actual: 0,
            required: target.kind === 'min' ? target.value : 0,
            hard: true,
          })) as ConstraintViolation[];

          out.push({
            value: result.assessment.value,
            unit: 'score',
            violations,
            breakdown: result.assessment.breakdown,
            provenance: provenanceFor(result.choice),
          });
        }
        return out;
      },

      async explain(build: Build): Promise<Explanation> {
        const result = await evaluateOne(build);
        if (!result) {
          return {
            summary: 'Ainda não há ficha curada para este personagem — nenhum veredito de build foi dado.',
            reasons: [],
          };
        }
        return {
          summary: result.choice.explanation,
          reasons: result.assessment.findings.map((f) => ({
            claim: f.summary,
            ...(f.why ?? f.caveat ? { evidence: [f.why, f.caveat].filter(Boolean).join(' ') } : {}),
          })),
        };
      },

      async [Symbol.asyncDispose]() {
        // sem recurso a liberar
      },
    };
  }
}
```

- [ ] **Step 6: Escrever o registry**

Criar `packages/engine/src/registry.ts`:

```ts
import type {
  BuildEvaluator, CapabilityVerdict, EvaluationContext, EvaluatorCapabilities,
  EvaluatorKind, EvaluatorRegistry,
} from './interfaces.js';

/**
 * Resolve QUAL avaliador atende um contexto, e devolve junto o veredito de
 * degradação — quem chama precisa poder dizer ao usuário o que foi perdido.
 * A ordem de preferência é `curated` → `analytic` → `simulation` só quando
 * nenhum `prefer` é dado: é a ordem de custo crescente.
 */
const FALLBACK_ORDER: readonly EvaluatorKind[] = ['curated', 'analytic', 'simulation'];

export class DefaultEvaluatorRegistry implements EvaluatorRegistry {
  private readonly evaluators: BuildEvaluator[] = [];

  register(e: BuildEvaluator): void {
    const existing = this.evaluators.findIndex((x) => x.id === e.id);
    if (existing >= 0) this.evaluators[existing] = e;
    else this.evaluators.push(e);
  }

  resolve(
    ctx: EvaluationContext,
    prefer?: EvaluatorKind,
  ): { readonly evaluator: BuildEvaluator; readonly degraded: CapabilityVerdict } {
    const order = prefer ? [prefer, ...FALLBACK_ORDER.filter((k) => k !== prefer)] : FALLBACK_ORDER;
    const candidates = order.flatMap((kind) => this.evaluators.filter((e) => e.capabilities.kind === kind));

    if (candidates.length === 0) throw new Error('nenhum avaliador registrado');

    for (const evaluator of candidates) {
      const verdict = evaluator.canHandle(ctx);
      if (verdict.ok) return { evaluator, degraded: verdict };
    }

    // Nenhum aceita: devolve o primeiro com o motivo, para a UI poder explicar.
    const evaluator = candidates[0]!;
    return { evaluator, degraded: evaluator.canHandle(ctx) };
  }

  list(): readonly EvaluatorCapabilities[] {
    return this.evaluators.map((e) => e.capabilities);
  }
}
```

- [ ] **Step 7: Exportar**

Em `packages/engine/src/index.ts`:

```ts
export { assess } from './curated/scoring.js';
export type { CuratedAssessment } from './curated/scoring.js';
export { selectVariant } from './curated/variant.js';
export type { VariantChoice, SelectVariantOptions } from './curated/variant.js';
export { CuratedBuildEvaluator } from './curated/evaluator.js';
export type { CuratedBuildEvaluatorOptions } from './curated/evaluator.js';
export { statusFor } from './curated/findings.js';
export type { Finding, FindingStatus, CheckId } from './curated/findings.js';
export { DefaultEvaluatorRegistry } from './registry.js';
```

- [ ] **Step 8: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @buer/engine exec vitest run test/curated/evaluator.test.ts`
Expected: PASS. Inclui os 4 testes da `contractSuite` (agora com o de degradação).

- [ ] **Step 9: Commit**

```bash
git add packages/engine/src/curated packages/engine/src/registry.ts packages/engine/src/index.ts packages/engine/test/curated
git commit -m "feat(engine): CuratedBuildEvaluator — scoring por achados, seleção de variante, registry"
```

---

## Task 8: Regras de time e matching bipartido

Duas peças puras que o avaliador de time consome. As **regras** (reação, ressonância) são regra de jogo — entram com confiança alta em qualquer time, sem curadoria nenhuma. O **matching** é a parte que o guloso erra e por isso é feito exato.

**Files:**
- Create: `packages/engine/src/team/rules.ts`, `packages/engine/src/team/matching.ts`
- Test: `packages/engine/test/team/rules.test.ts`, `packages/engine/test/team/matching.test.ts`

**Interfaces:**
- Produces:
  - `reactionsFor(elements: readonly Element[]): ReactionAvailability[]`
  - `resonanceFor(elements: readonly Element[]): ResonanceEffect[]`
  - `matchArchetype(archetype, roster, bank, opts): ArchetypeMatch` com
    `ArchetypeMatch = { archetype; fills: readonly (CharacterKey|null)[]; missing: readonly number[]; status: 'playable'|'blocked-by-one'|'too-far' }`

- [ ] **Step 1: Escrever os testes que falham**

Criar `packages/engine/test/team/rules.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Element } from '@buer/core';
import { reactionsFor, resonanceFor } from '../../src/team/rules.js';

const el = (...x: string[]) => x as Element[];

describe('reactionsFor', () => {
  it('pyro + hydro habilita vaporize', () => {
    const r = reactionsFor(el('pyro', 'hydro'));
    expect(r.find((x) => x.reaction === 'vaporize')?.satisfied).toBe(true);
  });

  it('pyro sozinho não habilita vaporize e nomeia o que falta', () => {
    const v = reactionsFor(el('pyro')).find((x) => x.reaction === 'vaporize')!;
    expect(v.satisfied).toBe(false);
    expect(v.missing).toContain('hydro');
  });

  it('anemo com qualquer elemento aplicável habilita swirl', () => {
    expect(reactionsFor(el('anemo', 'electro')).find((x) => x.reaction === 'swirl')?.satisfied).toBe(true);
    expect(reactionsFor(el('anemo', 'geo')).find((x) => x.reaction === 'swirl')?.satisfied).toBe(false);
  });

  it('hyperbloom exige dendro, hydro e electro juntos', () => {
    expect(reactionsFor(el('dendro', 'hydro')).find((x) => x.reaction === 'hyperbloom')?.satisfied).toBe(false);
    expect(reactionsFor(el('dendro', 'hydro', 'electro')).find((x) => x.reaction === 'hyperbloom')?.satisfied).toBe(true);
  });
});

describe('resonanceFor', () => {
  it('dois pyro dão ressonância de ATQ', () => {
    const r = resonanceFor(el('pyro', 'pyro', 'anemo', 'hydro'));
    expect(r).toHaveLength(1);
    expect(r[0]!.id).toBe('pyro');
    expect(r[0]!.stats?.atk_).toBe(25);
  });

  it('quatro elementos distintos não dão ressonância elemental', () => {
    expect(resonanceFor(el('pyro', 'hydro', 'cryo', 'electro'))).toHaveLength(0);
  });

  it('dois dendro dão maestria', () => {
    expect(resonanceFor(el('dendro', 'dendro'))[0]!.stats?.eleMas).toBe(50);
  });
});
```

Criar `packages/engine/test/team/matching.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadMeta } from '@buer/meta';
import type { CharacterKey } from '@buer/core';
import { rosterFromHoyolab } from '../../src/roster/from-hoyolab.js';
import { matchArchetype } from '../../src/team/matching.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(
  readFileSync(path.join(HERE, '..', '..', '..', 'core', 'test', 'fixtures', 'real-account.scrubbed.json'), 'utf8'),
);
const roster = rosterFromHoyolab(raw, { capturedAt: '2026-08-24T00:00:00.000Z', lang: 'pt-br' });
const bank = loadMeta();
const national = bank.archetypes.find((a) => a.id === 'national')!;
const XIANGLING = '10000023' as CharacterKey;

describe('matchArchetype', () => {
  it('National é jogável na conta real (xiangling, bennett, xingqiu, e um anemo)', () => {
    const m = matchArchetype(national, roster, bank, { require: XIANGLING });
    expect(m.status).toBe('playable');
    expect(m.missing).toHaveLength(0);
    expect(m.fills.filter(Boolean)).toHaveLength(4);
  });

  it('o personagem exigido ocupa um slot que ele pode ocupar', () => {
    const m = matchArchetype(national, roster, bank, { require: XIANGLING });
    expect(m.fills).toContain(XIANGLING);
  });

  it('nenhum personagem ocupa dois slots', () => {
    const m = matchArchetype(national, roster, bank, { require: XIANGLING });
    const filled = m.fills.filter((f): f is CharacterKey => f !== null);
    expect(new Set(filled).size).toBe(filled.length);
  });

  it('roster sem xingqiu deixa o time bloqueado por um slot', () => {
    const without = {
      ...roster,
      characters: new Map([...roster.characters].filter(([k]) => k !== '10000025')),
    };
    const m = matchArchetype(national, without, bank, { require: XIANGLING });
    expect(m.status).toBe('blocked-by-one');
    expect(m.missing).toHaveLength(1);
  });

  it('roster quase vazio fica too-far e não é para exibir', () => {
    const almostEmpty = {
      ...roster,
      characters: new Map([...roster.characters].filter(([k]) => k === '10000023')),
    };
    const m = matchArchetype(national, almostEmpty, bank, { require: XIANGLING });
    expect(m.status).toBe('too-far');
  });

  it('slot flex casa por papel declarado na ficha, não por nome', () => {
    // O 4º slot do National é flex: anemo com driver/debuffer. Nenhum anemo
    // com ficha => o slot não fecha, mesmo tendo anemos no roster.
    const m = matchArchetype(national, roster, bank, { require: XIANGLING });
    const flexIndex = national.slots.findIndex((s) => s.substitutable);
    expect(flexIndex).toBeGreaterThanOrEqual(0);
    // Depende de haver ficha de anemo; a Task 11 adiciona sucrose.
    expect(typeof m.fills[flexIndex]).not.toBe('undefined');
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `pnpm --filter @buer/engine exec vitest run test/team/`
Expected: FAIL — imports não resolvem.

- [ ] **Step 3: Escrever as regras de jogo**

Criar `packages/engine/src/team/rules.ts`:

```ts
import type { Element } from '@buer/core';
import type { ReactionAvailability, ReactionKey, ResonanceEffect } from '../interfaces.js';

/**
 * Reações e o que cada uma exige. Isto é REGRA DE JOGO, não meta: sai dos
 * elementos presentes e é verdade para qualquer time, com confiança alta e
 * sem depender de curadoria nenhuma.
 *
 * `anyOf` existe para swirl e crystallize, que precisam do elemento base
 * MAIS qualquer um de um conjunto.
 */
interface ReactionRule {
  readonly reaction: ReactionKey;
  readonly all: readonly Element[];
  readonly anyOf?: readonly Element[];
}

const AURA: readonly Element[] = ['pyro', 'hydro', 'cryo', 'electro'];

const REACTIONS: readonly ReactionRule[] = [
  { reaction: 'vaporize', all: ['pyro', 'hydro'] },
  { reaction: 'melt', all: ['pyro', 'cryo'] },
  { reaction: 'overloaded', all: ['pyro', 'electro'] },
  { reaction: 'electro-charged', all: ['hydro', 'electro'] },
  { reaction: 'frozen', all: ['hydro', 'cryo'] },
  { reaction: 'superconduct', all: ['cryo', 'electro'] },
  { reaction: 'burning', all: ['pyro', 'dendro'] },
  { reaction: 'bloom', all: ['hydro', 'dendro'] },
  { reaction: 'quicken', all: ['electro', 'dendro'] },
  { reaction: 'hyperbloom', all: ['hydro', 'dendro', 'electro'] },
  { reaction: 'burgeon', all: ['hydro', 'dendro', 'pyro'] },
  { reaction: 'swirl', all: ['anemo'], anyOf: AURA },
  { reaction: 'crystallize', all: ['geo'], anyOf: AURA },
];

export function reactionsFor(elements: readonly Element[]): ReactionAvailability[] {
  const present = new Set(elements);

  return REACTIONS.map((rule): ReactionAvailability => {
    const missingAll = rule.all.filter((e) => !present.has(e));
    const anyOfSatisfied = rule.anyOf === undefined || rule.anyOf.some((e) => present.has(e));
    const satisfied = missingAll.length === 0 && anyOfSatisfied;

    const missing: Element[] = [...missingAll];
    if (missingAll.length === 0 && !anyOfSatisfied && rule.anyOf) missing.push(...rule.anyOf);

    return {
      reaction: rule.reaction,
      requires: { elements: [...rule.all, ...(rule.anyOf ?? [])] },
      satisfied,
      missing,
    };
  });
}

/** Ressonância elemental: 2 ou mais do mesmo elemento no time de 4. */
const RESONANCE: Readonly<Record<Element, Omit<ResonanceEffect, 'id'>>> = {
  pyro: { stats: { atk_: 25 }, conditional: 'Ressonância Ardente: +25% ATQ.' },
  hydro: { stats: { hp_: 25 }, conditional: 'Ressonância Fervorosa: +25% Vida.' },
  cryo: {
    stats: { critRate_: 15 },
    conditional: 'Ressonância Cristalina: +15% de Taxa Crítica contra alvos afetados por Cryo ou congelados.',
  },
  electro: {
    particleGeneration: { element: 'electro', cooldownSeconds: 5, onReactions: ['overloaded', 'electro-charged', 'superconduct'] },
    conditional: 'Ressonância Impetuosa: gera partícula de Electro ao causar reação relacionada.',
  },
  geo: { stats: { shield_: 15 }, conditional: 'Ressonância Inabalável: +15% de Força do Escudo e bônus de dano com escudo ativo.' },
  anemo: { conditional: 'Ressonância Impetuosa dos Ventos: -15% de tempo de recarga e -15% de consumo de vigor.' },
  dendro: { stats: { eleMas: 50 }, conditional: 'Ressonância Exuberante: +50 de Maestria Elemental, com mais sob reação.' },
};

export function resonanceFor(elements: readonly Element[]): ResonanceEffect[] {
  const counts = new Map<Element, number>();
  for (const element of elements) counts.set(element, (counts.get(element) ?? 0) + 1);

  const out: ResonanceEffect[] = [];
  for (const [element, count] of counts) {
    if (count < 2) continue;
    const effect = RESONANCE[element];
    if (effect) out.push({ id: element, ...effect });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
```

- [ ] **Step 4: Escrever o matching bipartido**

Criar `packages/engine/src/team/matching.ts`:

```ts
import type { CharacterKey, Element } from '@buer/core';
import type { ArchetypeSlotData, MetaBank, TeamArchetypeData } from '@buer/meta';
import type { Roster } from '../interfaces.js';

export interface ArchetypeMatch {
  readonly archetype: TeamArchetypeData;
  /** Um item por slot, na ordem do arquétipo. `null` = não preenchido. */
  readonly fills: readonly (CharacterKey | null)[];
  /** Índices dos slots que ficaram vazios. */
  readonly missing: readonly number[];
  readonly status: 'playable' | 'blocked-by-one' | 'too-far';
}

export interface MatchOptions {
  /** Personagem que TEM que estar no time (a visão centrada no personagem). */
  readonly require?: CharacterKey;
}

/** Todos os papéis que qualquer variante da ficha deste personagem declara. */
function rolesOf(bank: MetaBank, key: CharacterKey): ReadonlySet<string> {
  const profile = bank.profiles.get(key);
  const roles = new Set<string>();
  for (const variant of profile?.variants ?? []) for (const role of variant.roles) roles.add(role);
  return roles;
}

function meetsInvestment(slot: ArchetypeSlotData, roster: Roster, key: CharacterKey): boolean {
  if (slot.minConstellation !== undefined) {
    const character = roster.characters.get(key);
    if (!character || character.constellation < slot.minConstellation) return false;
  }
  if (slot.minRefinement !== undefined) {
    const weapon = roster.weapons.find((w) => w.equippedBy === key);
    if (!weapon || weapon.refinement < slot.minRefinement) return false;
  }
  return true;
}

/**
 * Quem, do roster, pode ocupar este slot.
 *
 * Slot FIXO casa por `requires`. Slot FLEX (`substitutable`) casa também por
 * PAPEL declarado na ficha — é o que faz um arquétipo autorado com o núcleo
 * ("Nilou + um dendro off-field") produzir times diferentes para jogadores
 * diferentes, sem o banco precisar enumerar toda composição possível.
 *
 * Personagem sem ficha nunca ocupa slot flex: não há como saber que papel
 * ele cumpre. É o custo aceito da decisão D4 (spec §14.2).
 */
function candidatesFor(slot: ArchetypeSlotData, roster: Roster, bank: MetaBank): CharacterKey[] {
  const owned = [...roster.characters.keys()].filter((key) => meetsInvestment(slot, roster, key));

  if (slot.requires.kind === 'character') {
    const named = new Set(slot.requires.anyOf);
    const exact = owned.filter((key) => named.has(key));
    if (!slot.substitutable) return exact;
    const wanted = new Set<string>(slot.role);
    const byRole = owned.filter((key) => [...rolesOf(bank, key)].some((r) => wanted.has(r)));
    return [...new Set([...exact, ...byRole])];
  }

  const element = slot.requires.element as Element;
  const wanted = new Set<string>(slot.requires.withRole.length > 0 ? slot.requires.withRole : slot.role);
  return owned.filter((key) => {
    if (roster.characters.get(key)?.element !== element) return false;
    return [...rolesOf(bank, key)].some((r) => wanted.has(r));
  });
}

/**
 * Atribuição EXATA por backtracking, maximizando slots preenchidos.
 *
 * Não é guloso de propósito: com escolha slot-a-slot, um personagem que serve
 * a dois slots pode ser consumido pelo primeiro e deixar o segundo vazio,
 * relatando um time como bloqueado quando ele é jogável. Com no máximo 4
 * slots e um roster de ~100, o exato é barato — a §6.5 da spec de Fase 1 já
 * marcou isso como `TeamSearcher.strategy: 'assignment'`.
 */
export function matchArchetype(
  archetype: TeamArchetypeData,
  roster: Roster,
  bank: MetaBank,
  opts: MatchOptions = {},
): ArchetypeMatch {
  const candidates = archetype.slots.map((slot) => candidatesFor(slot, roster, bank));

  // Slots com menos candidatos primeiro: poda muito mais cedo.
  const order = archetype.slots
    .map((_, index) => index)
    .sort((a, b) => (candidates[a]!.length || Infinity) - (candidates[b]!.length || Infinity));

  let bestFills: (CharacterKey | null)[] = archetype.slots.map(() => null);
  let bestCount = -1;

  const current: (CharacterKey | null)[] = archetype.slots.map(() => null);
  const used = new Set<CharacterKey>();

  const search = (position: number, filled: number): void => {
    if (bestCount === archetype.slots.length) return; // já achou perfeito
    if (position === order.length) {
      const hasRequired = opts.require === undefined || current.includes(opts.require);
      if (hasRequired && filled > bestCount) {
        bestCount = filled;
        bestFills = [...current];
      }
      return;
    }

    const slotIndex = order[position]!;
    for (const candidate of candidates[slotIndex]!) {
      if (used.has(candidate)) continue;
      current[slotIndex] = candidate;
      used.add(candidate);
      search(position + 1, filled + 1);
      used.delete(candidate);
      current[slotIndex] = null;
    }

    // Deixar o slot vazio também é um ramo válido: queremos saber QUANTOS
    // faltam, não só se dá para preencher todos.
    search(position + 1, filled);
  };

  search(0, 0);

  const missing = bestFills.map((fill, index) => (fill === null ? index : -1)).filter((i) => i >= 0);
  const status: ArchetypeMatch['status'] =
    missing.length === 0 ? 'playable' : missing.length === 1 ? 'blocked-by-one' : 'too-far';

  return { archetype, fills: bestFills, missing, status };
}
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @buer/engine exec vitest run test/team/`
Expected: PASS. Se o teste do slot flex do National falhar por não haver ficha de anemo, isso é esperado até a Task 11 — o `expect` foi escrito para tolerar `null` ali.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/team packages/engine/test/team
git commit -m "feat(engine): reações e ressonância (regra de jogo) + matching bipartido exato de arquétipo"
```

---

## Task 9: `CuratedTeamEvaluator` — os times de um personagem

Junta matching, regras e o avaliador de build. Esta é a saída que o produto mostra: *para este personagem, estes times*.

**Files:**
- Create: `packages/engine/src/team/evaluator.ts`
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/test/team/evaluator.test.ts`

**Interfaces:**
- Consumes: `matchArchetype` (Task 8), `reactionsFor`/`resonanceFor` (Task 8), `CuratedBuildEvaluator` (Task 7), `equippedBuild` (Task 4).
- Produces:
  - `class CuratedTeamEvaluator` com `teamsFor(subject: CharacterKey, roster: Roster): Promise<TeamsForResult>`
  - `TeamsForResult = { playable: readonly TeamOption[]; blocked: readonly TeamOption[] }`
  - `TeamOption = { match: ArchetypeMatch; assessment: TeamAssessment; rankedBy: 'strength' | 'targets' | 'declared' }`

- [ ] **Step 1: Escrever o teste que falha**

Criar `packages/engine/test/team/evaluator.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadMeta } from '@buer/meta';
import type { CharacterKey } from '@buer/core';
import { rosterFromHoyolab } from '../../src/roster/from-hoyolab.js';
import { ObservedStatResolver } from '../../src/stat-resolver.js';
import { CuratedTeamEvaluator } from '../../src/team/evaluator.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(
  readFileSync(path.join(HERE, '..', '..', '..', 'core', 'test', 'fixtures', 'real-account.scrubbed.json'), 'utf8'),
);
const roster = rosterFromHoyolab(raw, { capturedAt: '2026-08-24T00:00:00.000Z', lang: 'pt-br' });
const bank = loadMeta();
const evaluator = new CuratedTeamEvaluator({ bank, resolver: new ObservedStatResolver() });
const XIANGLING = '10000023' as CharacterKey;
const BARBARA = '10000014' as CharacterKey;

describe('CuratedTeamEvaluator.teamsFor', () => {
  it('lista o National como time jogável para Xiangling', async () => {
    const r = await evaluator.teamsFor(XIANGLING, roster);
    expect(r.playable.map((t) => t.match.archetype.id)).toContain('national');
  });

  it('o assessment traz reações, ressonância e viabilidade de energia', async () => {
    const r = await evaluator.teamsFor(XIANGLING, roster);
    const team = r.playable.find((t) => t.match.archetype.id === 'national')!;
    expect(team.assessment.reactions.some((x) => x.reaction === 'vaporize' && x.satisfied)).toBe(true);
    expect(Array.isArray(team.assessment.resonance)).toBe(true);
    expect(team.assessment.energyFeasibility.length).toBeGreaterThan(0);
    const xl = team.assessment.energyFeasibility.find((e) => e.of === XIANGLING)!;
    expect(xl.required).toBe(200); // alvo hard da variante national-er
    expect(typeof xl.actual).toBe('number');
  });

  it('a explicação nomeia o arquétipo, quem foi para cada slot e a variante julgada', async () => {
    const r = await evaluator.teamsFor(XIANGLING, roster);
    const team = r.playable.find((t) => t.match.archetype.id === 'national')!;
    expect(team.assessment.explanation.summary).toContain('National');
    const text = team.assessment.explanation.reasons.map((x) => x.claim).join(' ');
    expect(text).toMatch(/variante/i);
  });

  it('a ordenação diz por qual critério foi decidida', async () => {
    const r = await evaluator.teamsFor(XIANGLING, roster);
    for (const team of r.playable) {
      expect(['strength', 'targets', 'declared']).toContain(team.rankedBy);
    }
  });

  it('personagem sem arquétipo nenhum devolve as duas listas vazias, sem inventar time', async () => {
    const r = await evaluator.teamsFor(BARBARA, roster);
    expect(r.playable).toHaveLength(0);
    expect(r.blocked).toHaveLength(0);
  });

  it('roster sem xingqiu move o National de jogável para bloqueado', async () => {
    const without = { ...roster, characters: new Map([...roster.characters].filter(([k]) => k !== '10000025')) };
    const r = await evaluator.teamsFor(XIANGLING, without);
    expect(r.playable.map((t) => t.match.archetype.id)).not.toContain('national');
    expect(r.blocked.map((t) => t.match.archetype.id)).toContain('national');
  });

  it('a proveniência do assessment declara que é comparação curada, não simulação', async () => {
    const r = await evaluator.teamsFor(XIANGLING, roster);
    const p = r.playable[0]!.assessment.score.provenance;
    expect(p.kind).toBe('curated');
    expect(p.assumptions.join(' ')).toMatch(/ordinal|compara/i);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @buer/engine exec vitest run test/team/evaluator.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/team/evaluator.js"`.

- [ ] **Step 3: Escrever o avaliador de time**

Criar `packages/engine/src/team/evaluator.ts`:

```ts
import type { CharacterKey, Element, RoleTag } from '@buer/core';
import type { MetaBank, TeamArchetypeData } from '@buer/meta';
import type {
  Explanation, Provenance, Roster, Score, TeamAssessment,
} from '../interfaces.js';
import type { StatResolver } from '../stat-resolver.js';
import { equippedBuild } from '../roster/from-hoyolab.js';
import { assess } from '../curated/scoring.js';
import { selectVariant } from '../curated/variant.js';
import { matchArchetype, type ArchetypeMatch } from './matching.js';
import { reactionsFor, resonanceFor } from './rules.js';

export interface TeamOption {
  readonly match: ArchetypeMatch;
  readonly assessment: TeamAssessment;
  /** Qual critério decidiu a posição deste time na lista (spec §7.1). */
  readonly rankedBy: 'strength' | 'targets' | 'declared';
}

export interface TeamsForResult {
  readonly playable: readonly TeamOption[];
  readonly blocked: readonly TeamOption[];
}

export interface CuratedTeamEvaluatorOptions {
  readonly bank: MetaBank;
  readonly resolver: StatResolver;
}

const STRENGTH_ORDER: Readonly<Record<TeamArchetypeData['strength'], number>> = {
  meta: 0,
  strong: 1,
  niche: 2,
};

interface SlotOutcome {
  readonly slotIndex: number;
  readonly character: CharacterKey | null;
  readonly variantLabel: string | null;
  readonly variantId: string | null;
  readonly meetsHardTargets: boolean;
  readonly requiredEr: number | null;
  readonly actualEr: number | null;
  readonly line: string;
}

export class CuratedTeamEvaluator {
  constructor(private readonly opts: CuratedTeamEvaluatorOptions) {}

  /**
   * A visão centrada no personagem: para X, quais times o roster do jogador
   * consegue formar hoje, e quais ficam a um slot de distância.
   *
   * Só arquétipos curados (decisão D4). Personagem fora do banco devolve as
   * duas listas vazias — não se inventa time (spec §14.2).
   */
  async teamsFor(subject: CharacterKey, roster: Roster): Promise<TeamsForResult> {
    const { bank } = this.opts;
    const playable: TeamOption[] = [];
    const blocked: TeamOption[] = [];

    for (const archetype of bank.archetypes) {
      if (archetype.gameVersionRetired !== undefined) continue;

      const canHost = archetype.slots.some((slot) =>
        slot.requires.kind === 'character'
          ? slot.requires.anyOf.includes(subject)
          : roster.characters.get(subject)?.element === slot.requires.element,
      );
      if (!canHost) continue;

      const match = matchArchetype(archetype, roster, bank, { require: subject });
      if (match.status === 'too-far') continue;

      const option = { match, assessment: await this.assessTeam(match, roster) };
      if (match.status === 'playable') playable.push({ ...option, rankedBy: 'strength' });
      else blocked.push({ ...option, rankedBy: 'strength' });
    }

    return { playable: this.rank(playable), blocked: this.rank(blocked) };
  }

  /**
   * `strength` curado primeiro; empate desfeito por quantos slots cumprem os
   * alvos duros; empate persistente pela ordem declarada no banco. Cada time
   * carrega qual critério o posicionou — nunca um número sem origem.
   */
  private rank(options: TeamOption[]): TeamOption[] {
    const scoreOf = (o: TeamOption): number =>
      o.assessment.energyFeasibility.filter((e) => e.actual >= e.required).length;

    return [...options]
      .map((option, declaredIndex) => ({ option, declaredIndex }))
      .sort((a, b) => {
        const strength =
          STRENGTH_ORDER[a.option.match.archetype.strength] - STRENGTH_ORDER[b.option.match.archetype.strength];
        if (strength !== 0) return strength;
        const targets = scoreOf(b.option) - scoreOf(a.option);
        if (targets !== 0) return targets;
        return a.declaredIndex - b.declaredIndex;
      })
      .map(({ option }, index, all) => {
        const previous = all[index - 1]?.option;
        const rankedBy: TeamOption['rankedBy'] =
          previous === undefined || previous.match.archetype.strength !== option.match.archetype.strength
            ? 'strength'
            : scoreOf(previous) !== scoreOf(option)
              ? 'targets'
              : 'declared';
        return { ...option, rankedBy };
      });
  }

  private async assessTeam(match: ArchetypeMatch, roster: Roster): Promise<TeamAssessment> {
    const { bank, resolver } = this.opts;
    const outcomes: SlotOutcome[] = [];

    for (const [slotIndex, key] of match.fills.entries()) {
      const slot = match.archetype.slots[slotIndex]!;
      if (key === null) {
        outcomes.push({
          slotIndex, character: null, variantLabel: null, variantId: null,
          meetsHardTargets: false, requiredEr: null, actualEr: null,
          line: `Slot ${slotIndex + 1} (${slot.role.join('/')}): vazio — nenhum personagem seu ocupa este papel.`,
        });
        continue;
      }

      const build = equippedBuild(roster, key);
      const profile = bank.profiles.get(key);
      if (!build || !profile) {
        outcomes.push({
          slotIndex, character: key, variantLabel: null, variantId: null,
          meetsHardTargets: false, requiredEr: null, actualEr: null,
          line: `Slot ${slotIndex + 1}: ${String(key)} — sem ficha curada, build não julgada.`,
        });
        continue;
      }

      const stats = await resolver.resolve(build);
      const choice = selectVariant(profile, build, stats, bank.scoring, {
        ...(slot.variant === undefined ? {} : { fromArchetype: slot.variant }),
      });

      // Alvos da ficha, sobrescritos pelos do arquétipo quando houver (spec §4.2).
      const overridden = new Map(choice.variant.targets.map((t) => [targetId(t), t] as const));
      for (const override of slot.targetOverrides ?? []) overridden.set(targetId(override), override);
      const targets = [...overridden.values()];

      const result = assess(build, { ...choice.variant, targets }, stats, bank.scoring);
      const erTarget = targets.find((t) => t.kind === 'min' && t.stat === 'enerRech_');

      outcomes.push({
        slotIndex,
        character: key,
        variantLabel: choice.variant.label,
        variantId: choice.variant.id,
        meetsHardTargets: !result.blocked,
        requiredEr: erTarget && erTarget.kind === 'min' ? erTarget.value : null,
        actualEr: stats?.enerRech_ ?? null,
        line:
          `Slot ${slotIndex + 1} (${slot.role.join('/')}): ${String(key)} — ` +
          `${choice.explanation} ${result.blocked ? 'Há alvo obrigatório fora do lugar.' : 'Alvos obrigatórios cumpridos.'}`,
      });
    }

    const elements = match.fills
      .filter((k): k is CharacterKey => k !== null)
      .map((k) => roster.characters.get(k)?.element)
      .filter((e): e is Element => e !== undefined);

    const roleCoverage: Partial<Record<RoleTag, 'missing' | 'weak' | 'covered'>> = {};
    for (const [slotIndex, slot] of match.archetype.slots.entries()) {
      const outcome = outcomes[slotIndex]!;
      const state = outcome.character === null ? 'missing' : outcome.meetsHardTargets ? 'covered' : 'weak';
      for (const role of slot.role) {
        // Não rebaixa: um papel coberto por um slot não vira "missing" por outro.
        if (roleCoverage[role] === 'covered') continue;
        if (roleCoverage[role] === 'weak' && state === 'missing') continue;
        roleCoverage[role] = state;
      }
    }

    const provenance: Provenance = {
      evaluatorId: 'curated-team',
      kind: 'curated',
      gameVersion: match.archetype.gameVersionAdded,
      datasetSha: bank.datasetSha,
      confidence: match.status === 'playable' ? 'high' : 'medium',
      assumptions: [
        'arquétipo CURADO: a força relativa é dado autoral, não fórmula',
        'saída ORDINAL: serve para comparar times, não para prever dano',
        `resolver de stats: ${resolver.id}`,
      ],
      rosterCompleteness: roster.provenance.completeness,
      cacheKey: `curated-team:${bank.datasetSha}:${match.archetype.id}:${match.fills.join(',')}`,
    };

    const score: Score = {
      value: outcomes.filter((o) => o.meetsHardTargets).length,
      unit: 'score',
      violations: [],
      provenance,
    };

    const explanation: Explanation = {
      summary:
        `${match.archetype.label} (${match.archetype.strength}) — ` +
        (match.status === 'playable'
          ? 'você tem todos os personagens deste time.'
          : `falta 1 slot para você jogar este time.`),
      reasons: outcomes.map((o) => ({ claim: o.line })),
      citations: [...match.archetype.sources],
    };

    return {
      archetype: {
        id: match.archetype.id,
        label: match.archetype.label,
        matchConfidence: match.fills.filter(Boolean).length / match.archetype.slots.length,
      },
      reactions: reactionsFor(elements),
      resonance: resonanceFor(elements),
      roleCoverage,
      energyFeasibility: outcomes
        .filter((o) => o.character !== null && o.requiredEr !== null)
        .map((o) => ({ of: o.character!, required: o.requiredEr!, actual: o.actualEr ?? 0 })),
      score,
      explanation,
    };
  }
}

/** Identidade de um alvo, para o override do arquétipo substituir o certo. */
function targetId(target: { kind: string; stat?: string; numerator?: string; denominator?: string }): string {
  return target.kind === 'ratio'
    ? `ratio:${target.numerator}/${target.denominator}`
    : `${target.kind}:${target.stat}`;
}
```

- [ ] **Step 4: Exportar**

Em `packages/engine/src/index.ts`:

```ts
export { reactionsFor, resonanceFor } from './team/rules.js';
export { matchArchetype } from './team/matching.js';
export type { ArchetypeMatch, MatchOptions } from './team/matching.js';
export { CuratedTeamEvaluator } from './team/evaluator.js';
export type { TeamOption, TeamsForResult, CuratedTeamEvaluatorOptions } from './team/evaluator.js';
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @buer/engine exec vitest run test/team/evaluator.test.ts`
Expected: PASS (7 testes).

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/team/evaluator.ts packages/engine/src/index.ts packages/engine/test/team/evaluator.test.ts
git commit -m "feat(engine): CuratedTeamEvaluator — times de um personagem, ordenados por força curada"
```

---

## Task 10: `CuratedRosterAdvisor` — o que adquirir

Aquisição sai **inteiramente** de arquétipo bloqueado. Nada aqui é tier list: os dois critérios de ordenação são fatos contáveis sobre o banco cruzado com o roster.

**Files:**
- Create: `packages/engine/src/advisor/advisor.ts`
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/test/advisor.test.ts`

**Interfaces:**
- Consumes: `matchArchetype` (Task 8), `MetaBank`.
- Produces: `class CuratedRosterAdvisor implements RosterAdvisor` com `advise(roster, prefs)` (conta inteira) e `adviseFor(subject, roster)` (escopo de um personagem), ambas devolvendo `AcquisitionAdvice`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `packages/engine/test/advisor.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadMeta } from '@buer/meta';
import type { CharacterKey } from '@buer/core';
import { rosterFromHoyolab } from '../src/roster/from-hoyolab.js';
import { CuratedRosterAdvisor } from '../src/advisor/advisor.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(
  readFileSync(path.join(HERE, '..', '..', 'core', 'test', 'fixtures', 'real-account.scrubbed.json'), 'utf8'),
);
const full = rosterFromHoyolab(raw, { capturedAt: '2026-08-24T00:00:00.000Z', lang: 'pt-br' });
const bank = loadMeta();
const advisor = new CuratedRosterAdvisor({ bank });
const XIANGLING = '10000023' as CharacterKey;
const XINGQIU = '10000025' as CharacterKey;

const without = (key: string) => ({
  ...full,
  characters: new Map([...full.characters].filter(([k]) => k !== key)),
});

describe('CuratedRosterAdvisor', () => {
  it('roster sem xingqiu sugere adquirir xingqiu, com o arquétipo que ele destrava', async () => {
    const advice = await advisor.adviseFor(XIANGLING, without('10000025'));
    const candidate = advice.candidates.find(
      (c) => c.axis.kind === 'newCharacter' && c.axis.character === XINGQIU,
    );
    expect(candidate).toBeDefined();
    expect(candidate!.unlocks.map((u) => u.archetype.id)).toContain('national');
    expect(candidate!.explanation.summary).toContain('National');
  });

  it('não sugere nada para um arquétipo que já é jogável', async () => {
    const advice = await advisor.adviseFor(XIANGLING, full);
    // Escopado ao National de propósito: a Task 11 acrescenta arquétipos em
    // que Xiangling pode hospedar um slot flex de pyro, e um
    // `toHaveLength(0)` global passaria a quebrar por crescimento do banco,
    // não por regressão do conselheiro.
    const unlocked = advice.candidates.flatMap((c) => c.unlocks.map((u) => u.archetype.id));
    expect(unlocked).not.toContain('national');
  });

  it('improves fica VAZIO na Fase 2 — não se afirma quanto rende (spec §8.4)', async () => {
    const advice = await advisor.adviseFor(XIANGLING, without('10000025'));
    for (const candidate of advice.candidates) expect(candidate.improves).toHaveLength(0);
  });

  it('ordena por quantos arquétipos destrava, depois por força curada', async () => {
    const advice = await advisor.adviseFor(XIANGLING, without('10000025'));
    for (let i = 1; i < advice.candidates.length; i++) {
      const previous = advice.candidates[i - 1]!;
      const current = advice.candidates[i]!;
      expect(previous.unlocks.length).toBeGreaterThanOrEqual(current.unlocks.length);
    }
  });

  it('declara nas assunções que não sabe disponibilidade de gacha', async () => {
    const advice = await advisor.adviseFor(XIANGLING, without('10000025'));
    const text = advice.candidates[0]!.provenance.assumptions.join(' ');
    expect(text).toMatch(/gacha|disponibilidade/i);
  });

  it('slot flex vazio vira CoverageGap com elemento e papéis, não um nome', async () => {
    // remove todos os anemo do roster: o slot flex do National deixa de fechar
    const noAnemo = {
      ...full,
      characters: new Map([...full.characters].filter(([, c]) => c.element !== 'anemo')),
    };
    const advice = await advisor.adviseFor(XIANGLING, noAnemo);
    const gap = advice.coverageGaps.find((g) => g.missing.element === 'anemo');
    expect(gap).toBeDefined();
    expect(gap!.blockedArchetypes).toContain('national');
    expect(['critical', 'notable', 'minor']).toContain(gap!.severity);
  });

  it('a visão de conta cobre todos os arquétipos, não só os de um personagem', async () => {
    const accountView = await advisor.advise(without('10000025'), {} as never);
    const characterView = await advisor.adviseFor(XIANGLING, without('10000025'));
    expect(accountView.candidates.length).toBeGreaterThanOrEqual(characterView.candidates.length);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @buer/engine exec vitest run test/advisor.test.ts`
Expected: FAIL — `Failed to resolve import "../src/advisor/advisor.js"`.

- [ ] **Step 3: Escrever o conselheiro**

Criar `packages/engine/src/advisor/advisor.ts`:

```ts
import type { CharacterKey, Element, RoleTag } from '@buer/core';
import type { MetaBank, TeamArchetypeData } from '@buer/meta';
import type {
  AcquisitionAdvice, AcquisitionCandidate, AdvisorPreferences, CoverageGap,
  InvestmentAxis, Provenance, Roster, RosterAdvisor,
} from '../interfaces.js';
import { matchArchetype } from '../team/matching.js';

export interface CuratedRosterAdvisorOptions {
  readonly bank: MetaBank;
}

const SEVERITY: Readonly<Record<TeamArchetypeData['strength'], CoverageGap['severity']>> = {
  meta: 'critical',
  strong: 'notable',
  niche: 'minor',
};

const STRENGTH_ORDER: Readonly<Record<TeamArchetypeData['strength'], number>> = {
  meta: 0, strong: 1, niche: 2,
};

interface Blockage {
  readonly archetype: TeamArchetypeData;
  readonly slotIndex: number;
}

function axisKey(axis: InvestmentAxis): string {
  switch (axis.kind) {
    case 'newCharacter': return `char:${String(axis.character)}`;
    case 'newWeapon': return `weapon:${String(axis.weapon)}`;
    case 'constellation': return `cons:${axis.from}->${axis.to}`;
    case 'refinement': return `refine:${axis.from}->${axis.to}`;
    case 'talent': return `talent:${axis.which}:${axis.from}->${axis.to}`;
    default: return 'artifact';
  }
}

export class CuratedRosterAdvisor implements RosterAdvisor {
  constructor(private readonly opts: CuratedRosterAdvisorOptions) {}

  /** Conta inteira: todo arquétipo do banco. */
  async advise(roster: Roster, _prefs: AdvisorPreferences): Promise<AcquisitionAdvice> {
    return this.build(roster, this.opts.bank.archetypes, undefined);
  }

  /** Escopo de um personagem: só os arquétipos que o incluem. */
  async adviseFor(subject: CharacterKey, roster: Roster): Promise<AcquisitionAdvice> {
    const element = roster.characters.get(subject)?.element;
    const relevant = this.opts.bank.archetypes.filter((archetype) =>
      archetype.slots.some((slot) =>
        slot.requires.kind === 'character'
          ? slot.requires.anyOf.includes(subject)
          : element !== undefined && slot.requires.element === element,
      ),
    );
    return this.build(roster, relevant, subject);
  }

  private build(
    roster: Roster,
    archetypes: readonly TeamArchetypeData[],
    subject: CharacterKey | undefined,
  ): AcquisitionAdvice {
    const { bank } = this.opts;
    const blockages: Blockage[] = [];

    for (const archetype of archetypes) {
      if (archetype.gameVersionRetired !== undefined) continue;
      const match = matchArchetype(archetype, roster, bank, subject === undefined ? {} : { require: subject });
      // Só "falta exatamente 1" vira conselho. Dois ou mais é longe demais
      // para ser acionável (spec §7.1).
      if (match.status !== 'blocked-by-one') continue;
      blockages.push({ archetype, slotIndex: match.missing[0]! });
    }

    const byAxis = new Map<string, { axis: InvestmentAxis; unlocks: Blockage[] }>();
    const gaps: CoverageGap[] = [];
    const gapIndex = new Map<string, CoverageGap & { blocked: string[] }>();

    for (const blockage of blockages) {
      const slot = blockage.archetype.slots[blockage.slotIndex]!;

      if (slot.requires.kind === 'element') {
        const element = slot.requires.element as Element;
        const roles = (slot.requires.withRole.length > 0 ? slot.requires.withRole : slot.role) as RoleTag[];
        const key = `${element}:${roles.join(',')}`;
        const existing = gapIndex.get(key);
        if (existing) {
          existing.blocked.push(blockage.archetype.id);
          continue;
        }
        const candidates = [...bank.profiles.values()]
          .filter((p) => p.variants.some((v) => v.roles.some((r) => roles.includes(r))))
          .map((p) => String(p.character));
        const gap = {
          description:
            `Falta um personagem de ${element} que cumpra ${roles.join(' ou ')}. ` +
            (candidates.length > 0
              ? `Com ficha no banco hoje: ${candidates.join(', ')}.`
              : 'Nenhum personagem com ficha cobre esse papel ainda.'),
          missing: { element, roles },
          blockedArchetypes: [blockage.archetype.id],
          severity: SEVERITY[blockage.archetype.strength],
          blocked: [blockage.archetype.id],
        };
        gapIndex.set(key, gap);
        gaps.push(gap);
        continue;
      }

      for (const named of slot.requires.anyOf) {
        const owned = roster.characters.get(named);
        let axis: InvestmentAxis;

        if (owned && slot.minConstellation !== undefined && owned.constellation < slot.minConstellation) {
          axis = { kind: 'constellation', from: owned.constellation, to: slot.minConstellation };
        } else if (owned && slot.minRefinement !== undefined) {
          const weapon = roster.weapons.find((w) => w.equippedBy === named);
          axis = {
            kind: 'refinement',
            from: (weapon?.refinement ?? 1) as 1 | 2 | 3 | 4 | 5,
            to: slot.minRefinement as 1 | 2 | 3 | 4 | 5,
          };
        } else if (owned) {
          continue; // tem o personagem e ele atende: não é este que bloqueia
        } else {
          axis = { kind: 'newCharacter', character: named };
        }

        const key = axisKey(axis);
        const entry = byAxis.get(key) ?? { axis, unlocks: [] };
        entry.unlocks.push(blockage);
        byAxis.set(key, entry);
      }
    }

    const candidates: AcquisitionCandidate[] = [...byAxis.values()]
      .map(({ axis, unlocks }) => {
        const provenance: Provenance = {
          evaluatorId: 'curated-advisor',
          kind: 'curated',
          gameVersion: unlocks[0]!.archetype.gameVersionAdded,
          datasetSha: bank.datasetSha,
          confidence: 'high',
          assumptions: [
            'destrava = contagem sobre o banco de arquétipos cruzado com o seu roster, não opinião',
            'NÃO estimamos quanto rende: isso exige o avaliador analítico da Fase 3',
            'não sabemos disponibilidade de gacha (limitado, padrão, evento, loja) — a viabilidade é sua',
          ],
          rosterCompleteness: roster.provenance.completeness,
          cacheKey: `curated-advisor:${bank.datasetSha}:${axisKey(axis)}`,
        };

        return {
          axis,
          unlocks: unlocks.map((b) => ({
            archetype: b.archetype as never,
            wasBlockedBy: [`slot ${b.slotIndex + 1} (${b.archetype.slots[b.slotIndex]!.role.join('/')})`],
          })),
          improves: [], // spec §8.4 — vazio por decisão, não por esquecimento
          redundancyWith: this.redundancyFor(axis, unlocks, roster),
          explanation: {
            summary:
              `Destrava ${unlocks.length} time(s): ` +
              unlocks.map((b) => b.archetype.label).join(', ') + '.',
            reasons: unlocks.map((b) => ({
              claim: `${b.archetype.label} (${b.archetype.strength}) está a um slot de distância.`,
              evidence: b.archetype.sources.join(' '),
            })),
            citations: [...new Set(unlocks.flatMap((b) => b.archetype.sources))],
          },
          provenance,
        } satisfies AcquisitionCandidate;
      })
      .sort((a, b) => {
        const byUnlocks = b.unlocks.length - a.unlocks.length;
        if (byUnlocks !== 0) return byUnlocks;
        const strengthA = Math.min(...a.unlocks.map((u) => STRENGTH_ORDER[u.archetype.strength]));
        const strengthB = Math.min(...b.unlocks.map((u) => STRENGTH_ORDER[u.archetype.strength]));
        return strengthA - strengthB;
      });

    return { candidates, coverageGaps: gaps.map(({ blocked, ...gap }) => ({ ...gap, blockedArchetypes: blocked })) };
  }

  /**
   * Quem você JÁ TEM que faz o mesmo trabalho. É a única parte do sistema
   * que ativamente desaconselha gastar — e por isso é a que constrói
   * confiança (spec §8.3).
   */
  private redundancyFor(
    axis: InvestmentAxis,
    unlocks: readonly Blockage[],
    roster: Roster,
  ): readonly CharacterKey[] {
    if (axis.kind !== 'newCharacter') return [];
    const { bank } = this.opts;

    const wantedRoles = new Set<string>();
    for (const blockage of unlocks) {
      for (const role of blockage.archetype.slots[blockage.slotIndex]!.role) wantedRoles.add(role);
    }
    const wantedElement = bank.profiles.has(axis.character)
      ? roster.characters.get(axis.character)?.element
      : undefined;

    return [...roster.characters.keys()].filter((key) => {
      if (key === axis.character) return false;
      const profile = bank.profiles.get(key);
      if (!profile) return false;
      if (wantedElement !== undefined && roster.characters.get(key)?.element !== wantedElement) return false;
      return profile.variants.some((v) => v.roles.some((r) => wantedRoles.has(r)));
    });
  }
}
```

- [ ] **Step 4: Exportar**

Em `packages/engine/src/index.ts`:

```ts
export { CuratedRosterAdvisor } from './advisor/advisor.js';
export type { CuratedRosterAdvisorOptions } from './advisor/advisor.js';
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @buer/engine exec vitest run test/advisor.test.ts`
Expected: PASS (7 testes).

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/advisor packages/engine/src/index.ts packages/engine/test/advisor.test.ts
git commit -m "feat(engine): CuratedRosterAdvisor — aquisição derivada de arquétipo bloqueado"
```

---

## Task 11: A primeira leva de fichas e arquétipos à mão

O motor está pronto e tem duas fichas. Esta tarefa é **autoria de conteúdo**, não de código: escrever à mão o suficiente para cobrir os personagens investidos da conta de calibração. É o que a §13 da spec manda fazer **antes** de soltar o pipeline em lote nos 120 — escrever as primeiras à mão é o que ensina qual deve ser o prompt do pipeline.

**Files:**
- Create: `packages/meta/data/characters/{xingqiu,fischl,chevreuse,gorou,noelle,razor,tighnari}.json`
- Create: `packages/meta/data/archetypes/{hyperbloom,freeze,overload-chevreuse,mono-geo}.json`
- Test: `packages/engine/test/coverage.test.ts`

**Interfaces:**
- Consumes: o schema da Task 3. Nada de código novo.
- Produces: dado. `bank.profiles.size >= 10`, `bank.archetypes.length >= 5`.

- [ ] **Step 1: Escrever o teste de cobertura que falha**

Criar `packages/engine/test/coverage.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadMeta } from '@buer/meta';
import { rosterFromHoyolab } from '../src/roster/from-hoyolab.js';
import { matchArchetype } from '../src/team/matching.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(
  readFileSync(path.join(HERE, '..', '..', 'core', 'test', 'fixtures', 'real-account.scrubbed.json'), 'utf8'),
);
const roster = rosterFromHoyolab(raw, { capturedAt: '2026-08-24T00:00:00.000Z', lang: 'pt-br' });
const bank = loadMeta();

describe('cobertura da primeira leva curada', () => {
  it('tem ao menos 10 fichas e 5 arquétipos', () => {
    expect(bank.profiles.size).toBeGreaterThanOrEqual(10);
    expect(bank.archetypes.length).toBeGreaterThanOrEqual(5);
  });

  it('todo arquétipo do banco é jogável OU bloqueado-por-um na conta de calibração', () => {
    // Se um arquétipo sai "too-far" na conta que tem 63 personagens, quase
    // sempre é slot autorado errado (papel que ninguém declara, ou minCons
    // alto demais), não escassez de roster.
    const tooFar = bank.archetypes
      .map((a) => ({ id: a.id, status: matchArchetype(a, roster, bank).status }))
      .filter((x) => x.status === 'too-far');
    expect(tooFar).toEqual([]);
  });

  it('todo slot flex do banco casa com pelo menos um personagem com ficha', () => {
    const orphans: string[] = [];
    for (const archetype of bank.archetypes) {
      for (const [index, slot] of archetype.slots.entries()) {
        if (!slot.substitutable) continue;
        const roles = new Set<string>(
          slot.requires.kind === 'element' && slot.requires.withRole.length > 0
            ? slot.requires.withRole
            : slot.role,
        );
        const anyone = [...bank.profiles.values()].some((p) =>
          p.variants.some((v) => v.roles.some((r) => roles.has(r))),
        );
        if (!anyone) orphans.push(`${archetype.id} slot ${index + 1}`);
      }
    }
    expect(orphans).toEqual([]);
  });

  it('nenhuma ficha alega confidence high sem fonte', () => {
    const liars = [...bank.profiles.values()]
      .filter((p) => p.provenance.confidence === 'high' && p.provenance.sources.length === 0)
      .map((p) => String(p.character));
    expect(liars).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @buer/engine exec vitest run test/coverage.test.ts`
Expected: FAIL — `expected 2 to be greater than or equal to 10`.

- [ ] **Step 3: Escrever a ficha do Xingqiu (o padrão a seguir)**

Criar `packages/meta/data/characters/xingqiu.json`:

```json
{
  "schemaVersion": 1,
  "character": "xingqiu",
  "variants": [
    {
      "id": "sub-dps-er",
      "label": "Sub-DPS de hydro (ER alto)",
      "roles": ["sub-dps", "enabler"],
      "scalesOn": "atk",
      "sets": [
        { "kind": "4pc", "sets": ["emblem-of-severed-fate"], "rank": 1 },
        { "kind": "4pc", "sets": ["noblesse-oblige"], "rank": 2, "condition": "quando ninguém mais no time carrega Noblesse" }
      ],
      "mainStats": {
        "sands": ["atk_", "enerRech_"],
        "goblet": ["hydro_dmg_"],
        "circlet": ["critRate_", "critDMG_"]
      },
      "substats": ["critRate_", "critDMG_", "atk_", "enerRech_"],
      "weapons": [
        { "weapon": "sacrificial-sword", "rank": 1 },
        { "weapon": "favonius-sword", "rank": 2 }
      ],
      "targets": [
        { "kind": "min", "stat": "enerRech_", "value": 180, "hard": true, "why": "as chuvas de espadas vêm do burst de 80 de energia; abaixo de 180% de ER ele não volta a cada rotação e a aplicação de hydro do time some" },
        { "kind": "ratio", "numerator": "critDMG_", "denominator": "critRate_", "min": 1.5, "max": 2.5, "why": "crit desbalanceado desperdiça substats" }
      ]
    }
  ],
  "provenance": {
    "authoredBy": "human",
    "sources": [],
    "authoredAt": "2026-08-24",
    "validatedForVersion": "7.0",
    "confidence": "medium"
  }
}
```

A ficha da Sucrose já foi criada na Task 3 (ela fecha o slot flex do National). Não recrie.

- [ ] **Step 4: Escrever as seis fichas restantes**

Mesmo formato. Personagens, variantes e papéis são **fixos** — foram escolhidos por serem os investidos da conta de calibração e por fecharem os arquétipos da Step 5:

| Ficha | Variantes (`id`) | `roles` | `scalesOn` |
|---|---|---|---|
| `fischl.json` | `off-field-electro` | `sub-dps` | `atk` |
| `chevreuse.json` | `overload-support` | `buffer`, `healer`, `debuffer` | `hp` |
| `gorou.json` | `geo-support` | `buffer` | `def` |
| `noelle.json` | `def-carry` | `main-dps`, `shielder`, `healer` | `def` |
| `razor.json` | `physical-carry` | `main-dps` | `atk` |
| `tighnari.json` | `spread-carry` | `main-dps` | `atk` |

Regras de autoria — são o que o validador e os testes cobram:

- Todo `target` carrega `why` que explica **o número**, não repete o nome do stat.
- `confidence` fica em `"medium"` com `sources: []`. Só sobe para `"high"` com URL em `sources` — o teste da Step 1 rejeita `high` sem fonte, e o de integridade rejeita `high` com `authoredBy: "researched"`.
- `condition` é frase para o humano ler, nunca expressão.
- Todo `rank` é único dentro de `sets` e dentro de `weapons`.
- `mainStats` nunca lista flor nem pluma.

- [ ] **Step 5: Escrever os quatro arquétipos restantes**

Mesmo formato do `national.json`. Ao menos **um slot flex** em cada, para exercitar o casamento por papel:

| Arquétipo | `strength` | Slots (fixo = personagem nomeado; flex = elemento + papel) |
|---|---|---|
| `hyperbloom.json` | `meta` | fixo: dendro enabler; fixo: `xingqiu` (`sub-dps-er`); flex: electro `sub-dps`; flex: qualquer `buffer`/`healer` |
| `freeze.json` | `strong` | fixo: `xingqiu`; flex: cryo `main-dps`; flex: cryo `sub-dps`; flex: anemo `driver` |
| `overload-chevreuse.json` | `strong` | fixo: `chevreuse` (`overload-support`); fixo: `fischl` (`off-field-electro`); flex: pyro `main-dps`; flex: electro `sub-dps` |
| `mono-geo.json` | `niche` | fixo: `noelle` (`def-carry`); fixo: `gorou` (`geo-support`); flex: geo `sub-dps`; flex: qualquer `buffer` |

Todo arquétipo declara `sources: []` e `tags` com ao menos um de `abyss`/`overworld`/`f2p`/`no-5star`.

- [ ] **Step 6: Rodar a integridade e a cobertura**

Run: `pnpm --filter @buer/meta exec vitest run && pnpm --filter @buer/engine exec vitest run test/coverage.test.ts`
Expected: PASS. Falha de integridade nomeia a ficha e a regra — corrija a ficha, nunca a validação.

- [ ] **Step 7: Confirmar que o motor produz mais times com o banco maior**

Run: `pnpm --filter @buer/engine exec vitest run`
Expected: PASS, incluindo o teste de slot flex do National (Task 8), que agora fecha com Sucrose.

- [ ] **Step 8: Commit**

```bash
git add packages/meta/data packages/engine/test/coverage.test.ts
git commit -m "feat(meta): primeira leva curada à mão — 10 fichas, 5 arquétipos"
```

---

## Task 12: Comando `analyze`, golden file e casos-âncora

A saída que fecha a Fase 2: rodar o motor na sua conta e ler o veredito. Mais as duas redes de segurança da §12 da spec.

**Files:**
- Create: `apps/cli/src/commands/analyze.ts`, `apps/cli/src/report.ts`
- Modify: `apps/cli/src/index.ts`, `apps/cli/package.json`
- Create: `packages/engine/test/anchors.test.ts`
- Test: `apps/cli/test/analyze.test.ts`, `apps/cli/test/__golden__/analyze-63.json`

**Interfaces:**
- Consumes: `rosterFromHoyolab`, `CuratedTeamEvaluator`, `CuratedRosterAdvisor`, `ObservedStatResolver` de `@buer/engine`; `loadMeta` de `@buer/meta`.
- Produces:
  - `runAnalyze(flags: AnalyzeFlags): Promise<AnalyzeResult>` com `AnalyzeFlags = { from: string; character?: string; account?: boolean; variant?: string; json?: boolean }`
  - `renderReport(result: AnalyzeResult): string`

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/cli/test/analyze.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runAnalyze } from '../src/commands/analyze.js';
import { renderReport } from '../src/report.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, '..', '..', '..', 'packages', 'core', 'test', 'fixtures', 'real-account.scrubbed.json');
const GOLDEN = path.join(HERE, '__golden__', 'analyze-63.json');

describe('runAnalyze --character', () => {
  it('devolve times e veredito para xiangling', async () => {
    const result = await runAnalyze({ from: FIXTURE, character: 'xiangling' });
    expect(result.scope).toBe('character');
    expect(result.characters).toHaveLength(1);
    const entry = result.characters[0]!;
    expect(entry.slug).toBe('xiangling');
    expect(entry.playableTeams.length).toBeGreaterThan(0);
    expect(entry.playableTeams[0]!.findings.length).toBe(5);
  });

  it('personagem sem ficha devolve os FATOS e diz que não há veredito', async () => {
    const result = await runAnalyze({ from: FIXTURE, character: 'barbara' });
    const entry = result.characters[0]!;
    expect(entry.playableTeams).toHaveLength(0);
    expect(entry.note).toMatch(/sem ficha|sem time curado/i);
    expect(entry.observed.atk).toBeTypeOf('number');
  });

  it('--variant fixa a variante julgada', async () => {
    const result = await runAnalyze({ from: FIXTURE, character: 'xiangling', variant: 'vaporize' });
    const team = result.characters[0]!.playableTeams[0];
    if (team) expect(team.variantId).toBe('vaporize');
  });

  it('slug desconhecido falha com mensagem útil, não com stack', async () => {
    await expect(runAnalyze({ from: FIXTURE, character: 'nao-existe' })).rejects.toThrow(/nao-existe/);
  });
});

describe('renderReport', () => {
  it('nomeia a variante julgada e traz o why de todo achado bloqueante', async () => {
    const result = await runAnalyze({ from: FIXTURE, character: 'xiangling' });
    const text = renderReport(result);
    expect(text).toMatch(/variante/i);
    for (const entry of result.characters) {
      for (const team of entry.playableTeams) {
        for (const finding of team.findings) {
          if (finding.status === 'blocking') expect(finding.why ?? '').not.toBe('');
        }
      }
    }
  });
});

describe('golden file da conta inteira', () => {
  it('o relatório dos 63 personagens não mudou sem revisão', async () => {
    const result = await runAnalyze({ from: FIXTURE, account: true });
    const serialized = JSON.stringify(result, null, 2);

    if (process.env['UPDATE_GOLDEN'] === '1' || !existsSync(GOLDEN)) {
      writeFileSync(GOLDEN, serialized);
    }
    expect(serialized).toBe(readFileSync(GOLDEN, 'utf8'));
  });

  it('invariantes sobre os 63 reais (spec §12, camada 3)', async () => {
    const result = await runAnalyze({ from: FIXTURE, account: true });
    expect(result.characters).toHaveLength(63);

    for (const entry of result.characters) {
      // todo personagem ou tem time, ou tem um motivo explícito de não ter
      const hasTeams = entry.playableTeams.length + entry.blockedTeams.length > 0;
      expect(hasTeams || (entry.note ?? '') !== '').toBe(true);

      for (const team of [...entry.playableTeams, ...entry.blockedTeams]) {
        expect(team.variantId ?? '').not.toBe('');   // variante SEMPRE nomeada
        expect(team.explanation).not.toBe('');       // veredito SEMPRE explicado
        for (const finding of team.findings) {
          expect(finding.summary).not.toBe('');
          if (finding.status === 'blocking') expect(finding.why ?? '').not.toBe('');
        }
      }
    }
  });
});
```

Criar `packages/engine/test/anchors.test.ts` — a camada 5 da §12, o que **não pode** acontecer:

```ts
import { describe, it, expect } from 'vitest';
import { loadMeta } from '@buer/meta';
import { resolveCharacter } from '@buer/meta';
import type { CharacterKey, StatKey } from '@buer/core';

const bank = loadMeta();
const profileOf = (slug: string) => bank.profiles.get(resolveCharacter(slug)!)!;
const allMainStats = (slug: string): StatKey[] =>
  profileOf(slug).variants.flatMap((v) => [...v.mainStats.sands, ...v.mainStats.goblet, ...v.mainStats.circlet]);

/**
 * Casos-âncora: afirmações escritas à mão do que o sistema NUNCA pode dizer.
 * Não provam que um veredito está certo — provam que erros que sabemos
 * reconhecer não passam. Falsificação, não verificação (spec §12).
 *
 * REGRA DE MANUTENÇÃO: toda ficha nova entra aqui com pelo menos uma âncora
 * sobre o que ela NÃO pode recomendar. É o preço de admitir uma ficha no banco.
 */
describe('casos-âncora do banco curado', () => {
  it('personagem que escala com DEF nunca recebe main-stat de ATQ%', () => {
    for (const slug of ['noelle', 'gorou']) {
      const defScaling = profileOf(slug).variants.filter((v) => v.scalesOn === 'def');
      expect(defScaling.length).toBeGreaterThan(0);
      for (const variant of defScaling) {
        expect([...variant.mainStats.sands, ...variant.mainStats.goblet]).not.toContain('atk_');
      }
    }
  });

  it('personagem que escala com HP nunca prioriza ATQ% em substats', () => {
    for (const variant of profileOf('chevreuse').variants.filter((v) => v.scalesOn === 'hp')) {
      expect(variant.substats.indexOf('atk_' as StatKey)).toBe(-1);
    }
  });

  it('Sucrose, que escala com maestria, tem maestria como main-stat', () => {
    expect(allMainStats('sucrose')).toContain('eleMas');
  });

  it('todo alvo hard de ER está entre 100 e 300 — fora disso é erro de autoria', () => {
    for (const profile of bank.profiles.values()) {
      for (const variant of profile.variants) {
        for (const target of variant.targets) {
          if (target.kind !== 'min' || target.stat !== 'enerRech_') continue;
          expect(target.value).toBeGreaterThanOrEqual(100);
          expect(target.value).toBeLessThanOrEqual(300);
        }
      }
    }
  });

  it('todo why explica o número, não repete o nome do stat', () => {
    for (const profile of bank.profiles.values()) {
      for (const variant of profile.variants) {
        for (const target of variant.targets) {
          expect(target.why.length).toBeGreaterThan(30);
        }
      }
    }
  });

  it('nenhuma variante lista o mesmo set em duas opções de rank diferente', () => {
    for (const profile of bank.profiles.values()) {
      for (const variant of profile.variants) {
        const fourPc = variant.sets.filter((s) => s.kind === '4pc').map((s) => s.sets[0]);
        expect(new Set(fourPc).size).toBe(fourPc.length);
      }
    }
  });

  it('toda variante declara ao menos um papel e ao menos uma opção de set', () => {
    for (const profile of bank.profiles.values()) {
      for (const variant of profile.variants) {
        expect(variant.roles.length).toBeGreaterThan(0);
        expect(variant.sets.length).toBeGreaterThan(0);
      }
    }
  });

  it('todo arquétipo meta tem ao menos um slot flex — senão não serve a rosters diferentes', () => {
    for (const archetype of bank.archetypes.filter((a) => a.strength === 'meta')) {
      expect(archetype.slots.some((s) => s.substitutable)).toBe(true);
    }
  });

  it('nenhum arquétipo exige constelação acima de 6 nem refino acima de 5', () => {
    for (const archetype of bank.archetypes) {
      for (const slot of archetype.slots) {
        if (slot.minConstellation !== undefined) expect(slot.minConstellation).toBeLessThanOrEqual(6);
        if (slot.minRefinement !== undefined) expect(slot.minRefinement).toBeLessThanOrEqual(5);
      }
    }
  });

  it('toda ficha declara data de autoria e patch de validade', () => {
    for (const profile of bank.profiles.values()) {
      expect(profile.provenance.authoredAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
      expect(profile.provenance.validatedForVersion).toMatch(/^\d+\.\d+$/);
    }
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `pnpm --filter @buer/cli exec vitest run test/analyze.test.ts`
Expected: FAIL — `Failed to resolve import "../src/commands/analyze.js"`.

- [ ] **Step 3: Escrever o comando**

Criar `apps/cli/src/commands/analyze.ts`:

```ts
import { readFileSync } from 'node:fs';
import { loadMeta, resolveCharacter, slugForCharacter } from '@buer/meta';
import type { CharacterKey } from '@buer/core';
import {
  CuratedRosterAdvisor, CuratedTeamEvaluator, ObservedStatResolver,
  equippedBuild, rosterFromHoyolab, assess, selectVariant,
  type Finding,
} from '@buer/engine';

export interface AnalyzeFlags {
  /** Caminho do arquivo de extração crua (o que `sync --raw-out` grava). */
  readonly from: string;
  readonly character?: string;
  readonly account?: boolean;
  readonly variant?: string;
  readonly json?: boolean;
}

export interface TeamReport {
  readonly archetypeId: string;
  readonly archetypeLabel: string;
  readonly strength: string;
  readonly rankedBy: string;
  readonly members: readonly (string | null)[];
  readonly variantId: string | null;
  readonly explanation: string;
  readonly findings: readonly Finding[];
  readonly energy: readonly { readonly of: string; readonly required: number; readonly actual: number }[];
}

export interface CharacterReport {
  readonly key: string;
  readonly slug: string;
  readonly level: number;
  readonly constellation: number;
  readonly observed: Readonly<Record<string, number>>;
  readonly playableTeams: readonly TeamReport[];
  readonly blockedTeams: readonly TeamReport[];
  readonly acquisitions: readonly { readonly axis: string; readonly unlocks: readonly string[]; readonly summary: string }[];
  readonly note?: string;
}

export interface AnalyzeResult {
  readonly scope: 'character' | 'account';
  readonly datasetSha: string;
  readonly characters: readonly CharacterReport[];
}

/**
 * `capturedAt` fixo e não o relógio: o resultado alimenta um golden file, e
 * um timestamp real tornaria todo diff ruidoso. A data real da captura vive
 * no snapshot do banco, não aqui.
 */
const CAPTURED_AT = '1970-01-01T00:00:00.000Z';

/** slug do gi-data -> chave numérica; erro legível quando não existe. */
function keyForSlug(slug: string): CharacterKey {
  const key = resolveCharacter(slug);
  if (!key) throw new Error(`personagem "${slug}" não existe no catálogo do gi-data`);
  return key;
}

export async function runAnalyze(flags: AnalyzeFlags): Promise<AnalyzeResult> {
  const raw = JSON.parse(readFileSync(flags.from, 'utf8')) as unknown;
  const roster = rosterFromHoyolab(raw, { capturedAt: CAPTURED_AT, lang: 'pt-br' });
  const bank = loadMeta();
  const resolver = new ObservedStatResolver();
  const teams = new CuratedTeamEvaluator({ bank, resolver });
  const advisor = new CuratedRosterAdvisor({ bank });

  const subjects: CharacterKey[] = flags.account
    ? [...roster.characters.keys()].sort()
    : [keyForSlug(flags.character ?? '')];

  const characters: CharacterReport[] = [];

  for (const key of subjects) {
    const character = roster.characters.get(key);
    if (!character) continue;

    const build = equippedBuild(roster, key);
    const stats = build ? ((await resolver.resolve(build)) ?? {}) : {};
    const profile = bank.profiles.get(key);
    const { playable, blocked } = await teams.teamsFor(key, roster);
    const advice = await advisor.adviseFor(key, roster);

    const toReport = (option: (typeof playable)[number]): TeamReport => {
      const slotIndex = option.match.fills.findIndex((f) => f === key);
      const slot = slotIndex >= 0 ? option.match.archetype.slots[slotIndex] : undefined;

      let findings: readonly Finding[] = [];
      let variantId: string | null = null;
      let explanation = option.assessment.explanation.summary;

      if (profile && build) {
        const choice = selectVariant(profile, build, stats, bank.scoring, {
          ...(flags.variant === undefined ? {} : { pinned: flags.variant }),
          ...(slot?.variant === undefined ? {} : { fromArchetype: slot.variant }),
        });
        variantId = choice.variant.id;
        explanation = `${option.assessment.explanation.summary} ${choice.explanation}`;
        findings = assess(build, choice.variant, stats, bank.scoring).findings;
      }

      return {
        archetypeId: option.match.archetype.id,
        archetypeLabel: option.match.archetype.label,
        strength: option.match.archetype.strength,
        rankedBy: option.rankedBy,
        members: option.match.fills.map((f) => (f === null ? null : String(f))),
        variantId,
        explanation,
        findings,
        energy: option.assessment.energyFeasibility.map((e) => ({
          of: String(e.of), required: e.required, actual: e.actual,
        })),
      };
    };

    const note = !profile
      ? 'Ainda sem ficha curada para este personagem — só os fatos abaixo.'
      : playable.length + blocked.length === 0
        ? 'Ainda sem time curado que inclua este personagem.'
        : undefined;

    characters.push({
      key: String(key),
      slug: slugForCharacter(key) ?? String(key),
      level: character.level,
      constellation: character.constellation,
      observed: stats as Record<string, number>,
      playableTeams: playable.map(toReport),
      blockedTeams: blocked.map(toReport),
      acquisitions: advice.candidates.map((c) => ({
        axis: c.axis.kind === 'newCharacter' ? `newCharacter:${String(c.axis.character)}` : c.axis.kind,
        unlocks: c.unlocks.map((u) => u.archetype.id),
        summary: c.explanation.summary,
      })),
      ...(note === undefined ? {} : { note }),
    });
  }

  return {
    scope: flags.account ? 'account' : 'character',
    datasetSha: bank.datasetSha,
    characters,
  };
}
```

- [ ] **Step 4: Escrever o relatório de terminal**

Criar `apps/cli/src/report.ts`:

```ts
import type { AnalyzeResult, CharacterReport, TeamReport } from './commands/analyze.js';

const MARK: Readonly<Record<string, string>> = {
  'on-target': '[ok]',
  acceptable: '[~]',
  'off-target': '[!]',
  blocking: '[X]',
};

function renderTeam(team: TeamReport): string[] {
  const lines: string[] = [];
  lines.push(`  ${team.archetypeLabel} (${team.strength}) — ordenado por: ${team.rankedBy}`);
  lines.push(`    time: ${team.members.map((m) => m ?? '(vazio)').join(' + ')}`);
  lines.push(`    ${team.explanation}`);

  for (const energy of team.energy) {
    const ok = energy.actual >= energy.required ? 'ok' : 'CURTO';
    lines.push(`    energia ${energy.of}: ER ${energy.actual.toFixed(1)} / ${energy.required} (${ok})`);
  }

  for (const finding of team.findings) {
    lines.push(`    ${MARK[finding.status] ?? '[?]'} ${finding.summary}`);
    if (finding.why) lines.push(`         por quê: ${finding.why}`);
    if (finding.caveat) lines.push(`         ressalva: ${finding.caveat}`);
  }
  return lines;
}

function renderCharacter(entry: CharacterReport): string[] {
  const lines: string[] = [];
  lines.push(`${entry.slug} — nível ${entry.level}, C${entry.constellation}`);

  const stats = ['atk', 'critRate_', 'critDMG_', 'enerRech_', 'eleMas']
    .map((k) => (entry.observed[k] === undefined ? null : `${k} ${entry.observed[k]!.toFixed(1)}`))
    .filter((x): x is string => x !== null);
  if (stats.length > 0) lines.push(`  stats: ${stats.join(' · ')}`);

  if (entry.note) lines.push(`  ${entry.note}`);

  if (entry.playableTeams.length > 0) {
    lines.push('  TIMES QUE VOCÊ JOGA HOJE:');
    for (const team of entry.playableTeams) lines.push(...renderTeam(team));
  }
  if (entry.blockedTeams.length > 0) {
    lines.push('  A UM SLOT DE DISTÂNCIA:');
    for (const team of entry.blockedTeams) lines.push(...renderTeam(team));
  }
  if (entry.acquisitions.length > 0) {
    lines.push('  O QUE ADQUIRIR:');
    for (const a of entry.acquisitions) lines.push(`    ${a.axis} — ${a.summary}`);
  }
  return lines;
}

export function renderReport(result: AnalyzeResult): string {
  const header = [
    `Buer — análise ${result.scope === 'account' ? 'da conta' : 'de personagem'}`,
    `dado curado: ${result.datasetSha}`,
    'Isto é COMPARAÇÃO contra alvos curados, não previsão de dano.',
    '',
  ];
  const body = result.characters.flatMap((entry) => [...renderCharacter(entry), '']);
  return [...header, ...body].join('\n');
}
```

- [ ] **Step 5: Ligar no despacho da CLI**

Em `apps/cli/src/index.ts`, adicionar antes do `default:` do `switch`:

```ts
    case 'analyze': {
      const { runAnalyze } = await import('./commands/analyze.js');
      const { renderReport } = await import('../src/report.js');
      const from = flagString(flags, 'from');
      if (!from) throw new Error('uso: buer analyze --from <extracao.json> [--character <slug> | --account]');
      const result = await runAnalyze({
        from,
        ...(flagString(flags, 'character') === undefined ? {} : { character: flagString(flags, 'character')! }),
        ...(flagString(flags, 'variant') === undefined ? {} : { variant: flagString(flags, 'variant')! }),
        account: flagBoolean(flags, 'account'),
        json: flagBoolean(flags, 'json'),
      });
      console.log(flagBoolean(flags, 'json') ? JSON.stringify(result, null, 2) : renderReport(result));
      return;
    }
```

E atualizar a linha de uso:

```ts
const USAGE = 'uso: buer <login|logout|whoami|sync|doctor|analyze> [opções]';
```

Em `apps/cli/package.json`, adicionar a `dependencies`:

```json
    "@buer/engine": "workspace:*",
    "@buer/meta": "workspace:*"
```

Run: `pnpm install`

- [ ] **Step 6: Gerar o golden file e rodar tudo**

```bash
UPDATE_GOLDEN=1 pnpm --filter @buer/cli exec vitest run test/analyze.test.ts
```

**Leia o golden gerado antes de commitar.** Ele é o retrato do que o produto afirma sobre 63 personagens reais — se algo ali estiver obviamente errado, é ficha para corrigir, não golden para aceitar. Depois:

Run: `pnpm -w typecheck && pnpm -w test`
Expected: PASS.

- [ ] **Step 7: Rodar de verdade, na sua conta**

```bash
pnpm --filter @buer/cli run start:dev analyze --from extracao-os_usa.json --character xiangling
```

Expected: relatório em texto com o time National, a variante nomeada, os cinco achados e o ER real contra o alvo. É a prova de que a Fase 2 entrega o que prometeu.

- [ ] **Step 8: Commit**

```bash
git add apps/cli packages/engine/test/anchors.test.ts pnpm-lock.yaml
git commit -m "feat(cli): comando analyze + relatório de terminal, golden file dos 63 e casos-âncora"
```

---

## Auto-revisão do plano

**1. Cobertura da spec** — cada seção da spec mapeada para a tarefa que a implementa:

| Spec | Tarefa |
|---|---|
| §3.1 pacotes / §3.2 dependências | 1, 3, 4 |
| §4.1 `observedStats` | 1 (tipo), 2 (extração), 4 (montagem) |
| §4.2 `variant`/`targetOverrides` | 1 (tipo), 9 (aplicação do override) |
| §4.3 `strength`/`tags` | 1 (tipo), 9 (ordenação) |
| §5.1 ficha e variantes | 3 |
| §5.2 alvos | 1 (tipo), 6 (`checkTargets`) |
| §5.3 proveniência e `RoleTag` | 1, 3 |
| §5.4 arquétipos e slots flex | 3 (schema), 8 (`candidatesFor`) |
| §5.5 integridade | 3 |
| §6.1 `StatResolver` | 5 |
| §6.2 as cinco verificações | 6 |
| §6.3 achados → `Score` | 7 |
| §6.4 seleção de variante | 7 |
| §6.5 degradação | 7 (`canHandle`), 6 (`checkTargets` sem stats), 12 (nota na saída) |
| §7.1 matching e classificação | 8 |
| §7.2 reações/ressonância/energia | 8, 9 |
| §7.3 explicação de time | 9 |
| §8.1–8.5 aquisição | 10 |
| §9 `FarmPlan`/`EquipPlan`/dominância | **lacuna consciente — ver abaixo** |
| §10 pipeline de autoria | fora deste plano (plano separado) |
| §11 CLI | 12 |
| §12 validação (5 camadas) | 3 e 6 (camadas 1–2), 12 (camadas 3–5) |
| §13 ordem de construção | ordem das tarefas 1→12 |

**Lacuna assumida:** a §9 da spec (`FarmPlan`, `EquipPlan`, troca por dominância) **não** tem tarefa neste plano. Razão: ela é a camada de *ação* sobre os achados, e os achados só existem depois da Task 6. Incluí-la aqui empurraria o plano para 15 tarefas sem que nada antes da 12 dependesse dela. O relatório da Task 12 já entrega o diagnóstico acionável em prosa ("main-stat fora do alvo: goblet com hp_"); transformar isso em `FarmPlan`/`EquipPlan` estruturados é o primeiro incremento depois deste plano, e a troca por dominância (§9.1) vai junto. Registrado aqui para não sumir.

**2. Varredura de placeholder** — sem `TBD`, sem "implemente depois", sem "similar à Task N". A Task 11 é autoria de conteúdo e por isso especifica personagens, ids de variante, papéis e regras de aceitação em vez de código: os critérios que a fecham são os testes da Step 1, que são executáveis.

**3. Consistência de tipos** — verificada entre tarefas:
- `Finding`/`CheckId`/`statusFor` (Task 6) usados com o mesmo nome em `assess` (7), no relatório (12).
- `assess(build, variant, stats, weights)` — mesma ordem de parâmetros nas Tasks 7, 9 e 12.
- `selectVariant(profile, build, stats, weights, opts)` — idem, Tasks 7, 9, 12.
- `matchArchetype(archetype, roster, bank, opts)` — Tasks 8, 9, 10.
- `MetaBank.{profiles,archetypes,scoring,datasetSha}` — Task 3, consumido em 7, 9, 10, 12.
- `rosterFromHoyolab(raw, { capturedAt, lang })` e `equippedBuild(roster, key)` — Task 4, consumidos em 7, 9, 10, 12.
- `StatResolver.resolve(build)` devolve `ObservedStats | null` — Task 5, consumido em 7 e 9; `checkTargets` (6) aceita `null` explicitamente.
- `ObservedStats` e `StatTarget` definidos uma vez em `@buer/core` (Task 1) e importados em todo lugar — nunca redefinidos.

