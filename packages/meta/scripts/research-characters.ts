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
import { extractClaims, type ExtractResult } from './research/extract.js';
import { reconcileCharacter } from './research/reconcile.js';
import { buildDraft, writeDraft, type DraftResult } from './research/write.js';

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
  /**
   * Erro de uso encontrado no parsing (hoje só `--limit` com valor inválido).
   * `undefined` quando os flags fazem sentido. Quem chama decide o que fazer
   * com isso — `parseArgs` só relata, nunca chama `process.exit`.
   */
  readonly error: string | undefined;
}

export function parseArgs(argv: readonly string[]): BatchFlags {
  let only: string[] = [];
  let all = false;
  let limit: number | undefined;
  let dryRun = false;
  let error: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--only') {
      only = (argv[++i] ?? '').split(',').map((s) => s.trim()).filter((s) => s !== '');
    } else if (arg === '--all') all = true;
    else if (arg === '--limit') {
      // Só consome o próximo token se ele existir e não for outra flag. Sem
      // essa guarda, `--all --limit --dry-run` engole o `--dry-run`: a flag
      // que existe para não gastar dinheiro sumiria em silêncio.
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        error = '--limit exige um número inteiro positivo logo em seguida';
      } else {
        i++;
        const n = Number(next);
        if (!Number.isInteger(n) || n <= 0) {
          error = `--limit "${next}" não é um número inteiro positivo`;
        } else {
          limit = n;
        }
      }
    } else if (arg === '--dry-run') dryRun = true;
  }

  return { only, all, limit, dryRun, error };
}

export interface BatchDeps {
  readonly targets: readonly string[];
  readonly gameVersion: string;
  readonly authoredAt: string;
  readonly existing: RawMeta;
  readonly research: (slug: string) => Promise<ResearchOutput>;
  readonly extract: (slug: string, text: string) => Promise<ExtractResult>;
  readonly write: (draft: DraftResult, io: { researchText: string; existing: RawMeta }) => void;
  readonly onProgress?: (line: string) => void;
}

export interface BatchReport {
  readonly written: readonly string[];
  readonly refused: readonly { readonly slug: string; readonly because: readonly string[] }[];
  readonly failed: readonly { readonly slug: string; readonly error: string }[];
  /**
   * Nomes descartados por não resolverem no catálogo (conjunto, arma, papel,
   * ou — no lote de times — o próprio personagem), por alvo. `runBatch` não
   * enxerga isso sozinho: quem popula é `withUnresolvedTracking`, que envolve
   * `deps.extract` na entrada de CLI. Um campo aqui, mesmo que `runBatch`
   * sempre devolva `[]`, é o que permite `formatBatchReport` mostrar os dois
   * lotes (personagens e times) do mesmo jeito.
   */
  readonly unresolved: readonly { readonly slug: string; readonly names: readonly string[] }[];
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
  readonly estimatedCostUsd: number;
}

/**
 * Envolve uma função de extração para acumular, por alvo, os nomes que ela
 * descartou por não resolverem no catálogo — sem mudar a forma que `runBatch`
 * espera de `BatchDeps.extract` (`(slug, text) => Promise<{claims; usage}>`).
 *
 * Existe porque o mecanismo `onUnresolved` (Task 4/7) tinha comprador nenhum:
 * a função existia, mas nenhuma entrada de CLI a ligava — o descarte era
 * 100% silencioso em produção, sem log e sem linha de relatório. Devolver um
 * `extract` já instrumentado, mais o acumulador que ele escreve, deixa a
 * ligação testável sem precisar rodar a CLI inteira.
 */
export function withUnresolvedTracking<T>(
  extract: (
    slug: string,
    text: string,
    onUnresolved: (source: string, names: readonly string[]) => void,
  ) => Promise<T>,
): {
  readonly extract: (slug: string, text: string) => Promise<T>;
  readonly unresolved: readonly { readonly slug: string; readonly names: readonly string[] }[];
} {
  const unresolved: { slug: string; names: string[] }[] = [];
  return {
    unresolved,
    extract: async (slug, text) => {
      const names: string[] = [];
      const result = await extract(slug, text, (_source, ns) => names.push(...ns));
      if (names.length > 0) unresolved.push({ slug, names });
      return result;
    },
  };
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

      // A extração é a SEGUNDA chamada de API, não uma continuação grátis da
      // primeira. Somar só `research.usage` reportaria metade do custo real.
      const extracted = await deps.extract(slug, research.text);
      inputTokens += extracted.usage.inputTokens;
      outputTokens += extracted.usage.outputTokens;

      const claims = extracted.claims;
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
  // `unresolved` sempre vazio aqui: quem descarta nomes é `deps.extract`, e
  // `runBatch` não tem visibilidade sobre o que ele reporta a `onUnresolved`
  // — isso é papel de `withUnresolvedTracking`, na entrada de CLI.
  return { written, refused, failed, unresolved: [], usage, estimatedCostUsd: estimateCostUsd(usage) };
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

  lines.push(`NOMES NÃO RECONHECIDOS (descartados) (${report.unresolved.length})`);
  if (report.unresolved.length === 0) lines.push('  nenhum');
  else for (const u of report.unresolved) lines.push(`  ${u.slug}: ${u.names.join(', ')}`);
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

const USAGE = 'uso: meta:research:characters (--only <slug,slug> | --all) [--limit N] [--dry-run]';

if (import.meta.main) {
  const flags = parseArgs(process.argv.slice(2));

  if (flags.error !== undefined) {
    // Checado ANTES de tocar `--limit`: um valor inválido nunca deve virar
    // `NaN` e esvaziar o lote em silêncio via `targets.slice(0, NaN)`.
    console.error(flags.error);
    console.error(USAGE);
    process.exitCode = 1;
  } else {
    const raw = readRawMeta();
    const catalog = loadCharacters() as unknown as Record<string, { slug: string }>;
    const gameVersion = currentGameVersion();

    let targets = flags.only.length > 0
      ? [...flags.only]
      : flags.all
        ? [...computeGaps({ catalog, raw, currentVersion: gameVersion }).withoutProfile]
        : [];

    if (targets.length === 0) {
      console.error(USAGE);
      process.exitCode = 1;
    } else {
      if (flags.limit !== undefined) targets = targets.slice(0, flags.limit);

      if (flags.dryRun) {
        console.log(`${targets.length} alvo(s), 2 chamadas de API cada:`);
        console.log(`  ${targets.join(', ')}`);
        console.log('Nada foi chamado nem gravado (--dry-run).');
      } else {
        const client = createClient();
        const tracked = withUnresolvedTracking((slug, text, onUnresolved) =>
          extractClaims(slug, text, { client: client.messages, onUnresolved }),
        );
        const report = await runBatch({
          targets,
          gameVersion,
          authoredAt: new Date().toISOString().slice(0, 10),
          existing: raw,
          research: (slug) => researchCharacter(slug, { client: client.messages }),
          extract: tracked.extract,
          write: (draft, io) => writeDraft(draft, io),
          onProgress: (line) => console.log(line),
        });
        console.log(formatBatchReport({ ...report, unresolved: tracked.unresolved }));
      }
    }
  }
}
