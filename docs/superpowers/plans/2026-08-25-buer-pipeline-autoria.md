# Pipeline de Autoria Assistida do `@buer/meta`: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma ferramenta offline que pesquisa fontes da comunidade, extrai o que cada uma afirma, **compara as três em código** e escreve fichas e arquétipos rascunhados para revisão humana — com a confiança derivada da concordância, não do palpite do modelo.

**Architecture:** Quatro estágios por alvo, e a fronteira entre eles é a decisão de projeto central. Dois estágios chamam a API da Anthropic (**pesquisa** com busca web restrita aos três domínios, depois **extração** com saída estruturada); os outros dois são **TypeScript puro** (**reconciliação**, que decide o que a ficha afirma e com que confiança, e **escrita**, que valida antes de gravar). A parte cara e não-determinística fica isolada; a parte que decide é determinística, unitariamente testável e roda sem chave de API.

**Tech Stack:** TypeScript 5.6 (ESM, `NodeNext`, `strict`), `@anthropic-ai/sdk` (modelo `claude-opus-5`, tool `web_search_20260209`, saída estruturada via `zodOutputFormat`), Zod 4, Vitest 2, Node 24.

**Spec:** `docs/superpowers/specs/2026-08-24-buer-fase-2-motor-design.md` — §10 (pipeline), §5 (schema da ficha), §12 (validação), §14.3 (o risco que este pipeline gerencia). Contexto de execução e a decisão de fontes: `docs/STATUS.md`.

## Global Constraints

- **`tsconfig.base.json` vale para todo código:** `strict: true`, `noUncheckedIndexedAccess: true`, `verbatimModuleSyntax: true`, `module`/`moduleResolution` = `NodeNext`. Todo import relativo termina em `.js`; todo import de tipo usa `import type`; todo acesso indexado devolve `T | undefined`.
- **ESM sem `__dirname`.** `__dirname` e `__filename` são `undefined` em módulo ES e lançam `ReferenceError`. Para caminho relativo ao script: `path.dirname(fileURLToPath(import.meta.url))`.
- **Idioma:** comentários, mensagens de erro e saída de terminal em **português**. Identificadores em inglês. **Prompts enviados à API em português** — as fontes são em inglês, mas a ficha e os `why` são lidos por um usuário brasileiro.
- **Modelo:** `claude-opus-5`. Não troque por outro sem instrução explícita.
- **Nada de dado inventado.** Se a pesquisa não achar o que uma fonte diz, o claim daquela fonte é **ausente**, nunca preenchido por inferência. Esta é a regra que justifica o pipeline existir; violá-la produz o defeito da §14.3 da spec em escala industrial.
- **Fontes, nesta ordem de preferência:** `icy-veins.com`, `game8.co`, `genshin-builds.com`. Toda URL consultada vai para `MetaProvenance.sources`.
- **Confiança derivada, nunca declarada pelo modelo:** `authoredBy` é sempre `'researched'` e `confidence` sai da reconciliação em código. `'high'` continua exigindo revisão humana — o pipeline nunca o produz.
- **A ferramenta é offline.** Vive em `packages/meta/scripts/`, nunca é importada por código de runtime, e o `@buer/engine` não pode depender dela.
- **Custa dinheiro e exige credencial.** Todo comando que chama a API estima e reporta o custo, e tem `--dry-run`.
- **Commits:** um por tarefa, mensagem em português, prefixo convencional.

## Decisões de projeto, e por quê

| # | Decisão | Alternativa rejeitada | Razão |
|---|---|---|---|
| D1 | **A comparação entre fontes é código, não prompt** | Pedir ao modelo "compare as três fontes e me diga a confiança" | A concordância é a única coisa que separa esta ficha de um chute. Se ela mora num prompt, não é testável, não é auditável e varia entre execuções. Em TypeScript puro, ela tem teste unitário e roda sem API. |
| D2 | Pesquisa e extração são **duas chamadas**, não uma | Uma chamada com `web_search` + `output_config.format` juntos | Não verifiquei que os dois compõem, e a spec inteira deste projeto proíbe construir sobre suposição. Separar também põe o tratamento de `pause_turn` num lugar só, e deixa o texto da pesquisa como artefato para o revisor humano ler. |
| D3 | Uma pesquisa cobre os **três domínios de uma vez** | Uma pesquisa por domínio | 2 chamadas por personagem em vez de 4; 240 chamadas para os 120 do catálogo. O prompt exige atribuição por fonte, e a extração devolve um claim por fonte. |
| D4 | Cliente injetado por parâmetro | `import` direto do SDK dentro das funções | Testes rodam com um dublê e **sem chave de API**. Nenhum teste desta suíte toca a rede. |
| D5 | Rascunho é escrito só se `validateMeta` passar | Escrever e deixar o teste de integridade pegar depois | Um rascunho inválido no diretório de dado quebra `loadMeta()` para todo mundo, inclusive os testes das outras tarefas. A borda rejeita. |

---

## Estrutura de arquivos

**`packages/meta/scripts/`** — ferramenta de build, nunca runtime

- `gaps.ts` *(criar)* — `meta:gaps`. Cruza o catálogo do `gi-data` com `data/`. Sem API.
- `research/claims.ts` *(criar)* — os tipos que atravessam o pipeline: `SourceClaim`, `CharacterClaims`, `Divergence`, `ReconcileResult`. Sem lógica.
- `research/reconcile.ts` *(criar)* — **puro**. Compara os claims das três fontes, decide o valor de cada campo, registra divergências, deriva a confiança. É o coração da tarefa.
- `research/client.ts` *(criar)* — construção do cliente Anthropic, constantes de modelo/effort/domínios, e o tratamento tipado de erro.
- `research/search.ts` *(criar)* — a chamada de pesquisa com `web_search_20260209`, incluindo o laço de `pause_turn`.
- `research/extract.ts` *(criar)* — a chamada de extração com `zodOutputFormat`, e os schemas Zod.
- `research/write.ts` *(criar)* — monta o `RawCharacterProfile`, valida com `validateMeta`, grava o JSON e o texto da pesquisa.
- `research-characters.ts` *(criar)* — entrada de CLI do lote de personagens.
- `research-archetypes.ts` *(criar)* — entrada de CLI do lote de arquétipos.

**`packages/meta/`**
- `package.json` *(modificar)* — dependências `@anthropic-ai/sdk` e `zod`; scripts `meta:gaps`, `meta:research:characters`, `meta:research:archetypes`.
- `data/research/<slug>.md` *(gerado)* — o texto bruto da pesquisa, ao lado da ficha, para o revisor humano.

**`packages/meta/test/`** — `gaps.test.ts`, `reconcile.test.ts`, `search.test.ts`, `extract.test.ts`, `write.test.ts`, `research-cli.test.ts`.

---

## Task 1: `meta:gaps` — o que falta curar

Sem API, imediatamente útil, e é o gatilho de patch novo que a §10 da spec pede: quando o `sync` do `gi-data` traz personagem novo, ele aparece aqui.

**Files:**
- Create: `packages/meta/scripts/gaps.ts`
- Modify: `packages/meta/package.json`
- Test: `packages/meta/test/gaps.test.ts`

**Interfaces:**
- Consumes: `loadCharacters` de `@buer/gi-data`; `readRawMeta`, `resolveCharacter` de `../src/index.js`.
- Produces: `computeGaps(deps: GapsDeps): GapsReport` e `formatGaps(report: GapsReport): string`, com
  ```ts
  interface GapsDeps { catalog: Record<string, { slug: string }>; raw: RawMeta; currentVersion: string }
  interface GapsReport {
    readonly withoutProfile: readonly string[];     // slugs do catálogo sem ficha
    readonly withoutArchetype: readonly string[];   // slugs COM ficha que nenhum arquétipo nomeia
    readonly stale: readonly { readonly slug: string; readonly validatedFor: string }[];
    readonly totals: { readonly catalog: number; readonly profiles: number; readonly archetypes: number };
  }
  ```

- [ ] **Step 1: Escrever o teste que falha**

Criar `packages/meta/test/gaps.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeGaps, formatGaps } from '../scripts/gaps.js';
import type { RawMeta } from '../src/types.js';

const catalog = {
  '1': { slug: 'xiangling' },
  '2': { slug: 'bennett' },
  '3': { slug: 'ayaka' },
};

const raw: RawMeta = {
  profiles: [
    {
      schemaVersion: 1, character: 'xiangling', variants: [],
      provenance: { authoredBy: 'human', sources: [], authoredAt: '2026-08-24', validatedForVersion: '7.0', confidence: 'medium' },
    },
    {
      schemaVersion: 1, character: 'bennett', variants: [],
      provenance: { authoredBy: 'human', sources: [], authoredAt: '2026-01-01', validatedForVersion: '6.2', confidence: 'medium' },
    },
  ],
  archetypes: [
    {
      schemaVersion: 1, id: 'national', label: 'National', gameVersionAdded: '1.0',
      strength: 'meta', tags: [], sources: [],
      slots: [{ role: ['sub-dps'], requires: { kind: 'character', anyOf: ['xiangling'] }, substitutable: false }],
    },
  ],
};

describe('computeGaps', () => {
  it('lista personagem do catálogo que não tem ficha', () => {
    const r = computeGaps({ catalog, raw, currentVersion: '7.0' });
    expect(r.withoutProfile).toEqual(['ayaka']);
  });

  it('lista personagem COM ficha que nenhum arquétipo nomeia', () => {
    const r = computeGaps({ catalog, raw, currentVersion: '7.0' });
    expect(r.withoutArchetype).toEqual(['bennett']);
  });

  it('lista ficha cujo patch de validade ficou para trás', () => {
    const r = computeGaps({ catalog, raw, currentVersion: '7.0' });
    expect(r.stale).toEqual([{ slug: 'bennett', validatedFor: '6.2' }]);
  });

  it('conta os totais', () => {
    const r = computeGaps({ catalog, raw, currentVersion: '7.0' });
    expect(r.totals).toEqual({ catalog: 3, profiles: 2, archetypes: 1 });
  });

  it('catálogo inteiro coberto devolve listas vazias', () => {
    const full = { ...raw, profiles: [...raw.profiles, { ...raw.profiles[0]!, character: 'ayaka' }] };
    const r = computeGaps({ catalog, raw: full, currentVersion: '7.0' });
    expect(r.withoutProfile).toEqual([]);
  });

  it('formatGaps produz texto em português que nomeia os faltantes', () => {
    const text = formatGaps(computeGaps({ catalog, raw, currentVersion: '7.0' }));
    expect(text).toContain('ayaka');
    expect(text).toMatch(/sem ficha/i);
    expect(text).toContain('bennett');
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `pnpm --filter @buer/meta exec vitest run test/gaps.test.ts`
Expected: FAIL — `Failed to resolve import "../scripts/gaps.js"`.

- [ ] **Step 3: Escrever o cálculo**

Criar `packages/meta/scripts/gaps.ts`:

```ts
// packages/meta/scripts/gaps.ts
//
// `meta:gaps` — o que ainda falta curar. Sem chamada de API.
//
// É também o gatilho de patch novo que a §10 da spec pede: quando
// `pnpm --filter @buer/gi-data sync` traz personagens de um patch novo, eles
// aparecem em `withoutProfile` na primeira execução seguinte.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadCharacters } from '@buer/gi-data';
import type { RawMeta } from '../src/types.js';
import { readRawMeta } from '../src/load.js';

export interface GapsDeps {
  readonly catalog: Record<string, { slug: string }>;
  readonly raw: RawMeta;
  /** Patch corrente do jogo, para detectar ficha atrasada. */
  readonly currentVersion: string;
}

export interface GapsReport {
  readonly withoutProfile: readonly string[];
  readonly withoutArchetype: readonly string[];
  readonly stale: readonly { readonly slug: string; readonly validatedFor: string }[];
  readonly totals: { readonly catalog: number; readonly profiles: number; readonly archetypes: number };
}

/** '7.0' -> 70 ; '6.12' -> 612. Compara patch sem depender de string. */
function versionRank(v: string): number {
  const [major, minor] = v.split('.');
  return Number(major ?? 0) * 100 + Number(minor ?? 0);
}

export function computeGaps(deps: GapsDeps): GapsReport {
  const { catalog, raw, currentVersion } = deps;

  const profiled = new Set(raw.profiles.map((p) => p.character));

  const withoutProfile = Object.values(catalog)
    .map((e) => e.slug)
    .filter((slug) => !profiled.has(slug))
    .sort();

  // Um personagem "aparece" num arquétipo quando algum slot o nomeia. Slot de
  // elemento não conta: ele casa por papel em runtime, não por nome, então não
  // é evidência de que ESTE personagem tem lugar em algum time.
  const named = new Set<string>();
  for (const archetype of raw.archetypes) {
    for (const slot of archetype.slots) {
      if (slot.requires.kind === 'character') for (const s of slot.requires.anyOf) named.add(s);
    }
  }

  const withoutArchetype = [...profiled].filter((slug) => !named.has(slug)).sort();

  const current = versionRank(currentVersion);
  const stale = raw.profiles
    .filter((p) => versionRank(p.provenance.validatedForVersion) < current)
    .map((p) => ({ slug: p.character, validatedFor: p.provenance.validatedForVersion }))
    .sort((a, b) => a.slug.localeCompare(b.slug));

  return {
    withoutProfile,
    withoutArchetype,
    stale,
    totals: { catalog: Object.keys(catalog).length, profiles: raw.profiles.length, archetypes: raw.archetypes.length },
  };
}

export function formatGaps(report: GapsReport): string {
  const { totals } = report;
  const lines = [
    'Buer — lacunas do banco curado',
    `catálogo: ${totals.catalog} personagens · fichas: ${totals.profiles} · arquétipos: ${totals.archetypes}`,
    '',
  ];

  const section = (titulo: string, itens: readonly string[]): void => {
    lines.push(`${titulo} (${itens.length})`);
    lines.push(itens.length === 0 ? '  nenhum' : `  ${itens.join(', ')}`);
    lines.push('');
  };

  section('SEM FICHA — o pipeline de pesquisa começa por aqui', report.withoutProfile);
  section('COM FICHA, MAS EM NENHUM ARQUÉTIPO — não recebem time', report.withoutArchetype);
  section(
    'FICHA ATRASADA — validada para um patch anterior',
    report.stale.map((s) => `${s.slug} (${s.validatedFor})`),
  );

  return lines.join('\n');
}

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Patch corrente, lido de `data/game-version.json`. */
function currentGameVersion(): string {
  const file = path.join(HERE, '..', 'data', 'game-version.json');
  return (JSON.parse(readFileSync(file, 'utf8')) as { version: string }).version;
}

