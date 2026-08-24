# OneWash Fase 1 — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar o extrator (CLI) que puxa dados de conta de Genshin do HoYoLAB e os envia a um site multi-usuário que os exibe por personagem, com o esqueleto de interfaces do motor de análise pronto para o segundo ciclo.

**Architecture:** Monorepo pnpm+Turborepo com fronteiras por volatilidade. A CLI é "burra": obtém a sessão do navegador, chama a API do HoYoLAB e envia o **payload cru**. O servidor é a autoridade da normalização: valida o token, grava o cru, normaliza com código compartilhado de `packages/core`, e persiste snapshots versionados content-addressed em Postgres. O site lê a projeção normalizada via Server Components.

**Tech Stack:** TypeScript, pnpm workspaces, Turborepo, Vitest, Zod v4, Next.js 16 (App Router), Better Auth + plugin API Key, Drizzle 0.45, Neon (Postgres), Cloudflare R2, Playwright (navegador embutido), tsdown (bundle da CLI), Changesets.

**Spec:** `docs/superpowers/specs/2026-08-24-onewash-design.md` — o plano argumenta a partir da spec; executores leem os dois.

## Global Constraints

Requisitos do projeto inteiro — cada tarefa os herda implicitamente:

- **Runtime:** Node.js 24 LTS. TypeScript em modo `strict`. ESM em todos os pacotes.
- **Monorepo:** pnpm workspaces. `apps/{web,cli}` + `packages/{core,hoyolab,gi-data,cookies,db,engine}`. `workspace:*` para deps internas.
- **Versões fixadas:** Zod `^4`, Drizzle ORM `0.45.x` estável (não v1 RC), Next.js `16.x`, Better Auth `^1.7` com plugin `@better-auth/api-key`, Vitest `^2`.
- **Segredos nunca em disco nem em log:** o cookie do HoYoLAB é usado e descartado, nunca gravado. Cookie e token nunca aparecem em log, erro ou stack trace, nem truncados. Vale como teste.
- **Repo público:** fixtures passam por scrubber antes de commit; pre-commit hook barra `ltoken_v2`, `ltuid_v2`, `cookie_token_v2`.
- **API do HoYoLAB:** cookies só `ltoken_v2`+`ltuid_v2`; header `x-rpc-language: pt-pt` obrigatório; base URL configurável; parser tolera corpo não-JSON e campos novos.
- **Token da API OneWash:** prefixo `ow_live_`, SHA-256 armazenado, escopo único `snapshots:write`, mostrado uma vez.
- **Idioma:** o HoYoLAB usa código `pt-pt` para conteúdo pt-BR. `account.lang` default `'pt-pt'`, com `CHECK (lang <> 'pt-br')`.
- **Substat CRIT DMG 5★ tem 4 tiers: 5.44 / 6.22 / 6.99 / 7.77** (não 3).
- **TDD:** cada tarefa começa por um teste que falha. Commits frequentes. CI nunca toca a API real do HoYoLAB (replay/fixtures).

---

## Estrutura de arquivos (mapa de decomposição)

```
onewash/
  package.json              workspace root (scripts turbo, pnpm)
  pnpm-workspace.yaml
  turbo.json
  tsconfig.base.json
  vitest.workspace.ts
  .changeset/
  .husky/pre-commit         guarda de segredo
  packages/
    core/
      src/
        keys.ts             branded keys + helpers (CharacterKey, char_key composto do Traveler)
        domain.ts           tipos de domínio (Roster, Build, CharacterInstance, ArtifactPiece...)
        protocol.ts         schemas Zod do envelope de ingest (cru) + versão
        canon.ts            forma canônica doc_canon + content hash (§5.5)
        substat.ts          reconstrução (valor,times)→tiers + tabelas de tier
        normalize.ts        raw HoYoLAB → { snapshotDoc, characterDocs } (puro)
        scrub.ts            anonimização de fixtures (UID/nickname)
        index.ts
      test/
        fixtures/           payloads crus anonimizados (*.json)
        *.test.ts
    hoyolab/
      src/
        ds.ts               geração de DS1 (determinística)
        client.ts           getUserGameRolesByCookie → list → detail
        types.ts            tipos crus da resposta
        config.ts           base URL configurável
        index.ts
      test/
    cookies/
      src/
        provider.ts         interface SessionProvider + cadeia de fallback
        firefox.ts          leitura de cookies.sqlite
        paste.ts            --cookie manual
        embedded.ts         navegador embutido (Playwright)
        index.ts
      test/fixtures/cookies.sqlite
    gi-data/
      scripts/sync.ts       gera os mapas + catálogo a partir de fontes vendorizadas
      scripts/assets-sync.ts  espelha imagens no R2
      data/                 saída gerada (property map, weapon_type, catálogo, id→slug)
      src/index.ts          loader tipado dos dados gerados
    db/
      src/
        schema/catalog.ts   catalog.* (Drizzle)
        schema/app.ts       app.* (Drizzle)
        schema/index.ts
        client.ts           cliente pooled (app) + direto (migrations)
        ingest.ts           gravação transacional de snapshot (dedupe, advisory lock, timeline)
      drizzle/              migrations SQL geradas
      drizzle.config.ts
    engine/
      src/
        interfaces.ts       todos os contratos (§6)
        null-evaluator.ts   implementação nula
        index.ts
      test/contract.test.ts suíte de contrato
  apps/
    cli/
      src/
        index.ts            entrypoint (bin)
        commands/{login,logout,whoami,sync,doctor}.ts
        config.ts           ~/.genshin/config.json (perm restrita)
        api.ts              cliente do /api/ingest
      test/
    web/
      app/
        (marketing)/page.tsx
        api/auth/[...all]/route.ts
        api/ingest/route.ts
        api/img/[hash]/route.ts
        onboarding/page.tsx
        characters/page.tsx
        characters/[key]/page.tsx
        history/page.tsx
      lib/{auth.ts,db.ts,render.ts}
      test/
```

---

## Marco 0 — Fundação do monorepo

