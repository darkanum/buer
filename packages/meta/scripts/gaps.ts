// packages/meta/scripts/gaps.ts
//
// `meta:gaps` — o que ainda falta curar. Sem chamada de API.
//
// É também o gatilho de patch novo que a §10 da spec pede: quando
// `pnpm --filter @buer/gi-data sync` traz personagens de um patch novo, eles
// aparecem em `withoutProfile` na primeira execução seguinte.
//
// Roda via `tsx` (não `node` puro, ao contrário do `sync` do gi-data): este
// script importa `../src/load.js`, que por sua vez importa outros módulos
// relativos de `../src` (`resolve.js`, `validate.js`). `@buer/meta` é um
// pacote `noEmit` — só existe como fonte `.ts` — e o strip-types nativo do
// Node 24 não remapeia um especificador relativo `.js` para o `.ts` que
// existe no disco (só resolve exatamente o arquivo pedido); `tsx` resolve.
// `sync.ts` nunca precisou disso porque só lê JSON com `fs`, sem import
// relativo cruzando arquivo.

import type { RawMeta } from '../src/types.js';
import { readRawMeta } from '../src/load.js';
import { characterCatalog, currentGameVersion } from './catalog.js';

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

if (import.meta.main) {
  console.log(
    formatGaps(
      computeGaps({
        catalog: characterCatalog(),
        raw: readRawMeta(),
        currentVersion: currentGameVersion(),
      }),
    ),
  );
}