if (import.meta.main) {
  console.log(
    formatGaps(
      computeGaps({
        catalog: loadCharacters() as unknown as Record<string, { slug: string }>,
        raw: readRawMeta(),
        currentVersion: currentGameVersion(),
      }),
    ),
  );
}
```

- [ ] **Step 4: Criar o arquivo de patch corrente**

O `computeGaps` precisa saber qual é o patch atual, e cravar isso em código faria a detecção de ficha atrasada apodrecer em silêncio. Criar `packages/meta/data/game-version.json`:

```json
{
  "version": "7.0",
  "note": "Patch corrente do jogo. Atualize ao rodar o sync do gi-data com dado de um patch novo — é o que faz `meta:gaps` detectar ficha atrasada."
}
```

- [ ] **Step 5: Declarar o script**

Em `packages/meta/package.json`, dentro de `scripts`:

```json
    "meta:gaps": "node scripts/gaps.ts"
```

Node 24 remove sintaxe TypeScript nativamente — sem passo de build, igual ao `sync` do `gi-data`.

- [ ] **Step 6: Rodar os testes e o comando de verdade**

Run: `pnpm --filter @buer/meta exec vitest run test/gaps.test.ts`
Expected: PASS (6 testes).

Run: `pnpm --filter @buer/meta run meta:gaps`
Expected: relatório listando os 110 personagens do catálogo sem ficha. **Leia a saída** — ela é o backlog que as tarefas seguintes vão atacar.

- [ ] **Step 7: Commit**

```bash
git add packages/meta/scripts/gaps.ts packages/meta/data/game-version.json packages/meta/package.json packages/meta/test/gaps.test.ts
git commit -m "feat(meta): meta:gaps — o que falta curar, e o gatilho de patch novo"
```

---

## Task 2: Reconciliação entre fontes — o coração, e é puro

Nenhuma chamada de API. É esta função que decide o que a ficha afirma e com que confiança, e é por ela ser código que a decisão fica testável e auditável.

**Files:**
- Create: `packages/meta/scripts/research/claims.ts`, `packages/meta/scripts/research/reconcile.ts`
- Test: `packages/meta/test/reconcile.test.ts`

**Interfaces:**
- Consumes: `StatKey`, `RoleTag` de `@buer/core`.
- Produces:
  ```ts
  type SourceId = 'icy-veins' | 'game8' | 'genshin-builds';

  interface SourceClaim {
    readonly source: SourceId;
    readonly url: string;
    /** Ausente quando a fonte não cobre o campo. NUNCA inferido. */
    readonly sets?: readonly string[];        // slugs de conjunto, melhor primeiro
    readonly mainStats?: { readonly sands?: readonly string[]; readonly goblet?: readonly string[]; readonly circlet?: readonly string[] };
    readonly substats?: readonly string[];
    readonly weapons?: readonly string[];     // slugs de arma, melhor primeiro
    readonly erThreshold?: number;
    readonly roles?: readonly string[];
    readonly scalesOn?: string;
  }

  interface CharacterClaims { readonly character: string; readonly claims: readonly SourceClaim[] }

  interface Divergence {
    readonly field: string;                   // 'sets' | 'mainStats.sands' | 'erThreshold' | …
    readonly kind: 'alternatives' | 'conflict';
    readonly bySource: Readonly<Record<string, string>>;  // fonte -> o que ela diz
  }

  interface ReconcileResult {
    readonly agreed: {
      readonly sets?: readonly string[];
      readonly mainStats?: { sands?: readonly string[]; goblet?: readonly string[]; circlet?: readonly string[] };
      readonly substats?: readonly string[];
      readonly weapons?: readonly string[];
      readonly erThreshold?: number;
      readonly roles?: readonly string[];
      readonly scalesOn?: string;
    };
    readonly divergences: readonly Divergence[];
    readonly confidence: 'medium' | 'low';
    readonly sources: readonly string[];      // URLs de toda fonte consultada
  }

  function reconcileCharacter(claims: CharacterClaims): ReconcileResult;
  ```

- [ ] **Step 1: Escrever o teste que falha**

Criar `packages/meta/test/reconcile.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { reconcileCharacter } from '../scripts/research/reconcile.js';
import type { CharacterClaims, SourceClaim } from '../scripts/research/claims.js';

const claim = (over: Partial<SourceClaim> & Pick<SourceClaim, 'source' | 'url'>): SourceClaim =>
  ({ ...over }) as SourceClaim;

const three = (a: Partial<SourceClaim>, b: Partial<SourceClaim>, c: Partial<SourceClaim>): CharacterClaims => ({
  character: 'xiangling',
  claims: [
    claim({ source: 'icy-veins', url: 'https://icy-veins.com/x', ...a }),
    claim({ source: 'game8', url: 'https://game8.co/x', ...b }),
    claim({ source: 'genshin-builds', url: 'https://genshin-builds.com/x', ...c }),
  ],
});

describe('reconcileCharacter — campos de LISTA: união e ranking, nunca descarte', () => {
  it('três fontes com a mesma lista produz a lista, sem divergência', () => {
    const r = reconcileCharacter(three(
      { sets: ['emblem-of-severed-fate'] },
      { sets: ['emblem-of-severed-fate'] },
      { sets: ['emblem-of-severed-fate'] },
    ));
    expect(r.agreed.sets).toEqual(['emblem-of-severed-fate']);
    expect(r.divergences).toEqual([]);
    expect(r.confidence).toBe('medium');
  });

  it('fontes com conjuntos DIFERENTES guardam os dois, o mais citado primeiro', () => {
    const r = reconcileCharacter(three(
      { sets: ['emblem-of-severed-fate'] },
      { sets: ['emblem-of-severed-fate'] },
      { sets: ['crimson-witch-of-flames'] },
    ));
    // nada é descartado: a ficha suporta alternativa ranqueada, e a segunda
    // opção vira rank 2 em vez de sumir
    expect(r.agreed.sets).toEqual(['emblem-of-severed-fate', 'crimson-witch-of-flames']);
  });

  it('divergência de lista é `alternatives` e NÃO derruba a confiança', () => {
    const r = reconcileCharacter(three(
      { sets: ['a-set'] }, { sets: ['a-set'] }, { sets: ['b-set'] },
    ));
    const d = r.divergences.find((x) => x.field === 'sets')!;
    expect(d.kind).toBe('alternatives');
    expect(r.confidence).toBe('medium');
  });

  it('três listas totalmente diferentes viram três opções ranqueadas', () => {
    const r = reconcileCharacter(three(
      { sets: ['a-set'] }, { sets: ['b-set'] }, { sets: ['c-set'] },
    ));
    expect(r.agreed.sets).toHaveLength(3);
    // sem consenso em nenhum item, a ordem é determinística (alfabética)
    expect(r.agreed.sets).toEqual(['a-set', 'b-set', 'c-set']);
  });

  it('item citado por mais fontes vence item citado em posição melhor por uma só', () => {
    const r = reconcileCharacter(three(
      { weapons: ['engulfing-lightning', 'the-catch'] },
      { weapons: ['the-catch'] },
      { weapons: ['the-catch'] },
    ));
    expect(r.agreed.weapons![0]).toBe('the-catch');
  });

  it('empate de apoio é desempatado pela posição média nas fontes', () => {
    const r = reconcileCharacter(three(
      { weapons: ['the-catch', 'dragon-s-bane'] },
      { weapons: ['the-catch', 'dragon-s-bane'] },
      {},
    ));
    expect(r.agreed.weapons).toEqual(['the-catch', 'dragon-s-bane']);
    expect(r.divergences).toEqual([]);
  });

  it('main-stats reconciliam por slot, cada um com união e ranking', () => {
    const r = reconcileCharacter(three(
      { mainStats: { sands: ['enerRech_'], goblet: ['pyro_dmg_'] } },
      { mainStats: { sands: ['enerRech_'], goblet: ['pyro_dmg_'] } },
      { mainStats: { sands: ['atk_'], goblet: ['pyro_dmg_'] } },
    ));
    expect(r.agreed.mainStats?.sands).toEqual(['enerRech_', 'atk_']);
    expect(r.agreed.mainStats?.goblet).toEqual(['pyro_dmg_']);
    expect(r.divergences.map((d) => d.field)).toEqual(['mainStats.sands']);
  });
});

describe('reconcileCharacter — campos de VALOR ÚNICO: aqui divergir é contradição', () => {
  it('maioria simples decide o limiar de ER', () => {
    const r = reconcileCharacter(three(
      { erThreshold: 200 }, { erThreshold: 200 }, { erThreshold: 160 },
    ));
    expect(r.agreed.erThreshold).toBe(200);
  });

  it('contradição em campo escalar é `conflict` e DERRUBA a confiança', () => {
    const r = reconcileCharacter(three(
      { erThreshold: 200 }, { erThreshold: 200 }, { erThreshold: 160 },
    ));
    const d = r.divergences.find((x) => x.field === 'erThreshold')!;
    expect(d.kind).toBe('conflict');
    expect(r.confidence).toBe('low');
  });

  it('sem maioria, o campo escalar fica AUSENTE — não escolhemos por desempate', () => {
    const r = reconcileCharacter(three(
      { scalesOn: 'atk' }, { scalesOn: 'hp' }, { scalesOn: 'def' },
    ));
    expect(r.agreed.scalesOn).toBeUndefined();
    expect(r.confidence).toBe('low');
  });

  it('fonte que não cobre o campo não vota nem diverge', () => {
    const r = reconcileCharacter(three({ erThreshold: 200 }, { erThreshold: 200 }, {}));
    expect(r.agreed.erThreshold).toBe(200);
    expect(r.divergences).toEqual([]);
    expect(r.confidence).toBe('medium');
  });
});