### Task 0.1: Scaffold do workspace

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `vitest.workspace.ts`, `.changeset/config.json`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`
- Test: `packages/core/test/smoke.test.ts`

**Interfaces:**
- Consumes: nada (primeira tarefa)
- Produces: workspace com `pnpm test` (turbo → vitest) funcionando; base tsconfig `strict` + ESM que os outros pacotes estendem.

- [ ] **Step 1: Escrever o teste de fumaça**

```ts
// packages/core/test/smoke.test.ts
import { describe, it, expect } from 'vitest';
describe('workspace', () => {
  it('roda vitest via turbo', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar (sem toolchain ainda)**

Run: `pnpm test`
Expected: FAIL — comando `pnpm`/`turbo` não configurado ou pacote inexistente.

- [ ] **Step 3: Criar a configuração do workspace**

`pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
  - "apps/*"
```

`package.json` (root):
```json
{
  "name": "onewash",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@9",
  "scripts": {
    "build": "turbo run build",
    "test": "turbo run test",
    "typecheck": "turbo run typecheck",
    "lint": "turbo run lint"
  },
  "devDependencies": {
    "turbo": "^2.10",
    "typescript": "^5.6",
    "vitest": "^2",
    "@changesets/cli": "^3"
  }
}
```

`turbo.json`:
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "test": { "dependsOn": ["^build"] },
    "typecheck": { "dependsOn": ["^build"] },
    "lint": {}
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "declaration": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true
  }
}
```

`vitest.workspace.ts`:
```ts
export default ['packages/*', 'apps/*'];
```

`.changeset/config.json`:
```json
{ "$schema": "https://unpkg.com/@changesets/config/schema.json",
  "changelog": "@changesets/cli/changelog", "commit": false,
  "access": "restricted", "baseBranch": "main" }
```

`packages/core/package.json`:
```json
{
  "name": "@onewash/core",
  "version": "0.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "devDependencies": { "vitest": "^2", "typescript": "^5.6" }
}
```

`packages/core/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src", "test"] }
```

Criar `packages/core/src/index.ts` vazio (`export {};`).

- [ ] **Step 4: Instalar e rodar**

Run: `pnpm install && pnpm test`
Expected: PASS — o teste de fumaça passa.

- [ ] **Step 5: Guarda de segredo (pre-commit)**

`.husky/pre-commit`:
```bash
#!/usr/bin/env sh
if git diff --cached --name-only -z | xargs -0 grep -lE 'ltoken_v2=|ltuid_v2=|cookie_token_v2=' 2>/dev/null; then
  echo "ERRO: possível cookie do HoYoLAB no diff. Aborte e remova o segredo." >&2
  exit 1
fi
```
Instalar husky (`pnpm add -D -w husky && pnpm husky init`) e substituir o hook gerado por este.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold do monorepo (pnpm+turbo+vitest) e guarda de segredo"
```

---

## Marco 1 — `packages/core` (o coração puro)

### Task 1.1: Branded keys e resolução do Traveler

**Files:**
- Create: `packages/core/src/keys.ts`
- Test: `packages/core/test/keys.test.ts`

**Interfaces:**
- Consumes: nada
- Produces:
  - `type CharacterKey = string & { __brand:'CharacterKey' }` (idem WeaponKey, ArtifactSetKey)
  - `charKey(avatarId: number, element?: Element): CharacterKey` — retorna `'10000005:pyro'` para o Traveler (avatarId 10000005/10000007) e `'10000089'` para os demais.
  - `parseCharKey(k: CharacterKey): { avatarId: number; element?: Element }`
  - `type Element = 'pyro'|'hydro'|'cryo'|'electro'|'anemo'|'geo'|'dendro'`

- [ ] **Step 1: Teste que falha**

```ts
import { describe, it, expect } from 'vitest';
import { charKey, parseCharKey } from '../src/keys.js';

describe('charKey', () => {
  it('não-Traveler usa só o avatarId', () => {
    expect(charKey(10000089)).toBe('10000089');
  });
  it('Traveler exige elemento e compõe', () => {
    expect(charKey(10000005, 'pyro')).toBe('10000005:pyro');
    expect(charKey(10000007, 'electro')).toBe('10000007:electro');
  });
  it('Traveler sem elemento lança', () => {
    expect(() => charKey(10000005)).toThrow();
  });
  it('roundtrip', () => {
    expect(parseCharKey(charKey(10000005, 'geo'))).toEqual({ avatarId: 10000005, element: 'geo' });
    expect(parseCharKey(charKey(10000089))).toEqual({ avatarId: 10000089 });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @onewash/core test keys`
Expected: FAIL — `keys.js` não existe.

- [ ] **Step 3: Implementar**

```ts
// packages/core/src/keys.ts
export type Element = 'pyro'|'hydro'|'cryo'|'electro'|'anemo'|'geo'|'dendro';
export type CharacterKey = string & { readonly __brand: 'CharacterKey' };
export type WeaponKey = string & { readonly __brand: 'WeaponKey' };
export type ArtifactSetKey = string & { readonly __brand: 'ArtifactSetKey' };

const TRAVELER_IDS = new Set([10000005, 10000007]);

export function charKey(avatarId: number, element?: Element): CharacterKey {
  if (TRAVELER_IDS.has(avatarId)) {
    if (!element) throw new Error(`Traveler ${avatarId} exige elemento`);
    return `${avatarId}:${element}` as CharacterKey;
  }
  return String(avatarId) as CharacterKey;
}

export function parseCharKey(k: CharacterKey): { avatarId: number; element?: Element } {
  const [id, el] = k.split(':');
  return el ? { avatarId: Number(id), element: el as Element } : { avatarId: Number(id) };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @onewash/core test keys`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/keys.ts packages/core/test/keys.test.ts
git commit -m "feat(core): branded keys e resolução de char_key do Traveler"
```

### Task 1.2: Tabelas de tier de substat e reconstrução

**Files:**
- Create: `packages/core/src/substat.ts`
- Test: `packages/core/test/substat.test.ts`

**Interfaces:**
- Consumes: nada
- Produces:
  - `reconstructTiers(rarity: 3|4|5, key: StatKey, displayValue: number, times: number): (1|2|3|4)[]` — dado o valor exibido e o número de rolls, devolve os tiers exatos (bijeção). Lança se não houver combinação.
  - `type StatKey` (a união da spec §6.1).
  - As tabelas de tier embarcadas (subset necessário; fonte: Enka `affixes.json`).

- [ ] **Step 1: Teste que falha (inclui o caso CRIT DMG 5★ de 4 tiers)**

```ts
import { describe, it, expect } from 'vitest';
import { reconstructTiers } from '../src/substat.js';

describe('reconstructTiers', () => {
  it('CRIT DMG 5★ tem 4 tiers: 5.44 6.22 6.99 7.77', () => {
    // 1 roll no tier mais baixo
    expect(reconstructTiers(5, 'critDMG_', 5.4, 1)).toEqual([1]);
    // 2 rolls: 6.99 + 7.77 = 14.8 (arredonda p/ 14.8)
    expect(reconstructTiers(5, 'critDMG_', 14.8, 2)).toEqual([3, 4]);
  });
  it('lança quando não há combinação de `times` rolls que bate o valor', () => {
    expect(() => reconstructTiers(5, 'critDMG_', 99, 1)).toThrow();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @onewash/core test substat`
Expected: FAIL — `substat.js` não existe.

- [ ] **Step 3: Implementar (tabelas + busca de combinação)**

```ts
// packages/core/src/substat.ts
export type Element = import('./keys.js').Element;
export type StatKey =
  | 'hp'|'hp_'|'atk'|'atk_'|'def'|'def_'|'eleMas'|'enerRech_'
  | 'critRate_'|'critDMG_'|'heal_'|'shield_'
  | `${Element}_dmg_`|'physical_dmg_'|'dmg_';

// Valores de roll por raridade → stat → tiers (Enka affixes.json). Subset 5★ aqui;
// o script gi-data pode gerar o arquivo completo. CRIT DMG 5★ = 4 tiers.
const TIERS: Partial<Record<3|4|5, Partial<Record<StatKey, number[]>>>> = {
  5: {
    critDMG_: [5.44, 6.22, 6.99, 7.77],
    critRate_: [2.72, 3.11, 3.50, 3.89],
    atk_: [4.08, 4.66, 5.25, 5.83],
    hp_: [4.08, 4.66, 5.25, 5.83],
    def_: [5.10, 5.83, 6.56, 7.29],
    enerRech_: [4.53, 5.18, 5.83, 6.48],
    eleMas: [16.32, 18.65, 20.98, 23.31],
    hp: [209.13, 239.00, 268.88, 298.75],
    atk: [13.62, 15.56, 17.51, 19.45],
    def: [16.20, 18.52, 20.83, 23.15],
  },
};

/** Busca uma multiseleção de `times` tiers (com repetição) cuja soma arredondada = displayValue. */
export function reconstructTiers(
  rarity: 3|4|5, key: StatKey, displayValue: number, times: number
): (1|2|3|4)[] {
  const table = TIERS[rarity]?.[key];
  if (!table) throw new Error(`sem tabela de tier para ${rarity}★ ${key}`);
  const round = (n: number) => Math.round(n * 10) / 10;
  const target = round(displayValue);
  const result: (1|2|3|4)[] = [];
  const dfs = (idx: number, left: number, sum: number): boolean => {
    if (left === 0) return round(sum) === target;
    for (let t = idx; t < table.length; t++) {
      result.push((t + 1) as 1|2|3|4);
      if (dfs(t, left - 1, sum + table[t]!)) return true;
      result.pop();
    }
    return false;
  };
  if (!dfs(0, times, 0)) throw new Error(`sem combinação de ${times} rolls p/ ${key}=${displayValue}`);
  return [...result];
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @onewash/core test substat`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/substat.ts packages/core/test/substat.test.ts
git commit -m "feat(core): reconstrução de tiers de substat (CRIT DMG 5★ = 4 tiers)"
```

### Task 1.3: Forma canônica e content hash

**Files:**
- Create: `packages/core/src/canon.ts`
- Test: `packages/core/test/canon.test.ts`

**Interfaces:**
- Consumes: nada
- Produces:
  - `type CharacterDoc` — a forma da §5.5 (`{v,char,lvl,asc,cons,friend,weapon,talents,artifacts[]}`).
  - `canonBytes(doc: CharacterDoc): Uint8Array` — serialização canônica determinística (chaves ordenadas lexicograficamente, sem nulls, sem espaços, números com casas fixas).
  - `contentHash(doc: CharacterDoc): string` — `sha256(canonBytes)` em hex.
  - `artifactFingerprint(a): string` — `set:slot:main:subs ordenados com tier`.
  - `accountHash(pairs: {charKey:string; contentHash:string}[]): string`.

- [ ] **Step 1: Teste que falha (estabilidade e independência de ordem de entrada)**

```ts
import { describe, it, expect } from 'vitest';
import { canonBytes, contentHash } from '../src/canon.js';

const doc = {
  v: 1 as const, char: '10000089', lvl: 90, asc: 6, cons: 2, friend: 10,
  weapon: { id: 13509, lvl: 90, promote: 6, refine: 1 },
  talents: [[10097, 10], [10098, 9]] as [number, number][],
  artifacts: [],
};

describe('canon', () => {
  it('é determinística e independe da ordem das chaves de entrada', () => {
    const a = contentHash(doc);
    const shuffled = { artifacts: [], cons: 2, char: '10000089', v: 1 as const,
      weapon: { refine: 1, id: 13509, lvl: 90, promote: 6 },
      talents: [[10097,10],[10098,9]] as [number,number][], lvl: 90, asc: 6, friend: 10 };
    expect(contentHash(shuffled)).toBe(a);
  });
  it('não contém espaços nem chaves fora de ordem', () => {
    const s = new TextDecoder().decode(canonBytes(doc));
    expect(s).not.toMatch(/: /);
    expect(s.indexOf('"asc"')).toBeLessThan(s.indexOf('"char"'));
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @onewash/core test canon`
Expected: FAIL — `canon.js` não existe.

- [ ] **Step 3: Implementar (ordenação recursiva estável)**

```ts
// packages/core/src/canon.ts
import { createHash } from 'node:crypto';

export interface CanonArtifact {
  slot: 1|2|3|4|5; set: number; lvl: number; rarity: 3|4|5;
  main: [number, number]; subs: [number, number, 1|2|3|4][]; fp: string;
}
export interface CharacterDoc {
  v: 1; char: string; lvl: number; asc: number; cons: number; friend: number;
  weapon: { id: number; lvl: number; promote: number; refine: number };
  talents: [number, number][]; artifacts: CanonArtifact[];
}

function canonValue(v: unknown): string {
  if (v === null) throw new Error('canon: null não permitido');
  if (Array.isArray(v)) return `[${v.map(canonValue).join(',')}]`;
  if (typeof v === 'object') {
    const keys = Object.keys(v as object).sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${canonValue((v as any)[k])}`).join(',')}}`;
  }
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(1);
  return JSON.stringify(v);
}

export function canonBytes(doc: CharacterDoc): Uint8Array {
  return new TextEncoder().encode(canonValue(doc));
}
export function contentHash(doc: CharacterDoc): string {
  return createHash('sha256').update(canonBytes(doc)).digest('hex');
}
export function artifactFingerprint(a: Omit<CanonArtifact,'fp'>): string {
  const subs = [...a.subs].sort((x, y) => x[0] - y[0])
    .map(([p, , t]) => `${p}x${t}`).join(',');
  return `${a.set}:${a.slot}:${a.main[0]}:${subs}`;
}
export function accountHash(pairs: { charKey: string; contentHash: string }[]): string {
  const sorted = [...pairs].sort((a, b) => a.charKey.localeCompare(b.charKey));
  const h = createHash('sha256');
  for (const p of sorted) h.update(p.charKey).update('\0').update(p.contentHash).update('\n');
  return h.digest('hex');
}
```

> Nota: a decimais por `prop_id` da spec (§5.1 `catalog.property.decimals`) refina o `toFixed(1)`
> quando o gi-data existir. Por ora, 1 casa cobre todos os stats de personagem/artefato.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @onewash/core test canon`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/canon.ts packages/core/test/canon.test.ts
git commit -m "feat(core): forma canônica determinística + content/account hash"
```

### Task 1.4: Schemas Zod do protocolo de ingest

**Files:**
- Create: `packages/core/src/protocol.ts`
- Test: `packages/core/test/protocol.test.ts`

**Interfaces:**
- Consumes: nada
- Produces:
  - `IngestEnvelope` (Zod) — o corpo do `POST /api/ingest`: `{ protocolVersion, cliVersion, takenAt, account:{gameUid,region,nickname,lang}, raw:{ list:unknown, detail:unknown } }`. `raw.*` é `z.unknown()` (o servidor normaliza; o schema só garante o envelope).
  - `type IngestEnvelope = z.infer<...>`
  - `PROTOCOL_VERSION = 1`

- [ ] **Step 1: Teste que falha**

```ts
import { describe, it, expect } from 'vitest';
import { IngestEnvelope, PROTOCOL_VERSION } from '../src/protocol.js';

const good = {
  protocolVersion: PROTOCOL_VERSION, cliVersion: '0.1.0', takenAt: new Date().toISOString(),
  account: { gameUid: '800000000', region: 'os_asia', nickname: 'X', lang: 'pt-pt' },
  raw: { list: { list: [] }, detail: { list: [] } },
};

describe('IngestEnvelope', () => {
  it('aceita envelope válido', () => {
    expect(IngestEnvelope.safeParse(good).success).toBe(true);
  });
  it('rejeita lang pt-br', () => {
    const bad = { ...good, account: { ...good.account, lang: 'pt-br' } };
    expect(IngestEnvelope.safeParse(bad).success).toBe(false);
  });
  it('rejeita envelope sem raw', () => {
    const { raw, ...bad } = good;
    expect(IngestEnvelope.safeParse(bad).success).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @onewash/core test protocol`
Expected: FAIL — `protocol.js` não existe.

- [ ] **Step 3: Implementar**

```ts
// packages/core/src/protocol.ts
import { z } from 'zod';
export const PROTOCOL_VERSION = 1 as const;

export const IngestEnvelope = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  cliVersion: z.string().min(1),
  takenAt: z.iso.datetime(),
  account: z.object({
    gameUid: z.string().min(1),
    region: z.enum(['os_usa', 'os_euro', 'os_asia', 'os_cht']),
    nickname: z.string().nullable().optional(),
    lang: z.string().refine((l) => l !== 'pt-br', 'use pt-pt, não pt-br'),
  }),
  raw: z.object({ list: z.unknown(), detail: z.unknown() }),
});
export type IngestEnvelope = z.infer<typeof IngestEnvelope>;
```

Adicionar `zod: ^4` às deps de `packages/core`.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @onewash/core test protocol`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/protocol.ts packages/core/test/protocol.test.ts packages/core/package.json
git commit -m "feat(core): schema Zod do envelope de ingest"
```

### Task 1.5: Scrubber de fixtures

**Files:**
- Create: `packages/core/src/scrub.ts`
- Test: `packages/core/test/scrub.test.ts`

**Interfaces:**
- Consumes: nada
- Produces:
  - `scrubRaw(raw: unknown): unknown` — substitui recursivamente qualquer valor sob as chaves `nickname`, `game_uid`/`gameUid`/`uid`/`role_id`, `ltoken_v2`, `ltuid_v2` por valores fixos anonimizados; preserva o resto. Idempotente.

- [ ] **Step 1: Teste que falha (o scrubber DEVE remover UID/nickname, e ser testado — repo público)**

```ts
import { describe, it, expect } from 'vitest';
import { scrubRaw } from '../src/scrub.js';

describe('scrubRaw', () => {
  it('anonimiza uid e nickname em qualquer profundidade', () => {
    const dirty = { data: { role_id: '812345678', nickname: 'RealName', list: [{ level: 90 }] } };
    const clean = scrubRaw(dirty) as any;
    expect(clean.data.role_id).toBe('800000000');
    expect(clean.data.nickname).toBe('Traveler');
    expect(clean.data.list[0].level).toBe(90); // dado de jogo intacto
  });
  it('remove qualquer resquício de cookie', () => {
    const clean = JSON.stringify(scrubRaw({ ltoken_v2: 'v2_secret', ltuid_v2: '999' }));
    expect(clean).not.toContain('v2_secret');
    expect(clean).not.toContain('999');
  });
  it('é idempotente', () => {
    const once = scrubRaw({ nickname: 'A' });
    expect(scrubRaw(once)).toEqual(once);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @onewash/core test scrub`
Expected: FAIL — `scrub.js` não existe.

- [ ] **Step 3: Implementar**

```ts
// packages/core/src/scrub.ts
const REPLACERS: Record<string, unknown> = {
  nickname: 'Traveler',
  game_uid: '800000000', gameUid: '800000000', uid: '800000000', role_id: '800000000',
  ltoken_v2: 'SCRUBBED', ltuid_v2: '0',
};
export function scrubRaw(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(scrubRaw);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      out[k] = k in REPLACERS ? REPLACERS[k] : scrubRaw(val);
    }
    return out;
  }
  return v;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @onewash/core test scrub`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/scrub.ts packages/core/test/scrub.test.ts
git commit -m "feat(core): scrubber de fixtures (anonimiza UID/nickname/cookie)"
```

### Task 1.6: Normalizador (raw HoYoLAB → docs)

**Files:**
- Create: `packages/core/src/normalize.ts`, `packages/core/src/domain.ts`, `packages/core/src/index.ts`
- Create: `packages/core/test/fixtures/detail.sample.json` (payload anonimizado — gerado no spike 1, passado por `scrubRaw`)
- Test: `packages/core/test/normalize.test.ts`

**Interfaces:**
- Consumes: `charKey` (1.1), `reconstructTiers` (1.2), `canonBytes`/`contentHash`/`artifactFingerprint` (1.3), `CharacterDoc`/`CanonArtifact` (1.3).
- Produces:
  - `normalize(raw: { list: unknown; detail: unknown }): NormalizedSnapshot`
  - `interface NormalizedSnapshot { characters: { charKey: string; doc: CharacterDoc; contentHash: string; promoted: PromotedCols }[]; accountHash: string }`
  - `interface PromotedCols { charLevel:number; ascension:number; constellation:number; weaponId:number; weaponRefine:number }`
  - Mapa de `weapon_type` HoYoLAB (`1,10,11,12,13`) e o mapa de `property_type`→canônico (subset embarcado; gi-data gera o completo depois).

- [ ] **Step 1: Teste que falha (contra fixture real anonimizado)**

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { normalize } from '../src/normalize.js';

const raw = {
  list: { list: [{ id: 10000089, weapon: { id: 13509 } }] },
  detail: JSON.parse(readFileSync(new URL('./fixtures/detail.sample.json', import.meta.url), 'utf8')),
};

describe('normalize', () => {
  it('produz um doc por personagem com hash estável', () => {
    const r1 = normalize(raw);
    const r2 = normalize(raw);
    expect(r1.characters.length).toBeGreaterThan(0);
    expect(r1.accountHash).toBe(r2.accountHash); // determinístico
  });
  it('só inclui talentos de skill_type 1 (Normal/Skill/Burst)', () => {
    const c = normalize(raw).characters[0]!;
    expect(c.doc.talents.length).toBeLessThanOrEqual(3);
  });
  it('artefatos carregam fingerprint sintético', () => {
    const c = normalize(raw).characters.find(c => c.doc.artifacts.length > 0);
    if (c) expect(c.doc.artifacts[0]!.fp).toMatch(/^\d+:\d+:\d+:/);
  });
  it('reconstrói substats como tiers, não valor exibido', () => {
    const c = normalize(raw).characters.find(c => c.doc.artifacts.length > 0);
    if (c) for (const s of c.doc.artifacts[0]!.subs) expect(s[2]).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Gerar a fixture (a partir do payload do spike 1) e rodar o teste**

Após o spike 1 produzir um `detail` real, salvá-lo como `test/fixtures/detail.sample.json` **passado por `scrubRaw`**. Rodar:
Run: `pnpm --filter @onewash/core test normalize`
Expected: FAIL — `normalize.js` não existe.

- [ ] **Step 3: Implementar o normalizador**

```ts
// packages/core/src/normalize.ts
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
```

Criar `src/index.ts` re-exportando keys, canon, substat, protocol, normalize, scrub, domain.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @onewash/core test`
Expected: PASS (todos os testes de core)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src packages/core/test
git commit -m "feat(core): normalizador raw HoYoLAB → docs canônicos"
```

---

## Marco 2 — `packages/engine` (esqueleto)

### Task 2.1: Interfaces do motor

**Files:**
- Create: `packages/engine/package.json`, `packages/engine/tsconfig.json`, `packages/engine/src/interfaces.ts`, `packages/engine/src/index.ts`
- Test: `packages/engine/test/interfaces.test.ts` (só typecheck — sem runtime)

**Interfaces:**
- Consumes: tipos de `@onewash/core` (Element, keys, StatKey, ArtifactPiece etc.)
- Produces: todos os contratos da spec §6 — `BuildEvaluator`, `PreparedEvaluator`, `EvaluatorCapabilities`, `EvaluationContext`, `Score`, `Provenance`, `BuildSearcher`, `TeamSearcher`, `TeamEvaluator`, `RosterAdvisor`, `GameDataProvider`, `EvaluatorRegistry`, `GoodCodec`, e os tipos de apoio (Objective, Constraint, TeamComposition, EnemyProfile, RotationRef, HitMode, AbilityRef, ReactionPremise, etc.).

- [ ] **Step 1: Teste que falha (compilação de um consumidor fictício das interfaces)**

```ts
// packages/engine/test/interfaces.test.ts
import { describe, it, expectTypeOf } from 'vitest';
import type { BuildEvaluator, EvaluationContext, Score } from '../src/interfaces.js';

describe('interfaces', () => {
  it('BuildEvaluator tem a forma esperada', () => {
    expectTypeOf<BuildEvaluator['id']>().toEqualTypeOf<string>();
    expectTypeOf<BuildEvaluator['canHandle']>().parameter(0).toEqualTypeOf<EvaluationContext>();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @onewash/engine test`
Expected: FAIL — `interfaces.js` não existe.

- [ ] **Step 3: Copiar as interfaces da spec §6.1–§6.7**

Transcrever verbatim os blocos TypeScript da spec §6 para `src/interfaces.ts`, importando de `@onewash/core` os tipos que já existem (`Element`, `CharacterKey`, `WeaponKey`, `ArtifactSetKey`, `ArtifactSlot`, `StatKey`, `ArtifactPiece`, `WeaponInstance`, `CharacterInstance`, `Roster`, `Substat`). Definir localmente os que são só do motor. `package.json` depende de `@onewash/core: workspace:*`.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @onewash/engine test && pnpm --filter @onewash/engine typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git commit -m "feat(engine): interfaces do motor (esqueleto da spec §6)"
```

### Task 2.2: Implementação nula + suíte de contrato

**Files:**
- Create: `packages/engine/src/null-evaluator.ts`
- Test: `packages/engine/test/contract.test.ts`

**Interfaces:**
- Consumes: `interfaces.ts` (2.1)
- Produces:
  - `class NullEvaluator implements BuildEvaluator` — `capabilities.kind='curated'`, `output='ordinal'`, `canHandle` sempre `{ok:true}`, `evaluate` devolve `Score` com `value:0`, `provenance.confidence:'low'`, `assumptions:['null evaluator']`.
  - `contractSuite(make: () => BuildEvaluator): void` — a suíte reutilizável que qualquer implementação futura roda.

- [ ] **Step 1: Teste que falha (a suíte de contrato aplicada à NullEvaluator)**

```ts
// packages/engine/test/contract.test.ts
import { describe, it, expect } from 'vitest';
import { NullEvaluator } from '../src/null-evaluator.js';
import type { EvaluationContext, Build } from '../src/interfaces.js';

const ctx = {} as EvaluationContext;   // stub mínimo
const build = {} as Build;

describe('contrato BuildEvaluator (NullEvaluator)', () => {
  it('avalia em lote e devolve um Score por build', async () => {
    const e = new NullEvaluator();
    const prepared = await e.prepare(ctx);
    const scores = await prepared.evaluate([build, build]);
    expect(scores).toHaveLength(2);
    expect(scores[0]!.provenance.kind).toBe('curated');
  });
  it('canHandle negocia antes de rodar', () => {
    expect(new NullEvaluator().canHandle(ctx).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @onewash/engine test contract`
Expected: FAIL — `null-evaluator.js` não existe.

- [ ] **Step 3: Implementar a NullEvaluator**

```ts
// packages/engine/src/null-evaluator.ts
import type { BuildEvaluator, PreparedEvaluator, EvaluationContext,
  EvaluatorCapabilities, Score, Build, CapabilityVerdict } from './interfaces.js';

const CAPS: EvaluatorCapabilities = {
  kind: 'curated', output: 'ordinal', supportsTermKinds: ['stat'],
  supportsAggregates: ['sum'], supportsConstraintKinds: [], supportsHitModes: ['avgHit'],
  modelsSnapshot: false, modelsAuraAndIcd: false, providesBounds: false,
  deterministic: true, estimatedCostPerBuildMs: 0.001, maxBatchSize: 100000, runtime: 'node',
};

export class NullEvaluator implements BuildEvaluator {
  readonly id = 'null';
  readonly capabilities = CAPS;
  canHandle(_ctx: EvaluationContext): CapabilityVerdict { return { ok: true }; }
  async prepare(ctx: EvaluationContext): Promise<PreparedEvaluator> {
    const score = (): Score => ({
      value: 0, unit: 'score', violations: [],
      provenance: { evaluatorId: this.id, kind: 'curated', gameVersion: ctx.gameVersion ?? '7.0',
        datasetSha: 'none', confidence: 'low', assumptions: ['null evaluator'],
        rosterCompleteness: 'partial', cacheKey: 'null' },
    });
    return {
      async evaluate(builds: readonly Build[]) { return builds.map(score); },
      async [Symbol.asyncDispose]() {},
    };
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @onewash/engine test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/null-evaluator.ts packages/engine/test/contract.test.ts
git commit -m "feat(engine): implementação nula + suíte de contrato"
```

---

## Marco 3 — `packages/db`

### Task 3.1: Schema Drizzle (catalog + app) + migration que ROExecuta

**Files:**
- Create: `packages/db/package.json`, `packages/db/drizzle.config.ts`, `packages/db/src/schema/{catalog,app,index}.ts`, `packages/db/src/client.ts`
- Test: `packages/db/test/migrate.test.ts`

**Interfaces:**
- Consumes: nada (schema autônomo)
- Produces:
  - Tabelas Drizzle espelhando a DDL da spec §5: `catalog.{version,property,character,weapon_type,weapon,artifact_set,slot_main_allowed}` e `app.{doc_schema,account,credential,raw_object,raw_observation,snapshot,character_state,state_stat,character_timeline,change_event}`.
  - `db(url)` (pooled) e `migrationClient(url)` (direto).

- [ ] **Step 1: Teste que falha (a migration precisa RODAR — a §5.3 é a armadilha)**

```ts
// packages/db/test/migrate.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

describe('migration', () => {
  it('cria raw_object (não particionado) e raw_observation (particionado) sem erro', async () => {
    const pg = new PGlite();
    const sql = /* carregar a migration gerada */ await loadMigrationSql();
    await pg.exec(sql); // NÃO pode lançar "unique constraint must include partitioning columns"
    const r = await pg.query(`SELECT to_regclass('app.raw_object') a, to_regclass('app.raw_observation') b`);
    expect((r.rows[0] as any).a).not.toBeNull();
    expect((r.rows[0] as any).b).not.toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @onewash/db test`
Expected: FAIL — schema/migration inexistente.

- [ ] **Step 3: Escrever o schema Drizzle e gerar a migration**

Traduzir a DDL da spec §5 para Drizzle (`pgSchema('catalog')`, `pgSchema('app')`). Pontos que a spec exige e o schema DEVE respeitar:
- `raw_object` **não particionada**, PK `raw_sha256` (alvo da FK de `snapshot.raw_sha256`).
- `raw_observation` particionada por `RANGE(captured_at)`, PK composta `(raw_sha256, captured_at)`, **sem FK**. Como Drizzle não gera `PARTITION BY` nem partições, emitir isso via SQL manual na migration (`drizzle-kit generate` + editar o arquivo, ou um `sql` custom em `drizzle/0000_*.sql`). Incluir a partição `raw_observation_2026m09`.
- `character_state.content_hash` como `GENERATED ALWAYS AS (sha256(doc_canon)) STORED`.
- `character_timeline`: PK `(account_id,char_key,doc_schema,valid_from)` + índice único parcial `character_timeline_one_open ... WHERE valid_to IS NULL`. **Não** criar `EXCLUDE gist`.
- Todos os índices da §5.8.
- Seed inicial: `INSERT INTO app.doc_schema VALUES (1, ...)`.

`drizzle.config.ts` aponta para a string **direta** (`DATABASE_URL_DIRECT`).

- [ ] **Step 4: Rodar e ver passar (contra PGlite em memória)**

Adicionar `@electric-sql/pglite` como devDep. `loadMigrationSql()` concatena os arquivos de `drizzle/*.sql`.
Run: `pnpm --filter @onewash/db test`
Expected: PASS — a migration executa, ambas as tabelas raw existem.

- [ ] **Step 5: Commit**

```bash
git add packages/db
git commit -m "feat(db): schema Drizzle + migration inicial (raw particionado resolvido)"
```

### Task 3.2: Gravação transacional de snapshot (dedupe + advisory lock + timeline)

**Files:**
- Create: `packages/db/src/ingest.ts`
- Test: `packages/db/test/ingest.test.ts`

**Interfaces:**
- Consumes: `db` client (3.1), `NormalizedSnapshot`/`PromotedCols` de `@onewash/core` (1.6).
- Produces:
  - `writeSnapshot(db, args): Promise<{ snapshotId: bigint; changedChars: number; deduped: boolean }>` onde `args = { accountId, takenAt, parserVersion, docSchema, lang, rawSha256, normalized: NormalizedSnapshot, idempotencyKey }`.
  - Comportamento: adquire `pg_advisory_xact_lock` por conta; `INSERT ... ON CONFLICT (account_id,doc_schema,content_hash) DO NOTHING` nos estados; fecha e abre intervalos de timeline conforme mudança; emite `change_event`; **mesmo payload 2× não cria estado novo** (dedupe por hash).

- [ ] **Step 1: Teste que falha (o dedupe é o requisito central)**

```ts
// packages/db/test/ingest.test.ts
import { describe, it, expect } from 'vitest';
import { makeTestDb } from './helpers.js';       // PGlite + migration + conta seed
import { writeSnapshot } from '../src/ingest.js';

const normalized = { accountHash: 'h', characters: [{
  charKey: '10000089', contentHash: 'abc', doc: { /* mínimo */ } as any,
  promoted: { charLevel: 90, ascension: 6, constellation: 2, weaponId: 13509, weaponRefine: 1 },
}]};

describe('writeSnapshot', () => {
  it('roda 2× o mesmo payload sem criar estado duplicado', async () => {
    const db = await makeTestDb();
    const a = await writeSnapshot(db, { accountId: 1n, takenAt: new Date('2026-08-24'),
      parserVersion: 1, docSchema: 1, lang: 'pt-pt', rawSha256: Buffer.alloc(32), normalized });
    const b = await writeSnapshot(db, { accountId: 1n, takenAt: new Date('2026-08-31'),
      parserVersion: 1, docSchema: 1, lang: 'pt-pt', rawSha256: Buffer.alloc(32), normalized });
    const states = await db.execute(`SELECT count(*) n FROM app.character_state`);
    expect(Number((states.rows[0] as any).n)).toBe(1);   // dedupe
    expect(b.changedChars).toBe(0);
  });
  it('detecta mudança quando o content_hash muda', async () => {
    const db = await makeTestDb();
    await writeSnapshot(db, { /* ...hash abc... */ } as any);
    const changed = { ...normalized, characters: [{ ...normalized.characters[0]!, contentHash: 'xyz' }] };
    const r = await writeSnapshot(db, { /* ...normalized: changed... */ } as any);
    expect(r.changedChars).toBe(1);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @onewash/db test ingest`
Expected: FAIL — `ingest.js` não existe.

- [ ] **Step 3: Implementar a gravação transacional**

Numa transação: `SELECT pg_advisory_xact_lock(hashtextextended('onewash.account', accountId))`; inserir `snapshot`; para cada personagem, `INSERT INTO character_state ... ON CONFLICT DO NOTHING RETURNING state_id`; comparar com o intervalo aberto atual da timeline (`WHERE valid_to IS NULL`) — se `content_hash` diferente, fechar o aberto (`valid_to = takenAt, closed_by='change'`), abrir novo, e emitir `change_event`; se igual, só atualizar `last_seen_at`; contar `changedChars`; setar `account_hash`, `changed_chars`, `observed_chars`.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @onewash/db test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/ingest.ts packages/db/test
git commit -m "feat(db): gravação transacional de snapshot com dedupe e timeline"
```

---

## Marco 4 — `packages/hoyolab`

### Task 4.1: Geração de DS1

**Files:**
- Create: `packages/hoyolab/package.json`, `packages/hoyolab/src/ds.ts`
- Test: `packages/hoyolab/test/ds.test.ts`

**Interfaces:**
- Consumes: nada
- Produces:
  - `ds1(now: number, rand: string): string` — `"{t},{r},{md5}"` com `md5("salt=6s25p5ox5y14umn1p61aqyyvbvvl3lrt&t={t}&r={r}")`. `now`/`rand` injetados para ser determinístico e testável.
  - `DS_SALT`, `APP_VERSION='1.5.0'`, `CLIENT_TYPE='5'`.

- [ ] **Step 1: Teste que falha (vetor conhecido)**

```ts
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { ds1, DS_SALT } from '../src/ds.js';

describe('ds1', () => {
  it('bate com o md5 esperado para (t,r) fixos', () => {
    const t = 1700000000, r = '123456';
    const expected = createHash('md5').update(`salt=${DS_SALT}&t=${t}&r=${r}`).digest('hex');
    expect(ds1(t, r)).toBe(`${t},${r},${expected}`);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @onewash/hoyolab test ds`
Expected: FAIL — `ds.js` não existe.

- [ ] **Step 3: Implementar**

```ts
// packages/hoyolab/src/ds.ts
import { createHash } from 'node:crypto';
export const DS_SALT = '6s25p5ox5y14umn1p61aqyyvbvvl3lrt';
export const APP_VERSION = '1.5.0';
export const CLIENT_TYPE = '5';
export function ds1(now: number, rand: string): string {
  const md5 = createHash('md5').update(`salt=${DS_SALT}&t=${now}&r=${rand}`).digest('hex');
  return `${now},${rand},${md5}`;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @onewash/hoyolab test ds`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/hoyolab/package.json packages/hoyolab/src/ds.ts packages/hoyolab/test/ds.test.ts
git commit -m "feat(hoyolab): geração determinística de DS1"
```

### Task 4.2: Cliente do Battle Chronicle (com replay)

**Files:**
- Create: `packages/hoyolab/src/{client,types,config}.ts`, `packages/hoyolab/src/index.ts`
- Test: `packages/hoyolab/test/client.test.ts`
- Create: `packages/hoyolab/test/fixtures/{roles,list,detail}.json` (anonimizados)

**Interfaces:**
- Consumes: `ds1` (4.1)
- Produces:
  - `class HoyolabClient` construído com `{ cookies:{ltoken_v2,ltuid_v2}, lang?, baseUrl?, fetch? }` (fetch injetável p/ replay).
  - `getGameRole(): Promise<{ gameUid; region }>` (via `getUserGameRolesByCookie`, filtra `hk4e_global`).
  - `listCharacters(role): Promise<{ ids:number[]; base:unknown }>`
  - `characterDetail(role, ids:number[]): Promise<unknown>`
  - `fetchAll(): Promise<{ list:unknown; detail:unknown; account:{gameUid,region,nickname} }>` — o que a CLI envia como `raw`.
  - Erros tipados: `HoyolabError` com `retcode` textual (`10001`,`10102`,`1034`) e classificação (`session|ratelimit|no-chronicle|unknown`). Tolera corpo não-JSON.

- [ ] **Step 1: Teste que falha (contra fetch mockado com fixtures)**

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { HoyolabClient, HoyolabError } from '../src/index.js';

const fx = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), 'utf8'));
const mockFetch = (map: Record<string, unknown>): typeof fetch =>
  (async (url: any) => {
    const key = Object.keys(map).find(k => String(url).includes(k))!;
    return new Response(JSON.stringify(map[key]), { status: 200 });
  }) as any;

describe('HoyolabClient', () => {
  it('descobre role e detalha personagens', async () => {
    const c = new HoyolabClient({ cookies: { ltoken_v2: 'x', ltuid_v2: '1' },
      fetch: mockFetch({ getUserGameRolesByCookie: fx('roles'),
        'character/list': fx('list'), 'character/detail': fx('detail') }) });
    const all = await c.fetchAll();
    expect(all.account.region).toMatch(/^os_/);
    expect((all.detail as any).list.length).toBeGreaterThan(0);
  });
  it('classifica retcode de sessão expirada', async () => {
    const c = new HoyolabClient({ cookies: { ltoken_v2: 'x', ltuid_v2: '1' },
      fetch: (async () => new Response(JSON.stringify({ retcode: 10001, message: 'not logged in' }))) as any });
    await expect(c.getGameRole()).rejects.toThrow(HoyolabError);
  });
  it('não estoura em corpo não-JSON (Method Not Allowed)', async () => {
    const c = new HoyolabClient({ cookies: { ltoken_v2: 'x', ltuid_v2: '1' },
      fetch: (async () => new Response('Method Not Allowed', { status: 405 })) as any });
    await expect(c.getGameRole()).rejects.toThrow(HoyolabError);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @onewash/hoyolab test client`
Expected: FAIL — `client.js` não existe.

- [ ] **Step 3: Implementar o cliente**

`config.ts` com `DEFAULT_BASE = 'https://sg-public-api.hoyolab.com/event/game_record'` e `ACCOUNT_BASE = 'https://api-account-os.hoyolab.com'`, ambos sobrescrevíveis. Montar headers: `Cookie`, `x-rpc-language: pt-pt`, `x-rpc-app_version`, `x-rpc-client_type`, e `DS` (opcional — flag `useDs`, default o que o spike 1 decidir). Parse defensivo: `try { json } catch { throw HoyolabError('unknown', corpo-truncado-sem-segredo) }`. Mapear `retcode`: `10001→session`, `10102/1034/-110→ratelimit`, `10104/1009→no-chronicle`. Backoff em ratelimit.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @onewash/hoyolab test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/hoyolab
git commit -m "feat(hoyolab): cliente do Battle Chronicle com erros tipados e replay"
```

---

## Marco 5 — `packages/cookies`

### Task 5.1: Interface + provider Firefox

**Files:**
- Create: `packages/cookies/package.json`, `packages/cookies/src/{provider,firefox,index}.ts`
- Test: `packages/cookies/test/firefox.test.ts`
- Create: `packages/cookies/test/fixtures/cookies.sqlite` (banco Firefox sintético com um `ltoken_v2`)

**Interfaces:**
- Consumes: nada
- Produces:
  - `interface HoyolabSession { ltoken_v2: string; ltuid_v2: string }`
  - `interface SessionProvider { id: string; tryGet(): Promise<HoyolabSession | null> }`
  - `class FirefoxProvider implements SessionProvider` — lê `cookies.sqlite` (via `node:sqlite`), filtra `host LIKE '%hoyolab.com'` e os nomes `ltoken_v2`/`ltuid_v2`. Lida com lock (`immutable=1`/cópia temporária).

- [ ] **Step 1: Teste que falha (contra o sqlite sintético)**

```ts
import { describe, it, expect } from 'vitest';
import { FirefoxProvider } from '../src/firefox.js';

describe('FirefoxProvider', () => {
  it('extrai ltoken_v2 e ltuid_v2 do cookies.sqlite', async () => {
    const p = new FirefoxProvider({ profilePath: new URL('./fixtures/', import.meta.url).pathname });
    const s = await p.tryGet();
    expect(s?.ltoken_v2).toBeTruthy();
    expect(s?.ltuid_v2).toBeTruthy();
  });
  it('devolve null quando não há cookie do HoYoLAB', async () => {
    const p = new FirefoxProvider({ profilePath: '/caminho/inexistente' });
    expect(await p.tryGet()).toBeNull();
  });
});
```

- [ ] **Step 2: Gerar a fixture e rodar**

Script único para criar `test/fixtures/cookies.sqlite` com o schema `moz_cookies` e uma linha de cada cookie (valores falsos). Rodar:
Run: `pnpm --filter @onewash/cookies test firefox`
Expected: FAIL — `firefox.js` não existe.

- [ ] **Step 3: Implementar**

```ts
// packages/cookies/src/firefox.ts
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { SessionProvider, HoyolabSession } from './provider.js';

export class FirefoxProvider implements SessionProvider {
  readonly id = 'firefox';
  constructor(private opts: { profilePath: string }) {}
  async tryGet(): Promise<HoyolabSession | null> {
    const src = join(this.opts.profilePath, 'cookies.sqlite');
    if (!existsSync(src)) return null;
    const tmp = join(tmpdir(), `ow-${Date.now()}.sqlite`);   // cópia p/ evitar lock
    copyFileSync(src, tmp);
    const db = new DatabaseSync(tmp, { readOnly: true });
    try {
      const rows = db.prepare(
        `SELECT name, value FROM moz_cookies WHERE host LIKE '%hoyolab.com'
         AND name IN ('ltoken_v2','ltuid_v2')`).all() as { name: string; value: string }[];
      const map = Object.fromEntries(rows.map(r => [r.name, r.value]));
      if (!map.ltoken_v2 || !map.ltuid_v2) return null;
      return { ltoken_v2: map.ltoken_v2, ltuid_v2: map.ltuid_v2 };
    } finally { db.close(); }
  }
}
```

> `Date.now()` é aceitável aqui (nome de arquivo temporário em runtime real, não em workflow).

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @onewash/cookies test firefox`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cookies
git commit -m "feat(cookies): interface SessionProvider + leitura do Firefox"
```

### Task 5.2: Provider colar-à-mão + cadeia de fallback

**Files:**
- Modify: `packages/cookies/src/index.ts`
- Create: `packages/cookies/src/{paste,chain}.ts`
- Test: `packages/cookies/test/chain.test.ts`

**Interfaces:**
- Consumes: `SessionProvider`/`HoyolabSession` (5.1), `FirefoxProvider` (5.1)
- Produces:
  - `class PasteProvider implements SessionProvider` — parseia `"ltoken_v2=...; ltuid_v2=..."`.
  - `getSession(opts): Promise<HoyolabSession>` — tenta os providers em ordem (`paste` se fornecido → firefox → embedded), devolve o primeiro `!= null`, lança `NoSessionError` com mensagem acionável (lista o que foi tentado) se todos falharem.

- [ ] **Step 1: Teste que falha**

```ts
import { describe, it, expect } from 'vitest';
import { PasteProvider } from '../src/paste.js';
import { getSession, NoSessionError } from '../src/chain.js';

describe('cadeia', () => {
  it('PasteProvider parseia a string de cookie', async () => {
    const s = await new PasteProvider('ltoken_v2=abc; ltuid_v2=42').tryGet();
    expect(s).toEqual({ ltoken_v2: 'abc', ltuid_v2: '42' });
  });
  it('usa o primeiro provider que resolve', async () => {
    const s = await getSession({ providers: [
      { id: 'a', tryGet: async () => null },
      { id: 'b', tryGet: async () => ({ ltoken_v2: 'x', ltuid_v2: '1' }) },
    ]});
    expect(s.ltoken_v2).toBe('x');
  });
  it('lança mensagem acionável listando o que tentou', async () => {
    await expect(getSession({ providers: [{ id: 'firefox', tryGet: async () => null }] }))
      .rejects.toThrow(/firefox/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @onewash/cookies test chain`
Expected: FAIL

- [ ] **Step 3: Implementar paste + chain**

```ts
// packages/cookies/src/paste.ts
import type { SessionProvider, HoyolabSession } from './provider.js';
export class PasteProvider implements SessionProvider {
  readonly id = 'paste';
  constructor(private raw: string) {}
  async tryGet(): Promise<HoyolabSession | null> {
    const m = Object.fromEntries(this.raw.split(';').map(p => {
      const [k, ...v] = p.trim().split('='); return [k, v.join('=')];
    }));
    return m.ltoken_v2 && m.ltuid_v2 ? { ltoken_v2: m.ltoken_v2, ltuid_v2: m.ltuid_v2 } : null;
  }
}
```

```ts
// packages/cookies/src/chain.ts
import type { SessionProvider, HoyolabSession } from './provider.js';
export class NoSessionError extends Error {}
export async function getSession(opts: { providers: SessionProvider[] }): Promise<HoyolabSession> {
  const tried: string[] = [];
  for (const p of opts.providers) {
    tried.push(p.id);
    const s = await p.tryGet();
    if (s) return s;
  }
  throw new NoSessionError(
    `Sessão do HoYoLAB não encontrada. Tentei: ${tried.join(', ')}. ` +
    `Faça login com --login, ou cole o cookie com --cookie "ltoken_v2=...; ltuid_v2=...".`);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @onewash/cookies test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cookies/src packages/cookies/test/chain.test.ts
git commit -m "feat(cookies): provider colar-à-mão + cadeia de fallback"
```

### Task 5.3: Provider navegador embutido (Playwright) — gated por spike

**Files:**
- Create: `packages/cookies/src/embedded.ts`
- Test: `packages/cookies/test/embedded.test.ts` (unitário do parse de storageState; o E2E real é manual)

**Interfaces:**
- Consumes: `SessionProvider`/`HoyolabSession` (5.1)
- Produces:
  - `class EmbeddedProvider implements SessionProvider` — abre `https://www.hoyolab.com` via Playwright (Chromium), espera o usuário logar (`waitForLoad`/polling até os cookies aparecerem), extrai `ltoken_v2`/`ltuid_v2` do `context.cookies()`.
  - `sessionFromStorageState(state): HoyolabSession | null` — função pura testável que extrai os cookies do formato `storageState` do Playwright.

- [ ] **Step 1: Teste que falha (parte pura)**

```ts
import { describe, it, expect } from 'vitest';
import { sessionFromStorageState } from '../src/embedded.js';

describe('sessionFromStorageState', () => {
  it('extrai os cookies do formato do Playwright', () => {
    const state = { cookies: [
      { name: 'ltoken_v2', value: 'tok', domain: '.hoyolab.com' },
      { name: 'ltuid_v2', value: '7', domain: '.hoyolab.com' },
      { name: 'other', value: 'z', domain: '.hoyolab.com' },
    ]};
    expect(sessionFromStorageState(state)).toEqual({ ltoken_v2: 'tok', ltuid_v2: '7' });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @onewash/cookies test embedded`
Expected: FAIL

- [ ] **Step 3: Implementar (Playwright como dependência opcional)**

Extrair `sessionFromStorageState` puro; `tryGet()` importa `playwright` dinamicamente (`await import('playwright')`) e, se ausente, devolve `null` com aviso — mantém a CLI instalável sem o Chromium de 150MB. **Este provider depende do spike 2** (confirmar captura e persistência da sessão na máquina real); marcar `@spike` no topo do arquivo.

- [ ] **Step 4: Rodar e ver passar (unitário) + verificação manual (spike 2)**

Run: `pnpm --filter @onewash/cookies test embedded`
Expected: PASS (unitário). E2E real: checklist manual do spike 2.

- [ ] **Step 5: Commit**

```bash
git add packages/cookies/src/embedded.ts packages/cookies/test/embedded.test.ts
git commit -m "feat(cookies): provider de navegador embutido (parse puro + Playwright opcional)"
```

---

## Marco 6 — `packages/gi-data` (mínimo da Fase 1)

> Esta fase precisa apenas dos **mapas** (property, weapon_type) e do **catálogo de identidade**
> (id→slug, raridade, tipo de arma, main stats por slot) para popular `catalog.*` e completar o
> `PROP` do normalizador. As **tabelas de scaling** (curvas, ascensão, talentos) são segundo ciclo.

### Task 6.1: Script de sync dos mapas e catálogo

**Files:**
- Create: `packages/gi-data/package.json`, `packages/gi-data/scripts/sync.ts`, `packages/gi-data/src/index.ts`
- Create: `packages/gi-data/data/{property.json,weapon-type.json,characters.json,weapons.json,artifact-sets.json,slot-main.json}` (geradas)
- Test: `packages/gi-data/test/sync.test.ts`

**Interfaces:**
- Consumes: fontes vendorizadas (Enka `store/gi/*` + `allStat_gen` do GO) — baixadas pelo script e fixadas por SHA em `scripts/sources.json`.
- Produces:
  - `loadProperty(): Record<number, {code:string; goodKey:string|null; isPercent:boolean; decimals:number}>`
  - `loadWeaponTypeMap(): { hoyolabToWt: Record<number, {gameCode; enkaInt; goodKey}> }`
  - `loadCharacters()/loadWeapons()/loadArtifactSets()/loadSlotMain()` — dados de catálogo tipados.
  - O script **falha o build** se um campo esperado sumir (defesa contra rotação de chave ofuscada).

- [ ] **Step 1: Teste que falha (o gerado precisa cobrir os ids que o normalizador usa)**

```ts
import { describe, it, expect } from 'vitest';
import { loadProperty, loadWeaponTypeMap } from '../src/index.js';

describe('gi-data', () => {
  it('property map cobre os stats críticos e marca percentuais', () => {
    const p = loadProperty();
    expect(p[22]!.code).toContain('CRITICAL_HURT'); // CRIT DMG
    expect(p[22]!.isPercent).toBe(true);
  });
  it('weapon type map traduz os 5 encodings do HoYoLAB', () => {
    const { hoyolabToWt } = loadWeaponTypeMap();
    expect(Object.keys(hoyolabToWt).sort()).toEqual(['1','10','11','12','13']);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @onewash/gi-data test`
Expected: FAIL — dados não gerados / loader inexistente.

- [ ] **Step 3: Escrever o script de sync e gerar os dados**

`scripts/sync.ts` lê as fontes vendorizadas (podem reusar os JSONs já baixados na pesquisa: `affixes.json`, `avatars.json`, `weapons.json`, `relics.json`, `relic_levels.json`, `locs.json`, `allStat_gen.json`), extrai os mapas e o catálogo, valida presença dos campos esperados (senão `throw`), e grava em `data/*.json`. `src/index.ts` são loaders tipados que importam esses JSONs. Rodar `pnpm --filter @onewash/gi-data sync`.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @onewash/gi-data test`
Expected: PASS

- [ ] **Step 5: Completar o `PROP` do normalizador**

Substituir o `PROP` embarcado em `packages/core/src/normalize.ts` por importação de `@onewash/gi-data` (`loadProperty`). Rodar `pnpm --filter @onewash/core test` — deve continuar PASS. Commitar tudo.

```bash
git add packages/gi-data packages/core/src/normalize.ts
git commit -m "feat(gi-data): sync de mapas e catálogo; normalizador usa property map completo"
```

### Task 6.2: Espelhamento de imagens (assets:sync)

**Files:**
- Create: `packages/gi-data/scripts/assets-sync.ts`
- Test: `packages/gi-data/test/assets.test.ts` (parte pura: mapeamento URL→hash)

**Interfaces:**
- Consumes: as URLs de imagem presentes no catálogo/payload.
- Produces:
  - `assetKey(url: string): string` — hash de conteúdo determinístico → nome do objeto no R2.
  - Script que baixa cada asset uma vez, sobe ao R2 com `Cache-Control: public, max-age=31536000, immutable`, e grava um manifesto `data/assets.json` (url original → chave R2). Idempotente (pula o que já existe).

- [ ] **Step 1: Teste que falha (parte pura)**

```ts
import { describe, it, expect } from 'vitest';
import { assetKey } from '../scripts/assets-sync.js';
describe('assetKey', () => {
  it('é determinístico e preserva a extensão', () => {
    const u = 'https://act-webstatic.hoyoverse.com/x/UI_AvatarIcon_Furina.png';
    expect(assetKey(u)).toBe(assetKey(u));
    expect(assetKey(u)).toMatch(/\.png$/);
  });
});
```

- [ ] **Step 2–4:** rodar (falha), implementar `assetKey` (sha1 da URL + extensão) + o uploader R2 (`@aws-sdk/client-s3` apontado ao endpoint R2), rodar (passa). O upload real exige credenciais R2 — o teste cobre só a parte pura; o sync real roda sob demanda.

- [ ] **Step 5: Commit**

```bash
git add packages/gi-data/scripts/assets-sync.ts packages/gi-data/test/assets.test.ts
git commit -m "feat(gi-data): espelhamento de imagens para R2 (chave por hash)"
```

---

## Marco 7 — `apps/cli`

### Task 7.1: Config local + login/logout/whoami

**Files:**
- Create: `apps/cli/package.json`, `apps/cli/src/{index,config}.ts`, `apps/cli/src/commands/{login,logout,whoami}.ts`
- Test: `apps/cli/test/config.test.ts`

**Interfaces:**
- Consumes: nada
- Produces:
  - `readConfig()/writeConfig(cfg)` em `~/.genshin/config.json` com permissão `0600`.
  - `type Config = { apiToken?: string; apiBaseUrl: string }`
  - Comandos `login <token>` (grava token), `logout` (apaga), `whoami` (mostra base URL e se está pareado — **sem** imprimir o token).

- [ ] **Step 1: Teste que falha (config gravada com permissão restrita e token nunca impresso)**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readConfig, writeConfig, redactConfig } from '../src/config.js';

describe('config', () => {
  it('grava com permissão 0600 e lê de volta', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ow-'));
    writeConfig({ apiToken: 'ow_live_secret', apiBaseUrl: 'http://x' }, dir);
    expect(readConfig(dir).apiToken).toBe('ow_live_secret');
    if (process.platform !== 'win32') {
      expect(statSync(join(dir, 'config.json')).mode & 0o777).toBe(0o600);
    }
  });
  it('redactConfig nunca revela o token', () => {
    const r = redactConfig({ apiToken: 'ow_live_secret', apiBaseUrl: 'http://x' });
    expect(JSON.stringify(r)).not.toContain('secret');
    expect(r.paired).toBe(true);
  });
});
```

- [ ] **Step 2–4:** rodar (falha), implementar `config.ts` (usa `writeFileSync(..., { mode: 0o600 })`, `chmodSync`) + os três comandos, rodar (passa). `whoami` imprime `redactConfig`.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/package.json apps/cli/src/config.ts apps/cli/src/commands/{login,logout,whoami}.ts apps/cli/test/config.test.ts
git commit -m "feat(cli): config local (0600) e login/logout/whoami sem vazar token"
```

### Task 7.2: `sync` (orquestra) + `doctor`

**Files:**
- Create: `apps/cli/src/commands/{sync,doctor}.ts`, `apps/cli/src/api.ts`
- Test: `apps/cli/test/sync.test.ts`

**Interfaces:**
- Consumes: `getSession` (5.2), `HoyolabClient` (4.2), `normalize` + `IngestEnvelope` (1.x), `readConfig` (7.1).
- Produces:
  - `runSync(deps, flags): Promise<SyncResult>` — deps injetáveis (`getSession`, `client factory`, `postIngest`) para teste. Monta o `IngestEnvelope` (raw cru + account), envia via `postIngest`. Flags: `--out`, `--dry-run`, `--browser`, `--login`, `--cookie`, `--json`.
  - `SyncResult = { characters:number; changed:number; sent:boolean }` — resumo comparado ao último sync (o servidor devolve `changedChars`).
  - `runDoctor(deps): Promise<DoctorReport>` — checa: navegador/cookie achado? cookie válido? HoYoLAB responde? API OneWash responde?
  - `postIngest(env, token, baseUrl)` em `api.ts`; em falha de envio, grava o cru local e informa como reenviar.

- [ ] **Step 1: Teste que falha (fluxo completo com deps mockadas; --dry-run não envia)**

```ts
import { describe, it, expect, vi } from 'vitest';
import { runSync } from '../src/commands/sync.js';

const deps = {
  getSession: async () => ({ ltoken_v2: 'x', ltuid_v2: '1' }),
  makeClient: () => ({ fetchAll: async () => ({
    list: { list: [] }, detail: { list: [] },
    account: { gameUid: '8', region: 'os_asia', nickname: 'T' } }) }),
  postIngest: vi.fn(async () => ({ changedChars: 3 })),
  readConfig: () => ({ apiToken: 'ow_live_x', apiBaseUrl: 'http://x' }),
};

describe('runSync', () => {
  it('envia o envelope e resume as mudanças', async () => {
    const r = await runSync(deps as any, {});
    expect(deps.postIngest).toHaveBeenCalledOnce();
    expect(r.changed).toBe(3);
    expect(r.sent).toBe(true);
  });
  it('--dry-run não envia', async () => {
    const p = vi.fn();
    await runSync({ ...deps, postIngest: p } as any, { dryRun: true });
    expect(p).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2–4:** rodar (falha), implementar `runSync`/`runDoctor`/`api.ts`, rodar (passa).

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/{sync,doctor}.ts apps/cli/src/api.ts apps/cli/test/sync.test.ts
git commit -m "feat(cli): sync (orquestra extração→envio) e doctor"
```

### Task 7.3: Redação de segredos em toda saída de erro

**Files:**
- Create: `apps/cli/src/redact.ts`
- Modify: `apps/cli/src/index.ts` (handler global de erro)
- Test: `apps/cli/test/redact.test.ts`

**Interfaces:**
- Consumes: nada
- Produces:
  - `redact(text: string): string` — mascara qualquer `ltoken_v2=...`, `ltuid_v2=...`, `ow_live_...` e cookies em URLs/headers.
  - Handler global que passa toda mensagem de erro por `redact` antes de imprimir.

- [ ] **Step 1: Teste que falha**

```ts
import { describe, it, expect } from 'vitest';
import { redact } from '../src/redact.js';
describe('redact', () => {
  it('mascara cookie e token em qualquer contexto', () => {
    expect(redact('Cookie: ltoken_v2=abc123; ltuid_v2=7')).not.toContain('abc123');
    expect(redact('token ow_live_deadbeef falhou')).not.toContain('deadbeef');
  });
  it('preserva o resto da mensagem', () => {
    expect(redact('erro 500 no /api/ingest')).toContain('/api/ingest');
  });
});
```

- [ ] **Step 2–4:** rodar (falha), implementar `redact` (regex sobre os padrões) + envolver o handler de erro do entrypoint, rodar (passa).

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/redact.ts apps/cli/src/index.ts apps/cli/test/redact.test.ts
git commit -m "feat(cli): redação obrigatória de segredos em toda saída"
```

---

## Marco 8 — `apps/web`

### Task 8.1: Auth (Better Auth: Google/Discord + plugin API Key)

**Files:**
- Create: `apps/web/package.json`, `apps/web/lib/{auth,db}.ts`, `apps/web/app/api/auth/[...all]/route.ts`
- Test: `apps/web/test/auth.test.ts`

**Interfaces:**
- Consumes: `db` client (3.1)
- Produces:
  - `auth` (instância Better Auth) com providers Google/Discord, plugin `apiKey` (prefixo `ow_live_`, escopo `snapshots:write`, hash SHA-256), `nextCookies()`.
  - `verifyApiKey(req): Promise<{ userId: string } | null>` — resolve o token do header e devolve o dono (`referenceId`), nunca do body.
  - Route handler em `app/api/auth/[...all]/route.ts` via `toNextJsHandler`.

- [ ] **Step 1: Teste que falha (verificação de token → userId; token inválido rejeitado)**

```ts
import { describe, it, expect } from 'vitest';
import { verifyApiKey } from '../lib/auth.js';

describe('verifyApiKey', () => {
  it('rejeita token ausente', async () => {
    const req = new Request('http://x/api/ingest');
    expect(await verifyApiKey(req)).toBeNull();
  });
  it('rejeita token inválido', async () => {
    const req = new Request('http://x/api/ingest', { headers: { 'x-api-key': 'ow_live_nope' } });
    expect(await verifyApiKey(req)).toBeNull();
  });
});
```

- [ ] **Step 2–4:** rodar (falha), configurar Better Auth (env: `GOOGLE_*`, `DISCORD_*`, `BETTER_AUTH_SECRET`, `DATABASE_URL`), implementar `verifyApiKey` sobre a API do plugin, gerar as tabelas de auth via migration do próprio Better Auth. Rodar (passa).

- [ ] **Step 5: Commit**

```bash
git add apps/web/package.json apps/web/lib apps/web/app/api/auth
git commit -m "feat(web): Better Auth (Google/Discord) + plugin API Key para a CLI"
```

### Task 8.2: `POST /api/ingest`

**Files:**
- Create: `apps/web/app/api/ingest/route.ts`
- Test: `apps/web/test/ingest.test.ts`

**Interfaces:**
- Consumes: `verifyApiKey` (8.1), `IngestEnvelope` + `normalize` (core), `writeSnapshot` (3.2), R2 client (para o cru).
- Produces: a rota que autentica por token, valida o envelope, resolve/cria `app.account` (deriva o `owner_id` do token — nunca do body), grava `raw_object`+`raw_observation` (bytes no R2), chama `normalize` + `writeSnapshot`, responde `{ snapshotId, changedChars, deduped }`. Rate limit por token (plugin) + WAF por IP (config, fora do código).

- [ ] **Step 1: Teste que falha (contrato: token, validação, dedupe, dono do body ignorado)**

```ts
import { describe, it, expect, vi } from 'vitest';
import { POST } from '../app/api/ingest/route.js';

const mk = (body: unknown, headers: Record<string,string> = {}) =>
  new Request('http://x/api/ingest', { method: 'POST', body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers } });

describe('POST /api/ingest', () => {
  it('401 sem token', async () => {
    const res = await POST(mk({}));
    expect(res.status).toBe(401);
  });
  it('400 em envelope malformado com erro útil', async () => {
    vi.mock('../lib/auth.js', () => ({ verifyApiKey: async () => ({ userId: 'u1' }) }));
    const res = await POST(mk({ protocolVersion: 999 }, { 'x-api-key': 'ow_live_ok' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty('error');
  });
  it('mesmo idempotencyKey não cria 2º snapshot', async () => {
    // envelope válido + writeSnapshot mockado devolvendo deduped:true na 2ª
    // ...
  });
});
```

- [ ] **Step 2–4:** rodar (falha), implementar a rota (autentica → `IngestEnvelope.safeParse` → resolve conta pelo `userId` → grava cru no R2 e `raw_object`/`raw_observation` → `normalize` → `writeSnapshot`), rodar (passa).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/ingest apps/web/test/ingest.test.ts
git commit -m "feat(web): rota /api/ingest (token→cru→normalize→snapshot) com dedupe"
```

### Task 8.3: Telas (grid, detalhe, histórico) + onboarding

**Files:**
- Create: `apps/web/app/{onboarding,characters,history}/**`, `apps/web/lib/render.ts`
- Test: `apps/web/test/render.test.ts`

**Interfaces:**
- Consumes: `db` + view `app.account_at` (3.1), `CharacterDoc` (core), catálogo/i18n (`@onewash/gi-data`), manifesto de assets (6.2).
- Produces:
  - `getAccountView(accountId)` / `getCharacter(accountId, charKey)` / `diffSnapshots(a,b)` — funções de leitura (Server Components).
  - Páginas: onboarding (mostra comando + token, sem dado antes de sync), grid (cards com filtro/ordenação, cabeçalho da conta), detalhe (identidade, constelações, talentos, atributos completos, arma, 5 artefatos com main+substats, bônus de conjunto, **painel de análise reservado em estado vazio**), histórico (seletor + diff).

- [ ] **Step 1: Teste que falha (a leitura e o diff; UI é verificada manualmente)**

```ts
import { describe, it, expect } from 'vitest';
import { diffSnapshots } from '../lib/render.js';

describe('diffSnapshots', () => {
  it('detecta artefato trocado vs upgrade via fingerprint', () => {
    const a = [{ charKey: '1', fp: 'setA:1:2:x', level: 16 }];
    const b = [{ charKey: '1', fp: 'setA:1:2:x', level: 20 }];
    expect(diffSnapshots(a, b)[0]!.kind).toBe('artifact_upgrade'); // mesmo fp, level maior
    const c = [{ charKey: '1', fp: 'setB:1:2:y', level: 0 }];
    expect(diffSnapshots(a, c)[0]!.kind).toBe('artifact_swap');    // fp diferente
  });
});
```

- [ ] **Step 2–4:** rodar (falha), implementar `render.ts` (leitura via view + diff nível 2 na aplicação) e as páginas Server Component, rodar (passa). Verificação visual manual das telas (spike 5: medir tamanho das imagens; decidir `/public` vs R2 servido).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/{onboarding,characters,history} apps/web/lib/render.ts apps/web/test/render.test.ts
git commit -m "feat(web): telas de grid, detalhe e histórico + onboarding"
```

### Task 8.4: Proxy/cache de imagem `/api/img/[hash]`

**Files:**
- Create: `apps/web/app/api/img/[hash]/route.ts`
- Test: `apps/web/test/img.test.ts`

**Interfaces:**
- Consumes: manifesto de assets (6.2), R2 client.
- Produces: rota que resolve o hash → objeto R2, serve com `Cache-Control` immutable; espelho preguiçoso (na 1ª vez, baixa do CDN se ausente, sobe ao R2, serve). Hash desconhecido → 404.

- [ ] **Step 1: Teste que falha**

```ts
import { describe, it, expect } from 'vitest';
import { GET } from '../app/api/img/[hash]/route.js';
describe('GET /api/img/[hash]', () => {
  it('404 para hash desconhecido', async () => {
    const res = await GET(new Request('http://x'), { params: { hash: 'nope' } } as any);
    expect(res.status).toBe(404);
  });
  it('serve com cache immutable quando existe', async () => {
    // R2 client mockado devolvendo bytes
    // expect(res.headers.get('cache-control')).toContain('immutable');
  });
});
```

- [ ] **Step 2–4:** rodar (falha), implementar a rota (lookup no manifesto → R2 get → miss: fetch CDN + put R2 → serve), rodar (passa).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/img apps/web/test/img.test.ts
git commit -m "feat(web): proxy de imagem com espelho preguiçoso e cache immutable"
```

---

## Auto-revisão (executada pelo autor do plano)

**1. Cobertura da spec:**
- §2 arquitetura/fronteiras → M0 (scaffold) + estrutura de arquivos. ✔
- §3 CLI (comandos, cookie, HoYoLAB API, redação) → M4, M5, M7. ✔
- §4 site (telas, imagens, render) → M8. ✔
- §5 modelo de dados (DDL, canon, dedupe, timeline, versionamento) → M1 (canon), M3 (schema+ingest). ✔ (Migração de `doc_schema`/`parser_version` §5.9 é operação de manutenção; o schema já carrega as colunas — implementação da migração fica para quando houver bump real, fora da Fase 1.)
- §6 interfaces do motor → M2. ✔
- §7 stack → escolhas fixadas nas Global Constraints e nas tarefas. ✔
- §8 testes (scrubber, contrato, dedupe, redação, secret-scan) → 1.5, 2.2, 3.2, 7.3, 0.1. ✔
- §9 spikes → gated em 4.2 (DS/lote), 5.3 (embedded), 6.2/8.3 (imagens), 1.6 (fixture do payload real). ✔

**2. Placeholders:** os `/* ... */` em blocos de teste são stubs de teste deliberados (o corpo do teste continua no passo de implementação); as implementações têm código real. `PROP` parcial em 1.6 é substituído por gi-data em 6.1 (dependência declarada). Sem TBD/TODO de produção.

**3. Consistência de tipos:** `HoyolabSession`, `SessionProvider`, `NormalizedSnapshot`, `PromotedCols`, `CharacterDoc`, `IngestEnvelope`, `writeSnapshot`, `verifyApiKey` — nomes e assinaturas batem entre as tarefas que os produzem e consomem.

**Lacunas conhecidas (aceitas para a Fase 1):**
- Migração efetiva de `doc_schema`/re-parse (§5.9) fica para o primeiro bump real.
- `app.credential` só ganha uso se o site vier a re-sincronizar sem a CLI (spec §5.2 já marca condicional).
- Tabelas de scaling do gi-data (curvas, ascensão, talentos) são do segundo ciclo (motor).
