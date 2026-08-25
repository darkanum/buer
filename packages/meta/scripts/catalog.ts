// packages/meta/scripts/catalog.ts
//
// O que os três scripts de `scripts/` compartilham sobre "o que existe":
// o patch corrente do jogo e o catálogo de personagens do `gi-data`.
//
// Existe porque `currentGameVersion()` estava copiado em três arquivos e o
// duplo cast de `loadCharacters()` em outros três. Nenhuma das cópias tinha
// razão de divergir, e a próxima mudança em qualquer delas teria que ser
// feita três vezes — ou seria feita uma vez e ficaria errada nas outras duas.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadCharacters } from '@buer/gi-data';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** `packages/meta/data` — a raiz do dado autorado. */
export const DATA_DIR = path.join(HERE, '..', 'data');

/** Patch corrente, lido de `data/game-version.json`. */
export function currentGameVersion(): string {
  const file = path.join(DATA_DIR, 'game-version.json');
  return (JSON.parse(readFileSync(file, 'utf8')) as { version: string }).version;
}

/**
 * O catálogo de personagens, na forma que `computeGaps` consome.
 *
 * O cast mora AQUI e em nenhum outro lugar: `loadCharacters()` devolve
 * `Record<number, CharacterEntry>` e TypeScript não considera uma assinatura
 * de índice numérica atribuível a uma de string, ainda que `Object.keys` e
 * `Object.values` funcionem igual nas duas. É um detalhe de tipagem do
 * `gi-data`, não uma afirmação sobre o dado.
 */
export function characterCatalog(): Record<string, { slug: string }> {
  return loadCharacters() as unknown as Record<string, { slug: string }>;
}

/** Todos os slugs do catálogo, ordenados. */
export function characterSlugs(): readonly string[] {
  return Object.values(characterCatalog())
    .map((e) => e.slug)
    .sort();
}

export interface UnknownTarget {
  readonly slug: string;
  /** Slugs próximos do que foi digitado. Vazio quando nada se parece. */
  readonly suggestions: readonly string[];
}

/**
 * Distância de edição, com teto: nada além de `max` interessa, e sair cedo
 * evita percorrer 120 slugs inteiros por alvo.
 */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = [...Array(b.length + 1).keys()];
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row.push(Math.min(row[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost));
    }
    if (Math.min(...row) > max) return max + 1;
    prev = row;
  }
  return prev[b.length]!;
}

/**
 * Cruza os alvos pedidos contra o catálogo ANTES de qualquer chamada de API.
 *
 * `--only xianglin` (um typo) virava alvo real: duas chamadas pagas, pesquisa
 * sobre um personagem que não existe, e só então `writeDraft` recusava. O
 * catálogo já está carregado uma linha acima de onde o lote começa a gastar —
 * conferir ali custa nada.
 */
export function checkTargets(
  requested: readonly string[],
  known: readonly string[],
): readonly UnknownTarget[] {
  const set = new Set(known);
  const out: UnknownTarget[] = [];
  for (const slug of requested) {
    if (set.has(slug)) continue;
    const suggestions = known
      .map((candidate) => ({ candidate, d: editDistance(slug, candidate, 3) }))
      .filter((x) => x.d <= 3)
      .sort((a, b) => a.d - b.d || a.candidate.localeCompare(b.candidate))
      .slice(0, 5)
      .map((x) => x.candidate);
    out.push({ slug, suggestions });
  }
  return out;
}

/** A mensagem de erro de uso, já formatada, para os dois lotes. */
export function describeUnknownTargets(unknown: readonly UnknownTarget[]): string {
  return unknown
    .map((u) =>
      u.suggestions.length === 0
        ? `"${u.slug}" não existe no catálogo do gi-data`
        : `"${u.slug}" não existe no catálogo do gi-data — você quis dizer ${u.suggestions.join(', ')}?`,
    )
    .join('\n');
}