describe('reconcileCharacter — confiança e proveniência', () => {
  it('nada corroborado por 2+ fontes derruba para low, mesmo sem contradição', () => {
    const r = reconcileCharacter(three({ erThreshold: 200 }, {}, {}));
    expect(r.agreed.erThreshold).toBe(200);
    expect(r.confidence).toBe('low');
  });

  it('nenhuma fonte cobrindo nada devolve agreed vazio e low', () => {
    const r = reconcileCharacter(three({}, {}, {}));
    expect(r.agreed).toEqual({});
    expect(r.confidence).toBe('low');
  });

  it('sources traz a URL de TODA fonte consultada, mesmo a que não cobriu nada', () => {
    const r = reconcileCharacter(three({ sets: ['x'] }, {}, {}));
    expect(r.sources).toEqual([
      'https://icy-veins.com/x',
      'https://game8.co/x',
      'https://genshin-builds.com/x',
    ]);
  });

  it('nunca produz confidence high — isso exige humano', () => {
    const r = reconcileCharacter(three(
      { sets: ['x'], erThreshold: 200, substats: ['critRate_'] },
      { sets: ['x'], erThreshold: 200, substats: ['critRate_'] },
      { sets: ['x'], erThreshold: 200, substats: ['critRate_'] },
    ));
    expect(r.confidence).not.toBe('high');
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `pnpm --filter @buer/meta exec vitest run test/reconcile.test.ts`
Expected: FAIL — `Failed to resolve import "../scripts/research/reconcile.js"`.

- [ ] **Step 3: Escrever os tipos**

Criar `packages/meta/scripts/research/claims.ts`:

```ts
// packages/meta/scripts/research/claims.ts
//
// Os tipos que atravessam o pipeline. Sem lógica — existe para que a
// reconciliação (pura) e a extração (que chama a API) concordem sobre a forma
// do dado sem uma depender da outra.

/** As três fontes, na ordem de preferência decidida em docs/STATUS.md. */
export const SOURCE_IDS = ['icy-veins', 'game8', 'genshin-builds'] as const;
export type SourceId = (typeof SOURCE_IDS)[number];

/**
 * O que UMA fonte afirma sobre UM personagem.
 *
 * Todo campo é opcional, e ausência significa "esta fonte não cobre isto" —
 * nunca "o valor é vazio". A distinção é a regra central do pipeline: um campo
 * ausente não vira divergência nem palpite.
 */
export interface SourceClaim {
  readonly source: SourceId;
  readonly url: string;
  readonly sets?: readonly string[];
  readonly mainStats?: {
    readonly sands?: readonly string[];
    readonly goblet?: readonly string[];
    readonly circlet?: readonly string[];
  };
  readonly substats?: readonly string[];
  readonly weapons?: readonly string[];
  readonly erThreshold?: number;
  /**
   * A razão que ESTA fonte dá para o limiar de ER, nas palavras dela.
   *
   * NÃO entra na votação da reconciliação: razões em prosa nunca vão bater
   * literalmente entre três sites, e votar em texto produziria "empate" em
   * todo personagem. Quem escolhe é a escrita da ficha (Task 5), pegando a da
   * fonte de maior preferência que tiver uma — assim o `why` fica sempre
   * atribuível a uma URL de `sources`, em vez de ser gerado por template.
   */
  readonly erWhy?: string;
  readonly roles?: readonly string[];
  readonly scalesOn?: string;
}

export interface CharacterClaims {
  readonly character: string;
  readonly claims: readonly SourceClaim[];
}

/**
 * Um campo em que as fontes não falaram a mesma coisa. Vai para `notes`.
 *
 * A distinção entre os dois tipos é a correção que este pipeline faz sobre a
 * intuição óbvia:
 *
 * - `alternatives` — campo de LISTA ORDENADA (conjuntos, armas, substats,
 *   main-stats). Fontes divergirem aqui NÃO é contradição: é o catálogo de
 *   opções ficando maior. A ficha guarda todas, ranqueadas por quantas fontes
 *   citaram cada uma e em que posição. Não derruba a confiança.
 * - `conflict` — campo de valor ÚNICO (limiar de ER, o atributo que escala).
 *   Aqui divergir é contradição: um personagem não tem dois limiares de ER.
 *   Derruba a confiança.
 *
 * Tratar os dois do mesmo jeito descartaria opção boa por "maioria" — e é
 * exatamente o que a ficha, com seus `rank`, foi desenhada para não fazer.
 */
export interface Divergence {
  readonly field: string;
  readonly kind: 'alternatives' | 'conflict';
  readonly bySource: Readonly<Record<string, string>>;
}

export interface AgreedFields {
  readonly sets?: readonly string[];
  readonly mainStats?: {
    readonly sands?: readonly string[];
    readonly goblet?: readonly string[];
    readonly circlet?: readonly string[];
  };
  readonly substats?: readonly string[];
  readonly weapons?: readonly string[];
  readonly erThreshold?: number;
  readonly roles?: readonly string[];
  readonly scalesOn?: string;
}

export interface ReconcileResult {
  readonly agreed: AgreedFields;
  readonly divergences: readonly Divergence[];
  /** Derivada da concordância. NUNCA 'high' — isso exige revisão humana. */
  readonly confidence: 'medium' | 'low';
  readonly sources: readonly string[];
}
```

- [ ] **Step 4: Escrever a reconciliação**

Criar `packages/meta/scripts/research/reconcile.ts`:

```ts
// packages/meta/scripts/research/reconcile.ts
//
// Compara o que as três fontes afirmam e decide o que a ficha vai dizer.
//
// É PURO de propósito, e essa é a decisão de projeto central do pipeline: a
// concordância entre fontes é a única coisa que separa esta ficha de um chute,
// então precisa ser testável sem chave de API, determinística entre execuções e
// auditável linha a linha. Se morasse num prompt, não seria nenhuma das três.
//
// A segunda decisão, igualmente central: CAMPO DE LISTA E CAMPO ESCALAR
// RECONCILIAM DE FORMAS DIFERENTES. Duas fontes recomendando conjuntos
// distintos não estão se contradizendo — estão oferecendo alternativas, e a
// ficha tem `rank` justamente para guardar as duas. Já duas fontes dando
// limiares de ER diferentes se contradizem de verdade: um personagem não tem
// dois. Tratar os dois casos igual descartaria opção boa por "maioria".

import type {
  AgreedFields, CharacterClaims, Divergence, ReconcileResult, SourceClaim,
} from './claims.js';

/** Listas ORDENADAS por qualidade: divergir aqui é ganhar opção, não perder. */
const RANKED_FIELDS = ['sets', 'weapons', 'substats'] as const;
/** Lista NÃO ordenada: união simples, sem ranking. */
const SET_FIELDS = ['roles'] as const;
/** Valor único: divergir aqui é contradição. */
const SCALAR_FIELDS = ['erThreshold', 'scalesOn'] as const;
const MAIN_STAT_SLOTS = ['sands', 'goblet', 'circlet'] as const;

interface Vote {
  readonly source: string;
  readonly value: unknown;
}

function votesFor(claims: readonly SourceClaim[], pick: (c: SourceClaim) => unknown): Vote[] {
  const out: Vote[] = [];
  for (const claim of claims) {
    const value = pick(claim);
    if (value === undefined) continue;
    out.push({ source: claim.source, value });
  }
  return out;
}

function bySourceOf(votes: readonly Vote[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const vote of votes) out[vote.source] = JSON.stringify(vote.value);
  return out;
}

interface Outcome {
  readonly value: unknown | undefined;
  readonly divergence: Divergence | undefined;
  /** Houve item/valor sustentado por 2+ fontes? Alimenta a confiança. */
  readonly corroborated: boolean;
}

/**
 * Campo de LISTA ORDENADA: une o que todas as fontes disseram e ranqueia.
 *
 * Ordem: mais fontes citando primeiro; empate desfeito pela posição média em
 * que as fontes colocaram o item; empate persistente pela ordem alfabética,
 * para a saída ser determinística entre execuções.
 *
 * Nada é descartado. Um conjunto citado por uma fonte só entra em último lugar
 * e recebe crédito parcial na avaliação — bem melhor que sumir.
 */
function mergeRanked(field: string, votes: readonly Vote[]): Outcome {
  if (votes.length === 0) return { value: undefined, divergence: undefined, corroborated: false };

  const stats = new Map<string, { sources: Set<string>; positions: number[] }>();
  for (const vote of votes) {
    const list = vote.value as readonly string[];
    list.forEach((item, index) => {
      const entry = stats.get(item) ?? { sources: new Set<string>(), positions: [] };
      entry.sources.add(vote.source);
      entry.positions.push(index);
      stats.set(item, entry);
    });
  }

  const ranked = [...stats.entries()]
    .map(([item, s]) => ({
      item,
      support: s.sources.size,
      avgPosition: s.positions.reduce((a, b) => a + b, 0) / s.positions.length,
    }))
    .sort((a, b) => b.support - a.support || a.avgPosition - b.avgPosition || a.item.localeCompare(b.item))
    .map((r) => r.item);

  const first = JSON.stringify(votes[0]!.value);
  const identical = votes.every((v) => JSON.stringify(v.value) === first);

  return {
    value: ranked,
    divergence: identical ? undefined : { field, kind: 'alternatives', bySource: bySourceOf(votes) },
    corroborated: [...stats.values()].some((s) => s.sources.size >= 2),
  };
}

/** Lista não ordenada (papéis): união, ordenada só para ser determinística. */
function mergeSet(field: string, votes: readonly Vote[]): Outcome {
  if (votes.length === 0) return { value: undefined, divergence: undefined, corroborated: false };

  const counts = new Map<string, number>();
  for (const vote of votes) {
    for (const item of vote.value as readonly string[]) counts.set(item, (counts.get(item) ?? 0) + 1);
  }

  const first = JSON.stringify(votes[0]!.value);
  const identical = votes.every((v) => JSON.stringify(v.value) === first);

  return {
    value: [...counts.keys()].sort(),
    divergence: identical ? undefined : { field, kind: 'alternatives', bySource: bySourceOf(votes) },
    corroborated: [...counts.values()].some((n) => n >= 2),
  };
}

/**
 * Campo de VALOR ÚNICO: maioria simples decide, e discordar é contradição.
 *
 * Sem maioria (todas as fontes dizendo coisas diferentes), o campo fica
 * AUSENTE. Não desempatamos por preferência de fonte: um número que ninguém
 * confirma é melhor vazio do que escolhido a dedo.
 */
function decideScalar(field: string, votes: readonly Vote[]): Outcome {
  if (votes.length === 0) return { value: undefined, divergence: undefined, corroborated: false };

  const byKey = new Map<string, { value: unknown; sources: string[] }>();
  for (const vote of votes) {
    const key = JSON.stringify(vote.value);
    const entry = byKey.get(key) ?? { value: vote.value, sources: [] };
    entry.sources.push(vote.source);
    byKey.set(key, entry);
  }

  if (byKey.size === 1) {
    const only = [...byKey.values()][0]!;
    return { value: only.value, divergence: undefined, corroborated: only.sources.length >= 2 };
  }

  const ranked = [...byKey.values()].sort((a, b) => b.sources.length - a.sources.length);
  const top = ranked[0]!;
  const runnerUp = ranked[1]!;
  const divergence: Divergence = { field, kind: 'conflict', bySource: bySourceOf(votes) };

  if (top.sources.length === runnerUp.sources.length) {
    return { value: undefined, divergence, corroborated: false };
  }
  return { value: top.value, divergence, corroborated: top.sources.length >= 2 };
}

export function reconcileCharacter(claims: CharacterClaims): ReconcileResult {
  const agreed: Record<string, unknown> = {};
  const divergences: Divergence[] = [];
  let corroborated = false;

  const absorb = (outcome: Outcome, key: string, into: Record<string, unknown>): void => {
    if (outcome.value !== undefined) into[key] = outcome.value;
    if (outcome.divergence) divergences.push(outcome.divergence);
    if (outcome.corroborated) corroborated = true;
  };

  for (const field of RANKED_FIELDS) {
    absorb(mergeRanked(field, votesFor(claims.claims, (c) => c[field])), field, agreed);
  }
  for (const field of SET_FIELDS) {
    absorb(mergeSet(field, votesFor(claims.claims, (c) => c[field])), field, agreed);
  }
  for (const field of SCALAR_FIELDS) {
    absorb(decideScalar(field, votesFor(claims.claims, (c) => c[field])), field, agreed);
  }

  // Main-stats reconciliam POR SLOT: uma fonte pode acertar a ampulheta e
  // divergir no cálice, e tratar o bloco como um valor só descartaria a parte
  // em que todas concordam.
  const mainStats: Record<string, unknown> = {};
  for (const slot of MAIN_STAT_SLOTS) {
    absorb(
      mergeRanked(`mainStats.${slot}`, votesFor(claims.claims, (c) => c.mainStats?.[slot])),
      slot,
      mainStats,
    );
  }
  if (Object.keys(mainStats).length > 0) agreed['mainStats'] = mainStats;

  // Só CONTRADIÇÃO derruba a confiança — alternativa não. E sem nada
  // corroborado por duas fontes, a ficha é single-sourced, o que também é
  // `low`: uma afirmação não confirmada não é concordância.
  const hasConflict = divergences.some((d) => d.kind === 'conflict');

  return {
    agreed: agreed as AgreedFields,
    divergences,
    confidence: !hasConflict && corroborated ? 'medium' : 'low',
    sources: claims.claims.map((c) => c.url),
  };
}
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @buer/meta exec vitest run test/reconcile.test.ts`
Expected: PASS (15 testes).

- [ ] **Step 6: Commit**

```bash
git add packages/meta/scripts/research/claims.ts packages/meta/scripts/research/reconcile.ts packages/meta/test/reconcile.test.ts
git commit -m "feat(meta): reconciliação entre fontes — pura, testável, sem chave de API"
```

---

## Task 3: Cliente Anthropic e a chamada de pesquisa

A primeira das duas chamadas de API. Busca web restrita aos três domínios, com o laço de `pause_turn` que a busca web pode disparar. O cliente é **injetado**, então os testes rodam com um dublê e sem chave.

**Files:**
- Create: `packages/meta/scripts/research/client.ts`, `packages/meta/scripts/research/search.ts`
- Modify: `packages/meta/package.json`
- Test: `packages/meta/test/search.test.ts`

**Interfaces:**
- Consumes: `SOURCE_IDS` de `./claims.js`.
- Produces:
  - `MODEL`, `SOURCE_DOMAINS`, `createClient()`, `describeApiError(e: unknown): string`
  - `interface SearchClient { stream(params: Anthropic.MessageStreamParams): { finalMessage(): Promise<Anthropic.Message> } }`
  - `researchCharacter(slug: string, deps: SearchDeps): Promise<ResearchOutput>` com
    `SearchDeps = { client: SearchClient; model?: string; maxUses?: number; maxResumes?: number }`
    e `ResearchOutput = { text: string; urls: readonly string[]; usage: { inputTokens: number; outputTokens: number } }`
  - `buildCharacterPrompt(slug: string): string`

- [ ] **Step 1: Instalar o SDK**

```bash
pnpm --filter @buer/meta add @anthropic-ai/sdk zod
pnpm install
```

`zod` já está no repositório em `^4.4.3` (`packages/core/package.json`) — instale a mesma faixa para não abrir duas versões no workspace.

- [ ] **Step 2: Escrever o teste que falha**

Criar `packages/meta/test/search.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { researchCharacter, buildCharacterPrompt } from '../scripts/research/search.js';

/** Dublê: devolve as mensagens que o teste programou, uma por chamada. */
function fakeClient(messages: unknown[]) {
  const calls: unknown[] = [];
  let i = 0;
  return {
    calls,
    client: {
      stream(params: unknown) {
        calls.push(params);
        const message = messages[i++];
        return { finalMessage: async () => message as never };
      },
    },
  };
}

const textMessage = (text: string, stop = 'end_turn') => ({
  stop_reason: stop,
  content: [{ type: 'text', text }],
  usage: { input_tokens: 100, output_tokens: 200 },
});

describe('buildCharacterPrompt', () => {
  it('nomeia o personagem e exige atribuição por fonte', () => {
    const p = buildCharacterPrompt('xiangling');
    expect(p).toContain('xiangling');
    expect(p).toMatch(/icy-veins/);
    expect(p).toMatch(/game8/);
    expect(p).toMatch(/genshin-builds/);
    expect(p).toMatch(/separadamente|por fonte|cada fonte/i);
  });

  it('proíbe explicitamente inventar dado ausente', () => {
    expect(buildCharacterPrompt('xiangling')).toMatch(/não invente|não preencha|omita/i);
  });
});

describe('researchCharacter', () => {
  it('declara a ferramenta de busca restrita aos três domínios', async () => {
    const { client, calls } = fakeClient([textMessage('resultado')]);
    await researchCharacter('xiangling', { client });

    const params = calls[0] as { tools: { type: string; allowed_domains: string[] }[]; model: string };
    expect(params.model).toBe('claude-opus-5');
    const tool = params.tools.find((t) => t.type === 'web_search_20260209')!;
    expect(tool).toBeDefined();
    expect(tool.allowed_domains).toEqual(['icy-veins.com', 'game8.co', 'genshin-builds.com']);
  });

  it('retoma quando a resposta pausa, e só devolve quando termina', async () => {
    const { client, calls } = fakeClient([
      { ...textMessage('parcial', 'pause_turn') },
      textMessage('completo'),
    ]);
    const out = await researchCharacter('xiangling', { client });

    expect(calls).toHaveLength(2);
    expect(out.text).toContain('completo');
    // a retomada reenvia o turno pausado como mensagem do assistente
    const second = calls[1] as { messages: { role: string }[] };
    expect(second.messages.at(-1)!.role).toBe('assistant');
  });

  it('para de retomar depois do limite, em vez de girar para sempre', async () => {
    const paused = { ...textMessage('parcial', 'pause_turn') };
    const { client, calls } = fakeClient([paused, paused, paused, paused, paused]);
    await researchCharacter('xiangling', { client, maxResumes: 2 });
    expect(calls.length).toBeLessThanOrEqual(3);
  });

  it('colhe as URLs dos resultados de busca', async () => {
    const { client } = fakeClient([
      {
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
        content: [
          {
            type: 'web_search_tool_result',
            content: [
              { type: 'web_search_result', url: 'https://icy-veins.com/a' },
              { type: 'web_search_result', url: 'https://game8.co/b' },
            ],
          },
          { type: 'text', text: 'ok' },
        ],
      },
    ]);
    const out = await researchCharacter('xiangling', { client });
    expect(out.urls).toEqual(['https://icy-veins.com/a', 'https://game8.co/b']);
  });

  it('erro da ferramenta de busca não derruba a execução nem vira URL', async () => {
    // Server tool devolve HTTP 200 com um bloco de erro: `content` vira OBJETO,
    // não lista. Indexar sem checar quebraria aqui.
    const { client } = fakeClient([
      {
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
        content: [
          { type: 'web_search_tool_result', content: { error_code: 'max_uses_exceeded' } },
          { type: 'text', text: 'segui sem busca' },
        ],
      },
    ]);
    const out = await researchCharacter('xiangling', { client });
    expect(out.urls).toEqual([]);
    expect(out.text).toContain('segui sem busca');
  });

  it('soma o uso de tokens de todas as chamadas, inclusive as retomadas', async () => {
    const { client } = fakeClient([
      { ...textMessage('parcial', 'pause_turn') },
      textMessage('completo'),
    ]);
    const out = await researchCharacter('xiangling', { client });
    expect(out.usage.inputTokens).toBe(200);
    expect(out.usage.outputTokens).toBe(400);
  });
});
```

- [ ] **Step 3: Rodar e confirmar a falha**

Run: `pnpm --filter @buer/meta exec vitest run test/search.test.ts`
Expected: FAIL — `Failed to resolve import "../scripts/research/search.js"`.

- [ ] **Step 4: Escrever o cliente**

Criar `packages/meta/scripts/research/client.ts`:

```ts
// packages/meta/scripts/research/client.ts
//
// Construção do cliente e as constantes que as duas chamadas de API
// compartilham. Ferramenta offline — nunca importada por código de runtime.

import Anthropic from '@anthropic-ai/sdk';

/** Não troque sem instrução explícita. */
export const MODEL = 'claude-opus-5';

/**
 * Os três domínios, na ordem de preferência decidida em docs/STATUS.md.
 * A busca web é restrita a eles: pesquisa com citação, não varredura aberta.
 */
export const SOURCE_DOMAINS = ['icy-veins.com', 'game8.co', 'genshin-builds.com'] as const;

/**
 * Cliente sem argumento: o SDK resolve a credencial do ambiente
 * (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, ou um perfil de `ant auth login`).
 * Nenhuma chave é lida ou impressa por este código.
 */
export function createClient(): Anthropic {
  return new Anthropic();
}

/**
 * Erro da API em uma frase, em português, sem vazar credencial.
 * Distingue o que adianta repetir do que não adianta — quem chama decide.
 */
export function describeApiError(e: unknown): string {
  if (e instanceof Anthropic.RateLimitError) return 'limite de taxa atingido; espere e repita';
  if (e instanceof Anthropic.AuthenticationError) return 'credencial inválida ou ausente (ANTHROPIC_API_KEY / ant auth login)';
  if (e instanceof Anthropic.BadRequestError) return `requisição rejeitada: ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return 'falha de conexão com a API';
  if (e instanceof Anthropic.APIError) return `erro da API (${e.status}): ${e.message}`;
  return `erro inesperado: ${String(e)}`;
}
```

- [ ] **Step 5: Escrever a pesquisa**

Criar `packages/meta/scripts/research/search.ts`:

```ts
// packages/meta/scripts/research/search.ts
//
// A primeira das duas chamadas de API: pesquisa com busca web restrita aos três
// domínios de referência. Devolve o texto bruto e as URLs consultadas — a
// estruturação é da extração (extract.ts), não daqui.
//
// O cliente é INJETADO. Nenhum teste desta suíte toca a rede.

import type Anthropic from '@anthropic-ai/sdk';
import { MODEL, SOURCE_DOMAINS } from './client.js';
import { SOURCE_IDS } from './claims.js';

export interface SearchClient {
  stream(params: Anthropic.MessageStreamParams): { finalMessage(): Promise<Anthropic.Message> };
}

export interface SearchDeps {
  readonly client: SearchClient;
  readonly model?: string;
  /** Teto de buscas por personagem. Três fontes, com folga para refinar. */
  readonly maxUses?: number;
  /** Quantas vezes retomar um turno pausado antes de desistir. */
  readonly maxResumes?: number;
}

export interface ResearchOutput {
  readonly text: string;
  readonly urls: readonly string[];
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
}

/**
 * O prompt. Em português porque a ficha e os `why` são lidos por um usuário
 * brasileiro, ainda que as fontes sejam em inglês.
 *
 * As duas exigências que fazem o pipeline funcionar estão aqui: atribuição
 * POR FONTE (senão a reconciliação não tem o que comparar) e a proibição de
 * preencher lacuna (senão o pipeline industrializa o defeito da §14.3).
 */
export function buildCharacterPrompt(slug: string): string {
  return [
    `Pesquise a build recomendada do personagem "${slug}" de Genshin Impact nestes três sites, e SOMENTE neles:`,
    '',
    '1. icy-veins.com',
    '2. game8.co',
    '3. genshin-builds.com',
    '',
    'Relate o que **cada fonte** diz **separadamente**. Não resuma as três numa recomendação só —',
    'a comparação entre elas é feita depois, e ela precisa saber quem disse o quê.',
    '',
    'Para cada fonte, extraia, quando a fonte cobrir:',
    '- conjuntos de artefato recomendados, do melhor para o pior;',
    '- main-stats de ampulheta (sands), cálice (goblet) e capacete (circlet);',
    '- prioridade de substats;',
    '- armas recomendadas, da melhor para a pior;',
    '- limiar de Recarga de Energia (ER) em porcentagem, e **a razão que a fonte dá** para esse número;',
    '- o papel do personagem no time (main dps, sub dps, buffer, healer, shielder, battery, driver, enabler);',
    '- com que atributo a build escala (ATQ, Vida, DEF ou Maestria Elemental).',
    '',
    'REGRA QUE NÃO PODE SER QUEBRADA: se uma fonte não cobre um item, **omita esse item para essa fonte**.',
    'Não invente, не deduza de outra fonte, e não preencha com o valor "usual". Um campo ausente é',
    'informação correta; um campo preenchido por suposição é um erro que ninguém vai conseguir detectar depois.',
    '',
    'Ao fim, liste a URL exata que você usou de cada fonte.',
  ].join('\n');
}

/** Junta os blocos de texto da resposta. */
function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

/**
 * URLs dos resultados de busca.
 *
 * Cuidado real: erro de server tool volta com HTTP 200 e um bloco cujo
 * `content` é um OBJETO de erro, não a lista de resultados. Iterar sem checar
 * `Array.isArray` quebra exatamente no caso em que a busca falhou.
 */
function urlsOf(message: Anthropic.Message): string[] {
  const urls: string[] = [];
  for (const block of message.content as { type: string; content?: unknown }[]) {
    if (block.type !== 'web_search_tool_result') continue;
    if (!Array.isArray(block.content)) continue;
    for (const result of block.content as { type?: string; url?: string }[]) {
      if (typeof result.url === 'string') urls.push(result.url);
    }
  }
  return urls;
}

export async function researchCharacter(slug: string, deps: SearchDeps): Promise<ResearchOutput> {
  const maxResumes = deps.maxResumes ?? 4;
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: buildCharacterPrompt(slug) }];

  const texts: string[] = [];
  const urls: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;

  for (let attempt = 0; attempt <= maxResumes; attempt++) {
    const stream = deps.client.stream({
      model: deps.model ?? MODEL,
      // Streaming com teto alto: a busca web produz turnos longos, e sem
      // streaming isso bate no timeout de HTTP do SDK.
      max_tokens: 64000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      tools: [
        {
          type: 'web_search_20260209',
          name: 'web_search',
          max_uses: deps.maxUses ?? 8,
          allowed_domains: [...SOURCE_DOMAINS],
        },
      ],
      messages,
    } as Anthropic.MessageStreamParams);

    const message = await stream.finalMessage();
    texts.push(textOf(message));
    urls.push(...urlsOf(message));
    inputTokens += message.usage?.input_tokens ?? 0;
    outputTokens += message.usage?.output_tokens ?? 0;

    // A busca web pode pausar um turno longo. O SDK não retoma sozinho: sem
    // este laço a resposta volta truncada, sem erro e sem aviso.
    if (message.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: message.content });
  }

  return {
    text: texts.filter((t) => t !== '').join('\n'),
    urls: [...new Set(urls)],
    usage: { inputTokens, outputTokens },
  };
}

/** Só para o prompt de arquétipo saber os ids de fonte válidos. */
export const KNOWN_SOURCES = SOURCE_IDS;
```

- [ ] **Step 6: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @buer/meta exec vitest run test/search.test.ts`
Expected: PASS (7 testes). Nenhum toca a rede.

- [ ] **Step 7: Commit**

```bash
git add packages/meta/scripts/research/client.ts packages/meta/scripts/research/search.ts packages/meta/test/search.test.ts packages/meta/package.json pnpm-lock.yaml
git commit -m "feat(meta): pesquisa com busca web restrita às três fontes, com retomada de turno pausado"
```

---

## Task 4: Extração estruturada e normalização de slug

A segunda chamada de API transforma a prosa da pesquisa em `SourceClaim[]`. A normalização de nome para slug é **pura** e roda contra o catálogo — o modelo devolve "Emblem of Severed Fate", e é o código que decide se isso resolve para `emblem-of-severed-fate`.

**Files:**
- Create: `packages/meta/scripts/research/extract.ts`
- Test: `packages/meta/test/extract.test.ts`

**Interfaces:**
- Consumes: `SourceClaim`, `CharacterClaims`, `SOURCE_IDS` de `./claims.js`; `loadCharacters`, `loadWeapons`, `loadArtifactSets`, `loadProperty` de `@buer/gi-data`.
- Produces:
  - `extractClaims(slug: string, researchText: string, deps: ExtractDeps): Promise<CharacterClaims>`
    com `ExtractDeps = { client: ExtractClient; model?: string }`
    e `ExtractClient = { parse(params: unknown): Promise<{ parsed_output: unknown }> }`
  - `normalizeClaim(raw: RawClaim, catalogs: Catalogs): { claim: SourceClaim; unresolved: readonly string[] }` — **pura**
  - `buildCatalogs(): Catalogs`

- [ ] **Step 1: Escrever o teste que falha**

Criar `packages/meta/test/extract.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizeClaim, buildCatalogs, extractClaims } from '../scripts/research/extract.js';

const catalogs = buildCatalogs();

describe('normalizeClaim — nome humano vira slug do catálogo', () => {
  it('resolve conjunto e arma escritos como a fonte escreve', () => {
    const { claim, unresolved } = normalizeClaim(
      {
        source: 'icy-veins', url: 'https://icy-veins.com/x',
        sets: ['Emblem of Severed Fate'],
        weapons: ['The Catch'],
      },
      catalogs,
    );
    expect(claim.sets).toEqual(['emblem-of-severed-fate']);
    expect(claim.weapons).toEqual(['the-catch']);
    expect(unresolved).toEqual([]);
  });

  it('nome que não existe no catálogo é DESCARTADO e reportado, nunca adivinhado', () => {
    const { claim, unresolved } = normalizeClaim(
      { source: 'game8', url: 'https://game8.co/x', sets: ['Conjunto Que Não Existe'] },
      catalogs,
    );
    expect(claim.sets).toBeUndefined();
    expect(unresolved).toContain('Conjunto Que Não Existe');
  });

  it('descarta só o item inválido, preservando os que resolvem', () => {
    const { claim, unresolved } = normalizeClaim(
      {
        source: 'game8', url: 'https://game8.co/x',
        weapons: ['The Catch', 'Arma Inventada', "Dragon's Bane"],
      },
      catalogs,
    );
    expect(claim.weapons).toEqual(['the-catch', 'dragon-s-bane']);
    expect(unresolved).toEqual(['Arma Inventada']);
  });

  it('normaliza main-stat de nome humano para StatKey', () => {
    const { claim } = normalizeClaim(
      {
        source: 'icy-veins', url: 'u',
        mainStats: { sands: ['Energy Recharge'], goblet: ['Pyro DMG Bonus'], circlet: ['CRIT Rate'] },
      },
      catalogs,
    );
    expect(claim.mainStats?.sands).toEqual(['enerRech_']);
    expect(claim.mainStats?.goblet).toEqual(['pyro_dmg_']);
    expect(claim.mainStats?.circlet).toEqual(['critRate_']);
  });

  it('papel fora do vocabulário fechado é descartado', () => {
    const { claim, unresolved } = normalizeClaim(
      { source: 'game8', url: 'u', roles: ['sub-dps', 'carry'] },
      catalogs,
    );
    expect(claim.roles).toEqual(['sub-dps']);
    expect(unresolved).toContain('carry');
  });

  it('campo ausente continua ausente — normalizar não inventa', () => {
    const { claim } = normalizeClaim({ source: 'game8', url: 'u' }, catalogs);
    expect(claim.sets).toBeUndefined();
    expect(claim.erThreshold).toBeUndefined();
    expect(claim.mainStats).toBeUndefined();
  });

  it('preserva erWhy e erThreshold como vieram', () => {
    const { claim } = normalizeClaim(
      { source: 'icy-veins', url: 'u', erThreshold: 200, erWhy: 'o burst custa 80 de energia' },
      catalogs,
    );
    expect(claim.erThreshold).toBe(200);
    expect(claim.erWhy).toContain('80 de energia');
  });
});

describe('extractClaims', () => {
  it('devolve um claim por fonte, normalizado', async () => {
    const client = {
      async parse() {
        return {
          parsed_output: {
            claims: [
              { source: 'icy-veins', url: 'https://icy-veins.com/x', sets: ['Emblem of Severed Fate'] },
              { source: 'game8', url: 'https://game8.co/x', sets: ['Emblem of Severed Fate'] },
            ],
          },
        };
      },
    };
    const out = await extractClaims('xiangling', 'texto da pesquisa', { client });
    expect(out.character).toBe('xiangling');
    expect(out.claims).toHaveLength(2);
    expect(out.claims[0]!.sets).toEqual(['emblem-of-severed-fate']);
  });

  it('saída não parseável lança com mensagem em português, em vez de devolver vazio', async () => {
    const client = { async parse() { return { parsed_output: null }; } };
    await expect(extractClaims('xiangling', 'texto', { client })).rejects.toThrow(/não foi possível estruturar/i);
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `pnpm --filter @buer/meta exec vitest run test/extract.test.ts`
Expected: FAIL — `Failed to resolve import "../scripts/research/extract.js"`.

- [ ] **Step 3: Escrever a extração**

Criar `packages/meta/scripts/research/extract.ts`:

```ts
// packages/meta/scripts/research/extract.ts
//
// A segunda chamada de API: prosa da pesquisa -> SourceClaim[] tipado.
//
// A normalização de nome-humano para slug é PURA e roda contra o catálogo do
// gi-data: o modelo devolve "Emblem of Severed Fate", e é o código que decide
// se isso resolve. Nome que não resolve é DESCARTADO e reportado — nunca
// aproximado, porque um slug errado vira ficha que aponta para nada.

import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { loadArtifactSets, loadProperty, loadWeapons } from '@buer/gi-data';
import { ROLE_TAGS } from '@buer/core';
import { MODEL } from './client.js';
import { SOURCE_IDS, type CharacterClaims, type SourceClaim } from './claims.js';

const MainStatsSchema = z.object({
  sands: z.array(z.string()).optional(),
  goblet: z.array(z.string()).optional(),
  circlet: z.array(z.string()).optional(),
});

const RawClaimSchema = z.object({
  source: z.enum(SOURCE_IDS),
  url: z.string(),
  sets: z.array(z.string()).optional(),
  mainStats: MainStatsSchema.optional(),
  substats: z.array(z.string()).optional(),
  weapons: z.array(z.string()).optional(),
  erThreshold: z.number().optional(),
  erWhy: z.string().optional(),
  roles: z.array(z.string()).optional(),
  scalesOn: z.string().optional(),
});

const ClaimsSchema = z.object({ claims: z.array(RawClaimSchema) });

export type RawClaim = z.infer<typeof RawClaimSchema>;

export interface Catalogs {
  readonly sets: ReadonlyMap<string, string>;
  readonly weapons: ReadonlyMap<string, string>;
  readonly stats: ReadonlyMap<string, string>;
  readonly roles: ReadonlySet<string>;
}

/** "Emblem of Severed Fate" e "emblem-of-severed-fate" batem na mesma chave. */
function fold(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Índices de lookup. Cada slug entra por si mesmo e por sua forma dobrada, o
 * que faz `The Catch`, `the catch` e `the-catch` resolverem para a mesma coisa.
 */
export function buildCatalogs(): Catalogs {
  const sets = new Map<string, string>();
  for (const entry of Object.values(loadArtifactSets())) sets.set(fold(entry.slug), entry.slug);

  const weapons = new Map<string, string>();
  for (const entry of Object.values(loadWeapons())) weapons.set(fold(entry.slug), entry.slug);

  // StatKey aceita tanto o próprio goodKey ('enerRech_') quanto o nome humano
  // que as fontes usam ('Energy Recharge', 'Pyro DMG Bonus', 'CRIT Rate').
  const stats = new Map<string, string>();
  for (const entry of Object.values(loadProperty())) {
    if (!entry.goodKey) continue;
    stats.set(fold(entry.goodKey), entry.goodKey);
  }
  const HUMAN: Readonly<Record<string, string>> = {
    'energy-recharge': 'enerRech_', 'er': 'enerRech_',
    'crit-rate': 'critRate_', 'critical-rate': 'critRate_',
    'crit-dmg': 'critDMG_', 'crit-damage': 'critDMG_', 'critical-damage': 'critDMG_',
    'elemental-mastery': 'eleMas', 'em': 'eleMas',
    'atk': 'atk_', 'atk-percent': 'atk_', 'attack': 'atk_',
    'hp': 'hp_', 'hp-percent': 'hp_',
    'def': 'def_', 'def-percent': 'def_', 'defense': 'def_',
    'healing-bonus': 'heal_',
    'physical-dmg-bonus': 'physical_dmg_',
    'pyro-dmg-bonus': 'pyro_dmg_', 'hydro-dmg-bonus': 'hydro_dmg_', 'cryo-dmg-bonus': 'cryo_dmg_',
    'electro-dmg-bonus': 'electro_dmg_', 'anemo-dmg-bonus': 'anemo_dmg_',
    'geo-dmg-bonus': 'geo_dmg_', 'dendro-dmg-bonus': 'dendro_dmg_',
  };
  for (const [k, v] of Object.entries(HUMAN)) stats.set(k, v);

  return { sets, weapons, stats, roles: new Set<string>(ROLE_TAGS) };
}

function resolveList(
  names: readonly string[] | undefined,
  index: ReadonlyMap<string, string> | ReadonlySet<string>,
  unresolved: string[],
): string[] | undefined {
  if (names === undefined) return undefined;
  const out: string[] = [];
  for (const name of names) {
    const key = fold(name);
    const hit = index instanceof Map ? index.get(key) : index.has(key) ? key : undefined;
    if (hit === undefined) unresolved.push(name);
    else out.push(hit);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Nome humano -> slug do catálogo. Pura.
 *
 * `undefined` entra e `undefined` sai: normalizar nunca transforma "a fonte não
 * cobre" em "a fonte diz vazio".
 */
export function normalizeClaim(
  raw: RawClaim,
  catalogs: Catalogs,
): { claim: SourceClaim; unresolved: readonly string[] } {
  const unresolved: string[] = [];

  const mainStats = raw.mainStats
    ? {
        sands: resolveList(raw.mainStats.sands, catalogs.stats, unresolved),
        goblet: resolveList(raw.mainStats.goblet, catalogs.stats, unresolved),
        circlet: resolveList(raw.mainStats.circlet, catalogs.stats, unresolved),
      }
    : undefined;

  const hasMainStat =
    mainStats !== undefined &&
    (mainStats.sands !== undefined || mainStats.goblet !== undefined || mainStats.circlet !== undefined);

  // Uma chamada por campo, guardada numa variável. Chamar `resolveList` duas
  // vezes para o mesmo campo duplicaria os itens em `unresolved` — e passar um
  // array descartável na segunda chamada perderia o relato.
  const sets = resolveList(raw.sets, catalogs.sets, unresolved);
  const substats = resolveList(raw.substats, catalogs.stats, unresolved);
  const weapons = resolveList(raw.weapons, catalogs.weapons, unresolved);
  const roles = resolveList(raw.roles, catalogs.roles, unresolved);

  const claim: SourceClaim = {
    source: raw.source,
    url: raw.url,
    ...(sets === undefined ? {} : { sets }),
    ...(hasMainStat ? { mainStats } : {}),
    ...(substats === undefined ? {} : { substats }),
    ...(weapons === undefined ? {} : { weapons }),
    ...(raw.erThreshold === undefined ? {} : { erThreshold: raw.erThreshold }),
    ...(raw.erWhy === undefined ? {} : { erWhy: raw.erWhy }),
    ...(roles === undefined ? {} : { roles }),
    ...(raw.scalesOn === undefined ? {} : { scalesOn: raw.scalesOn }),
  } as SourceClaim;

  return { claim, unresolved };
}

export interface ExtractClient {
  parse(params: unknown): Promise<{ parsed_output: unknown }>;
}

export interface ExtractDeps {
  readonly client: ExtractClient;
  readonly model?: string;
}

export async function extractClaims(
  slug: string,
  researchText: string,
  deps: ExtractDeps,
): Promise<CharacterClaims> {
  const response = await deps.client.parse({
    model: deps.model ?? MODEL,
    max_tokens: 16000,
    output_config: { format: zodOutputFormat(ClaimsSchema), effort: 'high' },
    messages: [
      {
        role: 'user',
        content: [
          `Estruture o relatório de pesquisa abaixo sobre o personagem "${slug}".`,
          '',
          'Um item por fonte. Se a pesquisa não trouxe um campo para uma fonte, **omita esse campo**',
          'para ela — não copie de outra fonte e não preencha com o valor usual.',
          '',
          '--- RELATÓRIO ---',
          researchText,
        ].join('\n'),
      },
    ],
  });

  const parsed = ClaimsSchema.safeParse(response.parsed_output);
  if (!parsed.success) {
    throw new Error(`não foi possível estruturar a pesquisa de "${slug}": saída fora do schema`);
  }

  const catalogs = buildCatalogs();
  return {
    character: slug,
    claims: parsed.data.claims.map((raw) => normalizeClaim(raw, catalogs).claim),
  };
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @buer/meta exec vitest run test/extract.test.ts`
Expected: PASS (9 testes).

- [ ] **Step 5: Commit**

```bash
git add packages/meta/scripts/research/extract.ts packages/meta/test/extract.test.ts
git commit -m "feat(meta): extração estruturada + normalização de slug contra o catálogo"
```

---

## Task 5: Montagem do rascunho, com a borda que recusa

Converte a reconciliação numa `RawCharacterProfile`, e **recusa escrever** quando a pesquisa não deu o mínimo. Um rascunho incompleto no diretório de dado quebra `loadMeta()` e os casos-âncora para todo mundo — a borda rejeita antes disso.

**Files:**
- Create: `packages/meta/scripts/research/write.ts`
- Test: `packages/meta/test/write.test.ts`

**Interfaces:**
- Consumes: `ReconcileResult`, `CharacterClaims`, `SOURCE_IDS` de `./claims.js`; `validateMeta`, `readRawMeta` de `../../src/index.js`.
- Produces:
  - `buildDraft(deps: DraftDeps): DraftResult` — **pura**
  - `writeDraft(draft: DraftResult, io: DraftIo): void`
  - `DraftDeps = { character: string; reconciled: ReconcileResult; claims: CharacterClaims; gameVersion: string; authoredAt: string }`
  - `DraftResult = { profile: RawCharacterProfile | null; refusedBecause: readonly string[]; notes: string }`

- [ ] **Step 1: Escrever o teste que falha**

Criar `packages/meta/test/write.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildDraft } from '../scripts/research/write.js';
import type { CharacterClaims, ReconcileResult } from '../scripts/research/claims.js';

const claims: CharacterClaims = {
  character: 'xiangling',
  claims: [
    { source: 'icy-veins', url: 'https://icy-veins.com/x', erWhy: 'o Pyronado custa 80 de energia' },
    { source: 'game8', url: 'https://game8.co/x', erWhy: 'razão da segunda fonte' },
  ],
};

const full: ReconcileResult = {
  agreed: {
    sets: ['emblem-of-severed-fate'],
    mainStats: { sands: ['enerRech_'], goblet: ['pyro_dmg_'], circlet: ['critRate_'] },
    substats: ['critRate_', 'critDMG_'],
    weapons: ['the-catch'],
    erThreshold: 200,
    roles: ['sub-dps'],
    scalesOn: 'atk',
  },
  divergences: [],
  confidence: 'medium',
  sources: ['https://icy-veins.com/x', 'https://game8.co/x'],
};

const base = { character: 'xiangling', claims, gameVersion: '7.0', authoredAt: '2026-08-25' };

describe('buildDraft', () => {
  it('monta a ficha com authoredBy researched e a confiança da reconciliação', () => {
    const d = buildDraft({ ...base, reconciled: full });
    expect(d.profile!.provenance.authoredBy).toBe('researched');
    expect(d.profile!.provenance.confidence).toBe('medium');
    expect(d.profile!.provenance.sources).toEqual(full.sources);
    expect(d.profile!.provenance.authoredAt).toBe('2026-08-25');
  });

  it('NUNCA produz confidence high — isso exige humano', () => {
    const d = buildDraft({ ...base, reconciled: { ...full, confidence: 'medium' } });
    expect(d.profile!.provenance.confidence).not.toBe('high');
  });

  it('o alvo de ER carrega o why da fonte de MAIOR preferência que tiver um', () => {
    const d = buildDraft({ ...base, reconciled: full });
    const target = d.profile!.variants[0]!.targets.find((t) => t.kind === 'min')!;
    expect(target.value).toBe(200);
    expect(target.why).toContain('Pyronado'); // icy-veins vence game8
  });

  it('sem erThreshold, a variante sai sem alvo — não inventa um', () => {
    const semEr = { ...full, agreed: { ...full.agreed, erThreshold: undefined } };
    const d = buildDraft({ ...base, reconciled: semEr });
    expect(d.profile!.variants[0]!.targets).toEqual([]);
  });

  it('com erThreshold mas sem why em fonte nenhuma, RECUSA o alvo em vez de gerar prosa', () => {
    const semWhy: CharacterClaims = { character: 'xiangling', claims: [{ source: 'game8', url: 'u' }] };
    const d = buildDraft({ ...base, claims: semWhy, reconciled: full });
    expect(d.profile!.variants[0]!.targets).toEqual([]);
    expect(d.notes).toMatch(/sem justificativa/i);
  });

  it('divergências vão para notes, nomeando o campo e as fontes', () => {
    const comDiv: ReconcileResult = {
      ...full,
      confidence: 'low',
      divergences: [{ field: 'sets', bySource: { 'icy-veins': '["a"]', game8: '["b"]' } }],
    };
    const d = buildDraft({ ...base, reconciled: comDiv });
    expect(d.notes).toContain('sets');
    expect(d.notes).toContain('icy-veins');
    expect(d.profile!.variants[0]!.notes).toContain('sets');
  });

  it('RECUSA quando falta conjunto — ficha sem set quebra os casos-âncora', () => {
    const semSets = { ...full, agreed: { ...full.agreed, sets: undefined } };
    const d = buildDraft({ ...base, reconciled: semSets });
    expect(d.profile).toBeNull();
    expect(d.refusedBecause.join(' ')).toMatch(/conjunto/i);
  });

  it('RECUSA quando falta papel', () => {
    const semRoles = { ...full, agreed: { ...full.agreed, roles: undefined } };
    const d = buildDraft({ ...base, reconciled: semRoles });
    expect(d.profile).toBeNull();
    expect(d.refusedBecause.join(' ')).toMatch(/papel/i);
  });

  it('RECUSA quando falta scalesOn', () => {
    const sem = { ...full, agreed: { ...full.agreed, scalesOn: undefined } };
    expect(buildDraft({ ...base, reconciled: sem }).profile).toBeNull();
  });

  it('RECUSA quando nenhum slot de main-stat resolveu', () => {
    const sem = { ...full, agreed: { ...full.agreed, mainStats: undefined } };
    expect(buildDraft({ ...base, reconciled: sem }).profile).toBeNull();
  });

  it('a ficha montada passa no validateMeta do próprio pacote', async () => {
    const { validateMeta } = await import('../src/validate.js');
    const d = buildDraft({ ...base, reconciled: full });
    expect(validateMeta({ profiles: [d.profile!], archetypes: [] })).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `pnpm --filter @buer/meta exec vitest run test/write.test.ts`
Expected: FAIL — `Failed to resolve import "../scripts/research/write.js"`.

- [ ] **Step 3: Escrever a montagem**

Criar `packages/meta/scripts/research/write.ts`:

```ts
// packages/meta/scripts/research/write.ts
//
// Reconciliação -> RawCharacterProfile, e a borda que RECUSA.
//
// Recusar importa mais que montar: uma ficha incompleta gravada em
// data/characters/ é carregada por loadMeta() e quebra os casos-âncora e os
// testes de todos os outros pacotes. A pesquisa que não deu o mínimo vira
// relatório, não arquivo.

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { RawCharacterProfile } from '../../src/types.js';
import { validateMeta } from '../../src/validate.js';
import { SOURCE_IDS, type CharacterClaims, type ReconcileResult } from './claims.js';

export interface DraftDeps {
  readonly character: string;
  readonly reconciled: ReconcileResult;
  readonly claims: CharacterClaims;
  readonly gameVersion: string;
  /** Injetado, nunca `new Date()`: o rascunho precisa ser reproduzível. */
  readonly authoredAt: string;
}

export interface DraftResult {
  readonly profile: RawCharacterProfile | null;
  readonly refusedBecause: readonly string[];
  readonly notes: string;
}

/**
 * A razão do limiar de ER, na voz da fonte de MAIOR preferência que deu uma.
 *
 * Não é votação: prosa de três sites nunca bate literalmente, e votar em texto
 * daria empate em todo personagem. Assim o `why` fica atribuível a uma URL que
 * está em `sources`, em vez de sair de um template — que é o que a §5.2 da
 * spec exige quando diz que o `why` explica o número.
 */
function preferredWhy(claims: CharacterClaims): string | undefined {
  for (const id of SOURCE_IDS) {
    const found = claims.claims.find((c) => c.source === id && c.erWhy !== undefined);
    if (found?.erWhy) return found.erWhy;
  }
  return undefined;
}

function describeDivergences(reconciled: ReconcileResult): string {
  if (reconciled.divergences.length === 0) return '';
  const linhas = reconciled.divergences.map((d) => {
    const partes = Object.entries(d.bySource).map(([fonte, valor]) => `${fonte}: ${valor}`);
    return `- ${d.field} — ${partes.join(' | ')}`;
  });
  return ['As fontes divergem nos campos abaixo. Revise antes de promover a confiança:', ...linhas].join('\n');
}

export function buildDraft(deps: DraftDeps): DraftResult {
  const { agreed } = deps.reconciled;
  const refused: string[] = [];

  // O mínimo viável. Cada item aqui é exigido por um teste que já existe no
  // repositório (casos-âncora do @buer/engine e integridade do @buer/meta) —
  // gravar sem eles não é "ficha parcial", é suíte quebrada.
  if (!agreed.sets || agreed.sets.length === 0) refused.push('nenhum conjunto de artefato confirmado');
  if (!agreed.roles || agreed.roles.length === 0) refused.push('nenhum papel confirmado');
  if (!agreed.scalesOn) refused.push('não ficou claro com que atributo a build escala');
  const anyMainStat =
    agreed.mainStats !== undefined &&
    (agreed.mainStats.sands !== undefined ||
      agreed.mainStats.goblet !== undefined ||
      agreed.mainStats.circlet !== undefined);
  if (!anyMainStat) refused.push('nenhuma main-stat confirmada');

  const why = preferredWhy(deps.claims);
  const notasExtras: string[] = [];

  // Alvo de ER só entra COM justificativa. Um limiar sem o porquê é um número
  // sem origem, e o `why` é obrigatório no schema — gerar um por template
  // seria inventar mecanismo, exatamente o defeito da §14.3.
  const targets =
    agreed.erThreshold !== undefined && why !== undefined
      ? [
          {
            kind: 'min' as const,
            stat: 'enerRech_' as never,
            value: agreed.erThreshold,
            hard: true,
            why,
          },
        ]
      : [];
  if (agreed.erThreshold !== undefined && why === undefined) {
    notasExtras.push(
      `As fontes citam um limiar de ER de ${agreed.erThreshold}%, mas nenhuma explicou por quê — ` +
        'o alvo foi omitido em vez de receber uma justificativa inventada.',
    );
  }

  const divergencias = describeDivergences(deps.reconciled);
  const notes = [divergencias, ...notasExtras].filter((s) => s !== '').join('\n\n');

  if (refused.length > 0) return { profile: null, refusedBecause: refused, notes };

  const profile: RawCharacterProfile = {
    schemaVersion: 1,
    character: deps.character,
    variants: [
      {
        id: 'principal',
        label: 'Build principal',
        roles: [...agreed.roles!],
        scalesOn: agreed.scalesOn!,
        sets: agreed.sets!.map((slug, index) => ({ kind: '4pc' as const, sets: [slug], rank: index + 1 })),
        mainStats: {
          sands: [...(agreed.mainStats?.sands ?? [])],
          goblet: [...(agreed.mainStats?.goblet ?? [])],
          circlet: [...(agreed.mainStats?.circlet ?? [])],
        },
        substats: [...(agreed.substats ?? [])],
        weapons: (agreed.weapons ?? []).map((slug, index) => ({ weapon: slug, rank: index + 1 })),
        targets,
        ...(notes === '' ? {} : { notes }),
      },
    ],
    provenance: {
      authoredBy: 'researched',
      sources: [...deps.reconciled.sources],
      authoredAt: deps.authoredAt,
      validatedForVersion: deps.gameVersion,
      // Sai da reconciliação, nunca do modelo, e nunca 'high'.
      confidence: deps.reconciled.confidence,
    },
  };

  return { profile, refusedBecause: [], notes };
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, '..', '..', 'data');

export interface DraftIo {
  readonly researchText: string;
  /** Valida contra o banco INTEIRO antes de gravar. */
  readonly existing: Parameters<typeof validateMeta>[0];
}

/**
 * Grava o rascunho e o texto da pesquisa ao lado dele. LANÇA se a ficha nova
 * invalidar o banco — a borda rejeita antes do disco, não depois.
 */
export function writeDraft(draft: DraftResult, io: DraftIo): void {
  if (!draft.profile) throw new Error('rascunho recusado; nada a gravar');

  // SUBSTITUI a ficha deste personagem em vez de anexar: a regra de integridade
  // que a Fase 2 acrescentou rejeita `character` duplicado entre fichas, e
  // repesquisar alguem que ja tem ficha lancaria "duplicado" em vez de
  // atualizar.
  const outros = io.existing.profiles.filter((p) => p.character !== draft.profile!.character);
  const problems = validateMeta({
    profiles: [...outros, draft.profile],
    archetypes: io.existing.archetypes,
  });
  if (problems.length > 0) {
    throw new Error(`rascunho de "${draft.profile.character}" inválido:\n  - ${problems.join('\n  - ')}`);
  }

  writeFileSync(
    path.join(DATA, 'characters', `${draft.profile.character}.json`),
    `${JSON.stringify(draft.profile, null, 2)}\n`,
    'utf8',
  );

  // O texto da pesquisa fica ao lado da ficha: é o que o revisor humano lê
  // para decidir se promove a confiança.
  mkdirSync(path.join(DATA, 'research'), { recursive: true });
  writeFileSync(
    path.join(DATA, 'research', `${draft.profile.character}.md`),
    `# Pesquisa — ${draft.profile.character}\n\n${io.researchText}\n`,
    'utf8',
  );
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @buer/meta exec vitest run test/write.test.ts`
Expected: PASS (11 testes).

- [ ] **Step 5: Commit**

```bash
git add packages/meta/scripts/research/write.ts packages/meta/test/write.test.ts
git commit -m "feat(meta): montagem do rascunho, com a borda que recusa pesquisa insuficiente"
```

---

## Task 6: O lote — `meta:research:characters`

Orquestra os quatro estágios sobre uma lista de alvos. Uma falha não derruba o lote; o custo é estimado e reportado; `--dry-run` mostra o plano sem gastar.

**Files:**
- Create: `packages/meta/scripts/research-characters.ts`
- Modify: `packages/meta/package.json`
- Test: `packages/meta/test/research-cli.test.ts`

**Interfaces:**
- Consumes: `researchCharacter` (Task 3), `extractClaims` (Task 4), `reconcileCharacter` (Task 2), `buildDraft`/`writeDraft` (Task 5), `computeGaps` (Task 1).
- Produces:
  - `runBatch(deps: BatchDeps): Promise<BatchReport>`
  - `parseArgs(argv: readonly string[]): BatchFlags`
  - `estimateCostUsd(usage: { inputTokens: number; outputTokens: number }): number`
  - `formatBatchReport(report: BatchReport): string`

- [ ] **Step 1: Escrever o teste que falha**

Criar `packages/meta/test/research-cli.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { runBatch, parseArgs, estimateCostUsd, formatBatchReport } from '../scripts/research-characters.js';
import type { CharacterClaims } from '../scripts/research/claims.js';

const emptyMeta = { profiles: [], archetypes: [] };
const usage = { inputTokens: 100, outputTokens: 50 };

const claimsFor = (slug: string, complete: boolean): CharacterClaims => ({
  character: slug,
  claims: [
    {
      source: 'icy-veins', url: `https://icy-veins.com/${slug}`,
      ...(complete
        ? {
            sets: ['emblem-of-severed-fate'],
            mainStats: { sands: ['enerRech_'], goblet: ['pyro_dmg_'], circlet: ['critRate_'] },
            roles: ['sub-dps'], scalesOn: 'atk',
          }
        : {}),
    },
    {
      source: 'game8', url: `https://game8.co/${slug}`,
      ...(complete
        ? {
            sets: ['emblem-of-severed-fate'],
            mainStats: { sands: ['enerRech_'], goblet: ['pyro_dmg_'], circlet: ['critRate_'] },
            roles: ['sub-dps'], scalesOn: 'atk',
          }
        : {}),
    },
  ],
});

function deps(targets: string[], over: Partial<Parameters<typeof runBatch>[0]> = {}) {
  const written: string[] = [];
  return {
    written,
    deps: {
      targets,
      gameVersion: '7.0',
      authoredAt: '2026-08-25',
      existing: emptyMeta,
      research: async (slug: string) => ({ text: `pesquisa de ${slug}`, urls: [], usage }),
      extract: async (slug: string) => claimsFor(slug, slug !== 'incompleto'),
      write: (draft: { profile: { character: string } | null }) => {
        written.push(draft.profile!.character);
      },
      ...over,
    } as Parameters<typeof runBatch>[0],
  };
}

describe('parseArgs', () => {
  it('--only aceita lista separada por vírgula', () => {
    expect(parseArgs(['--only', 'xiangling,bennett']).only).toEqual(['xiangling', 'bennett']);
  });

  it('--all e --limit e --dry-run', () => {
    const f = parseArgs(['--all', '--limit', '5', '--dry-run']);
    expect(f.all).toBe(true);
    expect(f.limit).toBe(5);
    expect(f.dryRun).toBe(true);
  });

  it('sem alvo nenhum não assume --all', () => {
    const f = parseArgs([]);
    expect(f.all).toBe(false);
    expect(f.only).toEqual([]);
  });
});

describe('estimateCostUsd', () => {
  it('usa a tabela de preço do modelo', () => {
    // 1M de entrada + 1M de saída em claude-opus-5 = 5 + 25
    expect(estimateCostUsd({ inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(30, 5);
  });
});

describe('runBatch', () => {
  it('escreve rascunho para quem a pesquisa cobriu', async () => {
    const { deps: d, written } = deps(['xiangling']);
    const r = await runBatch(d);
    expect(written).toEqual(['xiangling']);
    expect(r.written).toEqual(['xiangling']);
  });

  it('recusa sem gravar quando falta o mínimo, e diz por quê', async () => {
    const { deps: d, written } = deps(['incompleto']);
    const r = await runBatch(d);
    expect(written).toEqual([]);
    expect(r.refused.map((x) => x.slug)).toEqual(['incompleto']);
    expect(r.refused[0]!.because.join(' ')).toMatch(/conjunto|papel|escala|main-stat/i);
  });

  it('uma falha não derruba o lote — os outros continuam', async () => {
    const { deps: d, written } = deps(['quebra', 'xiangling'], {
      research: async (slug: string) => {
        if (slug === 'quebra') throw new Error('limite de taxa atingido');
        return { text: 'ok', urls: [], usage };
      },
    });
    const r = await runBatch(d);
    expect(r.failed.map((x) => x.slug)).toEqual(['quebra']);
    expect(written).toEqual(['xiangling']);
  });

  it('soma o uso de tokens de todos os alvos', async () => {
    const { deps: d } = deps(['xiangling', 'incompleto']);
    const r = await runBatch(d);
    expect(r.usage.inputTokens).toBe(200);
    expect(r.estimatedCostUsd).toBeGreaterThan(0);
  });

  it('o relatório nomeia escritos, recusados e falhados', async () => {
    const { deps: d } = deps(['xiangling', 'incompleto']);
    const texto = formatBatchReport(await runBatch(d));
    expect(texto).toContain('xiangling');
    expect(texto).toContain('incompleto');
    expect(texto).toMatch(/recusad/i);
    expect(texto).toMatch(/US\$|custo/i);
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `pnpm --filter @buer/meta exec vitest run test/research-cli.test.ts`
Expected: FAIL — `Failed to resolve import "../scripts/research-characters.js"`.

- [ ] **Step 3: Escrever o lote**

Criar `packages/meta/scripts/research-characters.ts`:

```ts
// packages/meta/scripts/research-characters.ts
//
// `meta:research:characters` — o lote. Orquestra pesquisa -> extração ->
// reconciliação -> escrita sobre uma lista de alvos.
//
// Sequencial de propósito: a busca web é a parte cara e o limite de taxa é o
// gargalo real, não o paralelismo. Um alvo que falha vira linha de relatório,
// nunca aborta o lote — perder 40 personagens porque o 41º deu 429 seria caro
// de repetir.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadCharacters } from '@buer/gi-data';
import type { RawMeta } from '../src/types.js';
import { readRawMeta } from '../src/load.js';
import { computeGaps } from './gaps.js';
import { createClient, describeApiError, MODEL } from './research/client.js';
import { researchCharacter, type ResearchOutput } from './research/search.js';
import { extractClaims } from './research/extract.js';
import { reconcileCharacter } from './research/reconcile.js';
import { buildDraft, writeDraft, type DraftResult } from './research/write.js';
import type { CharacterClaims } from './research/claims.js';

/**
 * Preço de `claude-opus-5` por milhão de tokens, em dólar.
 * Valor de tabela em 2026-06; confira em anthropic.com/pricing antes de
 * confiar numa estimativa grande.
 */
const PRICE_INPUT_PER_MTOK = 5;
const PRICE_OUTPUT_PER_MTOK = 25;

export function estimateCostUsd(usage: { inputTokens: number; outputTokens: number }): number {
  return (usage.inputTokens / 1e6) * PRICE_INPUT_PER_MTOK + (usage.outputTokens / 1e6) * PRICE_OUTPUT_PER_MTOK;
}

export interface BatchFlags {
  readonly only: readonly string[];
  readonly all: boolean;
  readonly limit: number | undefined;
  readonly dryRun: boolean;
}

export function parseArgs(argv: readonly string[]): BatchFlags {
  let only: string[] = [];
  let all = false;
  let limit: number | undefined;
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--only') {
      only = (argv[++i] ?? '').split(',').map((s) => s.trim()).filter((s) => s !== '');
    } else if (arg === '--all') all = true;
    else if (arg === '--limit') limit = Number(argv[++i]);
    else if (arg === '--dry-run') dryRun = true;
  }

  return { only, all, limit, dryRun };
}

export interface BatchDeps {
  readonly targets: readonly string[];
  readonly gameVersion: string;
  readonly authoredAt: string;
  readonly existing: RawMeta;
  readonly research: (slug: string) => Promise<ResearchOutput>;
  readonly extract: (slug: string, text: string) => Promise<CharacterClaims>;
  readonly write: (draft: DraftResult, io: { researchText: string; existing: RawMeta }) => void;
  readonly onProgress?: (line: string) => void;
}

export interface BatchReport {
  readonly written: readonly string[];
  readonly refused: readonly { readonly slug: string; readonly because: readonly string[] }[];
  readonly failed: readonly { readonly slug: string; readonly error: string }[];
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
  readonly estimatedCostUsd: number;
}

export async function runBatch(deps: BatchDeps): Promise<BatchReport> {
  const written: string[] = [];
  const refused: { slug: string; because: readonly string[] }[] = [];
  const failed: { slug: string; error: string }[] = [];
  let inputTokens = 0;
  let outputTokens = 0;

  for (const slug of deps.targets) {
    deps.onProgress?.(`pesquisando ${slug}…`);
    try {
      const research = await deps.research(slug);
      inputTokens += research.usage.inputTokens;
      outputTokens += research.usage.outputTokens;

      const claims = await deps.extract(slug, research.text);
      const reconciled = reconcileCharacter(claims);
      const draft = buildDraft({
        character: slug,
        reconciled,
        claims,
        gameVersion: deps.gameVersion,
        authoredAt: deps.authoredAt,
      });

      if (!draft.profile) {
        refused.push({ slug, because: draft.refusedBecause });
        deps.onProgress?.(`  recusado: ${draft.refusedBecause.join('; ')}`);
        continue;
      }

      deps.write(draft, { researchText: research.text, existing: deps.existing });
      written.push(slug);
      deps.onProgress?.(`  gravado (confiança ${draft.profile.provenance.confidence})`);
    } catch (e) {
      const error = describeApiError(e);
      failed.push({ slug, error });
      deps.onProgress?.(`  falhou: ${error}`);
    }
  }

  const usage = { inputTokens, outputTokens };
  return { written, refused, failed, usage, estimatedCostUsd: estimateCostUsd(usage) };
}

export function formatBatchReport(report: BatchReport): string {
  const lines = ['', 'Buer — lote de pesquisa concluído', ''];

  lines.push(`GRAVADOS (${report.written.length})`);
  lines.push(report.written.length === 0 ? '  nenhum' : `  ${report.written.join(', ')}`);
  lines.push('');

  lines.push(`RECUSADOS — pesquisa insuficiente, nada foi gravado (${report.refused.length})`);
  if (report.refused.length === 0) lines.push('  nenhum');
  else for (const r of report.refused) lines.push(`  ${r.slug}: ${r.because.join('; ')}`);
  lines.push('');

  lines.push(`FALHARAM (${report.failed.length})`);
  if (report.failed.length === 0) lines.push('  nenhum');
  else for (const f of report.failed) lines.push(`  ${f.slug}: ${f.error}`);
  lines.push('');

  lines.push(
    `tokens: ${report.usage.inputTokens} entrada / ${report.usage.outputTokens} saída · ` +
      `custo estimado US$ ${report.estimatedCostUsd.toFixed(2)}`,
  );
  lines.push('');
  lines.push('Toda ficha gravada nasce com authoredBy "researched". Leia o texto da pesquisa em');
  lines.push('data/research/<slug>.md antes de promover qualquer uma para "researched-reviewed".');

  return lines.join('\n');
}

const HERE = path.dirname(fileURLToPath(import.meta.url));

function currentGameVersion(): string {
  const file = path.join(HERE, '..', 'data', 'game-version.json');
  return (JSON.parse(readFileSync(file, 'utf8')) as { version: string }).version;
}

if (import.meta.main) {
  const flags = parseArgs(process.argv.slice(2));
  const raw = readRawMeta();
  const catalog = loadCharacters() as unknown as Record<string, { slug: string }>;
  const gameVersion = currentGameVersion();

  let targets = flags.only.length > 0
    ? [...flags.only]
    : flags.all
      ? [...computeGaps({ catalog, raw, currentVersion: gameVersion }).withoutProfile]
      : [];

  if (targets.length === 0) {
    console.error('uso: meta:research:characters (--only <slug,slug> | --all) [--limit N] [--dry-run]');
    process.exitCode = 1;
  } else {
    if (flags.limit !== undefined) targets = targets.slice(0, flags.limit);

    if (flags.dryRun) {
      console.log(`${targets.length} alvo(s), 2 chamadas de API cada:`);
      console.log(`  ${targets.join(', ')}`);
      console.log('Nada foi chamado nem gravado (--dry-run).');
    } else {
      const client = createClient();
      const report = await runBatch({
        targets,
        gameVersion,
        authoredAt: new Date().toISOString().slice(0, 10),
        existing: raw,
        research: (slug) => researchCharacter(slug, { client: client.messages }),
        extract: (slug, text) => extractClaims(slug, text, { client: client.messages as never }),
        write: (draft, io) => writeDraft(draft, io),
        onProgress: (line) => console.log(line),
      });
      console.log(formatBatchReport(report));
    }
  }
}
```

- [ ] **Step 4: Declarar o script**

Em `packages/meta/package.json`, dentro de `scripts`:

```json
    "meta:research:characters": "node scripts/research-characters.ts"
```

- [ ] **Step 5: Rodar os testes e o dry-run**

Run: `pnpm --filter @buer/meta exec vitest run test/research-cli.test.ts`
Expected: PASS (9 testes). Nenhum toca a rede.

Run: `pnpm --filter @buer/meta run meta:research:characters -- --all --limit 5 --dry-run`
Expected: lista 5 alvos e diz que nada foi chamado. **Não exige credencial** — o `--dry-run` sai antes de construir o cliente.

- [ ] **Step 6: Commit**

```bash
git add packages/meta/scripts/research-characters.ts packages/meta/package.json packages/meta/test/research-cli.test.ts
git commit -m "feat(meta): lote de pesquisa de personagens, com recusa, estimativa de custo e dry-run"
```

---

## Task 7: Times — `meta:research:archetypes`, **vários por personagem**

A mesma máquina, alvo diferente, e uma diferença conceitual que vale explicitar: **um personagem não tem um time, tem vários.** Se o Icy Veins descreve uma composição e o Game8 descreve outra, isso não é divergência a resolver — são duas opções, e as duas vão para o banco. Descartar a segunda por "maioria" jogaria fora exatamente a informação que o usuário quer.

Quem ordena a lista para o usuário é o **motor**, não o pipeline: `strength` curada primeiro, depois quanto as builds *daquele jogador* cumprem os alvos daquele time (spec §7.1). O ranking é por conta, não global — e é isso que faz o produto valer mais que uma tier list.

Escopo deliberadamente menor num ponto: o pipeline autora somente slots **nomeados** (`anyOf`, `substitutable: false`), nunca flex. Decidir que um slot é flex — e quais elementos ele tolera — foi exatamente o julgamento que produziu o defeito Critical da revisão final da Fase 2 (geo entrando num Hyperbloom). Slot nomeado errado é visível na hora; slot flex mal autorado é silencioso. O humano converte depois de ler.

**Files:**
- Create: `packages/meta/scripts/research/archetype.ts`, `packages/meta/scripts/research-archetypes.ts`
- Modify: `packages/meta/package.json`
- Test: `packages/meta/test/archetype.test.ts`

**Interfaces:**
- Consumes: `SearchDeps`/`ResearchOutput` (Task 3), `ExtractDeps` (Task 4), `validateMeta`, `SourceId` (Task 2).
- Produces:
  - `buildArchetypePrompt(subject: string): string`
  - `researchArchetypes(subject: string, deps: SearchDeps): Promise<ResearchOutput>`
  - `extractArchetypes(subject: string, text: string, deps: ExtractDeps): Promise<ArchetypeClaims>`
  - `buildArchetypeDrafts(deps: ArchetypeDraftDeps): ArchetypeDraftResult` — **pura**
  - tipos:
    ```ts
    interface TeamOption {
      readonly id: string;
      readonly label: string;
      readonly members: readonly { readonly slug: string; readonly role: readonly string[] }[];
      readonly strength?: string;
      readonly citedBy: readonly SourceId[];
    }
    interface ArchetypeClaims { readonly subject: string; readonly teams: readonly TeamOption[]; readonly sources: readonly string[] }
    interface ArchetypeDraftResult {
      readonly archetypes: readonly RawTeamArchetype[];
      readonly refused: readonly { readonly id: string; readonly because: readonly string[] }[];
    }
    ```

- [ ] **Step 1: Escrever o teste que falha**

Criar `packages/meta/test/archetype.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildArchetypeDrafts, buildArchetypePrompt } from '../scripts/research/archetype.js';
import { validateMeta } from '../src/validate.js';
import { readRawMeta } from '../src/load.js';

const base = { subject: 'xingqiu', gameVersion: '7.0', sources: ['https://icy-veins.com/t', 'https://game8.co/t'] };

const time = (id: string, membros: string[], over: Record<string, unknown> = {}) => ({
  id,
  label: id,
  members: membros.map((slug) => ({ slug, role: ['sub-dps'] })),
  citedBy: ['icy-veins'],
  ...over,
});

describe('buildArchetypePrompt', () => {
  it('pede VÁRIOS times, não o melhor', () => {
    const p = buildArchetypePrompt('xingqiu');
    expect(p).toContain('xingqiu');
    expect(p).toMatch(/todos os times|vários times|cada time/i);
    expect(p).not.toMatch(/o melhor time apenas|somente o melhor/i);
  });

  it('exige o papel de cada membro e proíbe deduzir', () => {
    const p = buildArchetypePrompt('xingqiu');
    expect(p).toMatch(/papel/i);
    expect(p).toMatch(/não invente|omita/i);
  });
});

describe('buildArchetypeDrafts — vários times, nada descartado', () => {
  it('duas composições diferentes viram DOIS arquétipos', () => {
    const claims = { ...base, teams: [time('national', ['xiangling', 'bennett', 'xingqiu']), time('freeze', ['xingqiu', 'kaeya', 'sucrose'])] };
    const d = buildArchetypeDrafts({ claims, ...base });
    expect(d.archetypes.map((a) => a.id)).toEqual(['national', 'freeze']);
  });

  it('fontes diferentes descrevendo a MESMA composição viram um arquétipo só', () => {
    const claims = {
      ...base,
      teams: [
        time('national', ['xiangling', 'bennett', 'xingqiu'], { citedBy: ['icy-veins'] }),
        time('national-alt', ['bennett', 'xingqiu', 'xiangling'], { citedBy: ['game8'] }),
      ],
    };
    const d = buildArchetypeDrafts({ claims, ...base });
    expect(d.archetypes).toHaveLength(1);
  });

  it('monta slots NOMEADOS, nunca flex', () => {
    const claims = { ...base, teams: [time('national', ['xiangling', 'bennett', 'xingqiu'])] };
    const d = buildArchetypeDrafts({ claims, ...base });
    for (const slot of d.archetypes[0]!.slots) {
      expect(slot.substitutable).toBe(false);
      expect(slot.requires.kind).toBe('character');
    }
  });

  it('strength discordante fica na MAIS CONSERVADORA — superestimar é pior', () => {
    const claims = {
      ...base,
      teams: [
        time('t', ['xingqiu', 'b'], { strength: 'meta', citedBy: ['icy-veins'] }),
        time('t2', ['xingqiu', 'b'], { strength: 'niche', citedBy: ['game8'] }),
      ],
    };
    const d = buildArchetypeDrafts({ claims, ...base });
    expect(d.archetypes[0]!.strength).toBe('niche');
  });

  it('strength fora do vocabulário vira niche em vez de lançar', () => {
    const claims = { ...base, teams: [time('t', ['xingqiu', 'b'], { strength: 'S-tier' })] };
    expect(buildArchetypeDrafts({ claims, ...base }).archetypes[0]!.strength).toBe('niche');
  });

  it('RECUSA time com menos de 2 ou mais de 4 membros, sem derrubar os outros', () => {
    const claims = {
      ...base,
      teams: [
        time('solo', ['xingqiu']),
        time('ok', ['xingqiu', 'b', 'c']),
        time('cinco', ['xingqiu', 'b', 'c', 'd', 'e']),
      ],
    };
    const d = buildArchetypeDrafts({ claims, ...base });
    expect(d.archetypes.map((a) => a.id)).toEqual(['ok']);
    expect(d.refused.map((r) => r.id).sort()).toEqual(['cinco', 'solo']);
  });

  it('RECUSA time em que algum membro voltou sem papel', () => {
    const claims = { ...base, teams: [{ ...time('t', ['xingqiu', 'b']), members: [{ slug: 'xingqiu', role: [] }, { slug: 'b', role: ['sub-dps'] }] }] };
    const d = buildArchetypeDrafts({ claims, ...base });
    expect(d.archetypes).toEqual([]);
    expect(d.refused[0]!.because.join(' ')).toMatch(/papel/i);
  });

  it('o time exigido não pode faltar o personagem pesquisado', () => {
    const claims = { ...base, teams: [time('sem-o-sujeito', ['a', 'b', 'c'])] };
    const d = buildArchetypeDrafts({ claims, ...base });
    expect(d.refused[0]!.because.join(' ')).toMatch(/xingqiu/);
  });

  it('cada arquétipo cita só as fontes que o descreveram', () => {
    const claims = {
      ...base,
      teams: [
        time('a', ['xingqiu', 'b'], { citedBy: ['icy-veins'] }),
        time('c', ['xingqiu', 'd'], { citedBy: ['game8', 'genshin-builds'] }),
      ],
    };
    const d = buildArchetypeDrafts({ claims, ...base });
    expect(d.archetypes[0]!.tags).toContain('citado-por:icy-veins');
    expect(d.archetypes[1]!.tags).toContain('citado-por:game8');
  });

  it('o arquétipo montado passa no validateMeta, dadas as fichas dos membros', () => {
    const raw = readRawMeta();
    const claims = {
      subject: 'xingqiu',
      sources: base.sources,
      teams: [{
        id: 'national-pesquisado', label: 'National',
        members: [
          { slug: 'xiangling', role: ['sub-dps'] },
          { slug: 'bennett', role: ['buffer'] },
          { slug: 'xingqiu', role: ['sub-dps'] },
        ],
        strength: 'meta', citedBy: ['icy-veins'] as const,
      }],
    };
    const d = buildArchetypeDrafts({ claims, ...base });
    expect(validateMeta({ profiles: raw.profiles, archetypes: d.archetypes })).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `pnpm --filter @buer/meta exec vitest run test/archetype.test.ts`
Expected: FAIL — `Failed to resolve import "../scripts/research/archetype.js"`.

- [ ] **Step 3: Escrever o arquétipo**

Criar `packages/meta/scripts/research/archetype.ts`:

```ts
// packages/meta/scripts/research/archetype.ts
//
// Pesquisa e montagem de times.
//
// A diferença conceitual em relação à ficha de personagem: um personagem NÃO
// tem um time, tem vários. Fontes descrevendo composições diferentes não estão
// se contradizendo — cada uma é uma opção, e todas vão para o banco. Resolver
// isso por "maioria" descartaria justamente o que o usuário quer ver.
//
// Quem ordena a lista para o usuário é o MOTOR: força curada primeiro, depois
// quanto as builds DAQUELE jogador cumprem os alvos daquele time (spec §7.1).
// O ranking é por conta, não global.
//
// ESCOPO MENOR de propósito: só slots NOMEADOS. Decidir que um slot é flex, e
// quais elementos ele tolera, foi o julgamento que colocou geo dentro de um
// Hyperbloom na revisão final da Fase 2. Slot nomeado errado é visível na hora;
// slot flex mal autorado é silencioso.

import type { RawTeamArchetype } from '../../src/types.js';
import { SOURCE_DOMAINS } from './client.js';
import type { SourceId } from './claims.js';

/** Da mais conservadora para a mais forte. Empate resolve para a primeira. */
const STRENGTH_ORDER = ['niche', 'strong', 'meta'] as const;
const STRENGTHS = new Set<string>(STRENGTH_ORDER);

export interface TeamOption {
  readonly id: string;
  readonly label: string;
  readonly members: readonly { readonly slug: string; readonly role: readonly string[] }[];
  readonly strength?: string;
  readonly citedBy: readonly SourceId[];
}

export interface ArchetypeClaims {
  readonly subject: string;
  readonly teams: readonly TeamOption[];
  readonly sources: readonly string[];
}

export interface ArchetypeDraftDeps {
  readonly claims: ArchetypeClaims;
  readonly subject: string;
  readonly gameVersion: string;
  readonly sources: readonly string[];
}

export interface ArchetypeDraftResult {
  readonly archetypes: readonly RawTeamArchetype[];
  readonly refused: readonly { readonly id: string; readonly because: readonly string[] }[];
}

export function buildArchetypePrompt(subject: string): string {
  return [
    `Pesquise **todos os times** em que o personagem "${subject}" de Genshin Impact é usado,`,
    'nestes três sites e SOMENTE neles:',
    '',
    ...SOURCE_DOMAINS.map((d, i) => `${i + 1}. ${d}`),
    '',
    'Não escolha o melhor time. Liste **cada time** que as fontes descrevem — se uma fonte mostra',
    'uma composição e outra mostra outra, as duas interessam. Elas são opções diferentes, não',
    'versões concorrentes da mesma resposta.',
    '',
    'Para cada time, relate:',
    '- um nome curto pelo qual ele é conhecido (ex.: "National", "Hyperbloom", "Freeze");',
    '- os personagens que o compõem — de 2 a 4, incluindo obrigatoriamente o próprio ' + subject + ';',
    '- o papel de cada membro (main dps, sub dps, buffer, debuffer, healer, shielder, battery, driver, enabler);',
    '- se a fonte trata o time como referência do meta, forte, ou de nicho;',
    '- **quais das três fontes** descrevem esse time, e a URL de cada uma.',
    '',
    'REGRA QUE NÃO PODE SER QUEBRADA: não invente membro nem papel. Se as fontes não deixam claro o',
    'papel de alguém, **omita o papel** dessa pessoa em vez de deduzir pelo elemento ou pela classe.',
  ].join('\n');
}

/** Identidade de uma composição: o CONJUNTO de membros, sem ordem. */
function compositionKey(team: TeamOption): string {
  return [...team.members.map((m) => m.slug)].sort().join('|');
}

function mostConservativeStrength(teams: readonly TeamOption[]): string {
  const declared = teams
    .map((t) => t.strength)
    .filter((s): s is string => s !== undefined && STRENGTHS.has(s));
  if (declared.length === 0) return 'niche';
  // Superestimar um time é conselho errado; subestimar é conselho tímido.
  // A segunda falha é recuperável, a primeira não.
  return STRENGTH_ORDER.find((s) => declared.includes(s)) ?? 'niche';
}

export function buildArchetypeDrafts(deps: ArchetypeDraftDeps): ArchetypeDraftResult {
  const archetypes: RawTeamArchetype[] = [];
  const refused: { id: string; because: readonly string[] }[] = [];

  // Fontes diferentes descrevendo a mesma composição são o MESMO time, ainda
  // que a tenham nomeado diferente ou listado em outra ordem.
  const grouped = new Map<string, TeamOption[]>();
  for (const team of deps.claims.teams) {
    const key = compositionKey(team);
    grouped.set(key, [...(grouped.get(key) ?? []), team]);
  }

  for (const variants of grouped.values()) {
    const primary = variants[0]!;
    const because: string[] = [];

    if (primary.members.length < 2 || primary.members.length > 4) {
      because.push(`um time tem de 2 a 4 membros; a pesquisa deu ${primary.members.length}`);
    }
    if (primary.members.some((m) => m.role.length === 0)) {
      because.push('algum membro voltou sem papel — o slot não teria como casar');
    }
    if (!primary.members.some((m) => m.slug === deps.subject)) {
      because.push(`o time não inclui "${deps.subject}", que é o personagem pesquisado`);
    }

    if (because.length > 0) {
      refused.push({ id: primary.id, because });
      continue;
    }

    const citedBy = [...new Set(variants.flatMap((v) => v.citedBy))];

    archetypes.push({
      schemaVersion: 1,
      id: primary.id,
      label: primary.label,
      gameVersionAdded: deps.gameVersion,
      strength: mostConservativeStrength(variants),
      // A citação vira tag em vez de virar força: quantas fontes mencionam um
      // time é fato verificável; o quanto ele é bom é julgamento, e misturar os
      // dois faria um número contável se passar por opinião curada.
      tags: citedBy.map((s) => `citado-por:${s}`),
      sources: [...deps.sources],
      slots: primary.members.map((m) => ({
        role: [...m.role],
        requires: { kind: 'character' as const, anyOf: [m.slug] },
        substitutable: false,
      })),
    });
  }

  return { archetypes, refused };
}
```

- [ ] **Step 4: Escrever a entrada de CLI**

Criar `packages/meta/scripts/research-archetypes.ts`, com a mesma forma do lote de personagens (`parseArgs`, `runBatch`, `formatBatchReport` reaproveitados por composição), trocando três coisas: `researchArchetypes` no lugar de `researchCharacter`, `extractArchetypes` no lugar de `extractClaims`, e `buildArchetypeDrafts` no lugar de `buildDraft`.

Duas diferenças no laço, porque um alvo agora produz **N** saídas em vez de uma:
- grava um arquivo por arquétipo em `data/archetypes/<id>.json`, e conta cada um separadamente no relatório;
- valida com `validateMeta({ profiles: raw.profiles, archetypes: [...raw.archetypes, ...novos] })` **antes** de escrever qualquer um — um arquétipo que nomeia personagem sem ficha é rejeitado na borda, não descoberto pelo teste depois.

Em `packages/meta/package.json`:

```json
    "meta:research:archetypes": "node scripts/research-archetypes.ts"
```

- [ ] **Step 5: Rodar os testes**

Run: `pnpm --filter @buer/meta exec vitest run` e `pnpm -w test`
Expected: PASS. A suíte inteira do repositório continua verde — nada aqui é importado por runtime.

- [ ] **Step 6: Commit**

```bash
git add packages/meta/scripts/research/archetype.ts packages/meta/scripts/research-archetypes.ts packages/meta/package.json packages/meta/test/archetype.test.ts
git commit -m "feat(meta): pesquisa de times — vários por personagem, slots nomeados, nada descartado"
```

---

## Task 8: A primeira rodada real

Roda o pipeline contra os alvos que a conta de calibração precisa. **Exige credencial e gasta dinheiro** — é decisão do dono do projeto executar.

**Files:**
- Create: `packages/meta/data/characters/*.json` (gerados), `packages/meta/data/research/*.md` (gerados)
- Modify: `docs/STATUS.md`

**Interfaces:** nenhuma. É execução e revisão.

- [ ] **Step 1: Confirmar a credencial sem expor nada**

Run: `ant auth status`
Expected: um perfil ativo, ou `ANTHROPIC_API_KEY` no ambiente. Se nenhum, **pare e peça ao dono do projeto** — não invente chave, não peça a chave em texto.

- [ ] **Step 2: Ver o plano antes de gastar**

```bash
pnpm --filter @buer/meta run meta:research:characters -- --only sandrone,odette,alyosha,qiqi,linnea,zibai,columbina,illuga,durin,varka,nicole,prune --dry-run
```

Expected: 12 alvos, 2 chamadas cada. São os personagens dos três times que a conta tem completos e o banco não conhece (`docs/STATUS.md`, seção "Cobertura conhecida-faltante").

- [ ] **Step 3: Rodar de verdade, em duas levas**

```bash
pnpm --filter @buer/meta run meta:research:characters -- --only sandrone,odette,alyosha,qiqi --limit 4
```

**Pare e leia o relatório antes da segunda leva.** Custo estimado da primeira leva: em torno de US$ 1,50 (≈US$ 0,35 por personagem, com 2 chamadas de ~15k entrada / ~10k saída cada). Se o número real destoar muito, algo está errado no prompt ou no laço de retomada — investigue antes de multiplicar por 12.

Depois:

```bash
pnpm --filter @buer/meta run meta:research:characters -- --only linnea,zibai,columbina,illuga,durin,varka,nicole,prune
```

- [ ] **Step 4: Ler os rascunhos, não só aceitar**

Para cada ficha gravada, abra o par:
- `packages/meta/data/characters/<slug>.json` — o que a ficha afirma;
- `packages/meta/data/research/<slug>.md` — o que as fontes disseram.

Procure: `notes` com divergência (é o campo que diz onde as fontes brigaram); `confidence: "low"` (esperado onde houve divergência); `targets` vazio (significa que nenhuma fonte justificou o limiar de ER — correto, não bug). **Não promova nenhuma para `researched-reviewed` nesta tarefa** — a promoção é decisão de quem conhece o jogo, e é o passo seguinte, não este.

- [ ] **Step 5: Rodar a suíte e o produto**

Run: `pnpm -w test`
Expected: PASS. Se um caso-âncora quebrar, **a ficha nova é que está errada** — leia qual âncora e corrija ou remova a ficha; não afrouxe a âncora.

Run:
```bash
pnpm --filter @buer/cli run start:dev analyze --from "<caminho absoluto da extração>" --character sandrone
```
Expected: a Sandrone deixa de dizer "ainda sem ficha curada" e passa a mostrar veredito de build. Ainda nao tera time ate voce rodar o lote de arquetipos:

```bash
pnpm --filter @buer/meta run meta:research:archetypes -- --only sandrone,linnea,durin
```

Ele pesquisa TODOS os times de cada um dos tres — nao so o que voce me descreveu — entao espere mais de tres arquetipos na saida. Compare com os tres que voce nomeou em `docs/STATUS.md`: se o pipeline nao achar algum deles, isso e sinal sobre as fontes, nao sobre a sua conta.

- [ ] **Step 6: Atualizar o STATUS e commitar**

Em `docs/STATUS.md`, na seção "Cobertura conhecida-faltante", registre quantas das 12 fichas foram gravadas, quantas foram recusadas e por quê, e quantas saíram com `confidence: "low"`. É o dado que diz se o pipeline funciona ou se o prompt precisa de outra volta.

```bash
git add packages/meta/data docs/STATUS.md
git commit -m "feat(meta): primeira leva pesquisada — 12 personagens dos três times que faltavam"
```

---

## Auto-revisão do plano

**1. Cobertura da §10 da spec**

| Requisito da §10 | Tarefa |
|---|---|
| `meta:gaps` cruza catálogo × dado, é o gatilho de patch novo | 1 |
| `meta:research:characters` escreve rascunhos de `CharacterProfile` | 6 |
| `meta:research:archetypes` idem para `TeamArchetype` | 7 |
| Pesquisa é API da Anthropic com busca web, não scraper | 3 |
| Saída estruturada validada contra o schema | 4 (Zod) + 5 (`validateMeta` antes de gravar) |
| Rascunho nasce `authoredBy: 'researched'` | 5 |
| `sources` com as URLs | 3 (colhe) → 2 (propaga) → 5 (grava) |
| Revisão humana é o portão; promoção é diff de uma linha | 5 (nunca produz `high`) + 8 (Step 4 proíbe promover) |
| Custa dinheiro e exige chave; é custo de autoria | 6 (estimativa, `--dry-run`) + 8 (duas levas, leia entre elas) |
| A rodada não é reproduzível; a ficha commitada é | 5 (`authoredAt` injetado, nunca `new Date()` no caminho puro) |
| **Decisão nova desta sessão:** confiança por concordância entre as três fontes | 2 (pura, 16 testes) |
| **Correção do dono do projeto:** divergência em campo de LISTA é alternativa, não contradição | 2 (`mergeRanked`) |
| **Correção do dono do projeto:** um personagem tem VÁRIOS times, e todos vão para o banco | 7 (`buildArchetypeDrafts`) |

**Lacuna assumida:** o pipeline produz **uma variante** por ficha (`principal`), enquanto o schema suporta N. Reconciliar variantes entre fontes é um problema mais difícil — os três sites estruturam builds de formas diferentes, e casar "Xiangling ER" do Icy Veins com "Xiangling Vaporize" do Game8 exigiria julgamento que este pipeline não tem. Uma variante bem fundamentada é melhor que três inventadas; o revisor humano divide. Registrado aqui para não sumir.

**2. Varredura de placeholder** — sem `TBD`, sem "implemente depois". A Task 7 Step 4 descreve a entrada de CLI por composição em vez de repetir 80 linhas idênticas às da Task 6: as três substituições estão nomeadas e as funções que entram já existem com assinatura definida nas Tasks 3-5.

**3. Consistência de tipos** — verificada entre tarefas:
- `SourceClaim` / `CharacterClaims` / `Divergence` / `ReconcileResult` definidos uma vez em `claims.ts` (Task 2), consumidos em 4, 5, 6.
- `erWhy` declarado em `SourceClaim` (Task 2), preenchido pela extração (Task 4), consumido por `preferredWhy` (Task 5). Não entra em `SIMPLE_FIELDS` da reconciliação — é intencional e está comentado no tipo.
- `ResearchOutput` produzido pela Task 3, consumido pelas Tasks 6 e 8.
- `DraftResult` produzido pela Task 5, consumido pela Task 6.
- `buildCatalogs()` / `normalizeClaim()` exportados na Task 4, usados por 4 e 7.
- `computeGaps()` da Task 1 é o que alimenta `--all` na Task 6.
- `SOURCE_DOMAINS` (Task 3) e `SOURCE_IDS` (Task 2) são as duas listas de fontes, e a ordem de ambas é a preferência decidida em `docs/STATUS.md` — se uma mudar, a outra muda junto.

