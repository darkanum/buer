// packages/meta/scripts/research-archetypes.ts
//
// `meta:research:archetypes` — o lote de times. Mesma mecânica do lote de
// personagens (research-characters.ts): pesquisa -> extração -> montagem ->
// escrita, sequencial, um alvo por vez, falha de um alvo vira linha de
// relatório em vez de abortar o lote.
//
// A diferença que muda o formato do laço: aqui um alvo (um personagem) produz
// N arquétipos, não um. `buildArchetypeDrafts` já separa "recusado" de
// "aproveitável" por composição — o laço só precisa gravar cada aproveitável
// e contar cada um separadamente no relatório, e validar o LOTE inteiro do
// alvo contra o banco (existente + o que já foi gravado neste lote) antes de
// gravar qualquer um deles: um arquétipo que nomeia personagem sem ficha é
// rejeitado na borda, não descoberto pelo teste depois.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadCharacters } from '@buer/gi-data';
import type { RawMeta, RawTeamArchetype } from '../src/types.js';
import { readRawMeta } from '../src/load.js';
import { validateMeta } from '../src/validate.js';
import { computeGaps } from './gaps.js';
import { createClient, describeApiError } from './research/client.js';
import {
  researchArchetypes, extractArchetypes, buildArchetypeDrafts, archetypeCompositionKey,
  type ArchetypeClaims, type ArchetypeRefusal,
} from './research/archetype.js';
import { parseArgs, estimateCostUsd, formatBatchReport, withUnresolvedTracking, type BatchReport } from './research-characters.js';

export interface ArchetypeBatchDeps {
  readonly targets: readonly string[];
  readonly gameVersion: string;
  readonly existing: RawMeta;
  readonly research: (subject: string) => Promise<{
    readonly text: string;
    readonly urls: readonly string[];
    readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
  }>;
  readonly extract: (subject: string, text: string) => Promise<{
    readonly claims: ArchetypeClaims;
    readonly refused: readonly ArchetypeRefusal[];
    readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
  }>;
  readonly write: (archetype: RawTeamArchetype) => void;
  readonly onProgress?: (line: string) => void;
}

export async function runArchetypeBatch(deps: ArchetypeBatchDeps): Promise<BatchReport> {
  const written: string[] = [];
  const refused: { slug: string; because: readonly string[] }[] = [];
  const failed: { slug: string; error: string }[] = [];
  let inputTokens = 0;
  let outputTokens = 0;

  // Cresce a cada arquétipo gravado NESTE lote. A validação do próximo alvo
  // precisa enxergar os arquétipos que alvos anteriores já acrescentaram —
  // senão dois alvos do mesmo lote poderiam gravar o mesmo id sem que
  // ninguém acusasse.
  let knownArchetypes: readonly RawTeamArchetype[] = deps.existing.archetypes;

  for (const subject of deps.targets) {
    deps.onProgress?.(`pesquisando times de ${subject}…`);
    try {
      const research = await deps.research(subject);
      inputTokens += research.usage.inputTokens;
      outputTokens += research.usage.outputTokens;

      // A extração é a SEGUNDA chamada de API, não uma continuação grátis da
      // primeira — mesmo motivo do lote de personagens.
      const extracted = await deps.extract(subject, research.text);
      inputTokens += extracted.usage.inputTokens;
      outputTokens += extracted.usage.outputTokens;

      // Times inteiros que a EXTRAÇÃO já descartou (hoje: membro cujo nome
      // não resolveu no catálogo) entram no relatório do mesmo jeito que os
      // recusados por `buildArchetypeDrafts` — para quem lê o lote, as duas
      // recusas têm a mesma forma, só a origem muda.
      for (const r of extracted.refused) {
        refused.push({ slug: `${subject}:${r.id}`, because: r.because });
        deps.onProgress?.(`  recusado ${r.id}: ${r.because.join('; ')}`);
      }

      const draftResult = buildArchetypeDrafts({
        claims: extracted.claims,
        subject,
        gameVersion: deps.gameVersion,
        sources: research.urls,
      });

      for (const r of draftResult.refused) {
        refused.push({ slug: `${subject}:${r.id}`, because: r.because });
        deps.onProgress?.(`  recusado ${r.id}: ${r.because.join('; ')}`);
      }

      if (draftResult.archetypes.length === 0) {
        deps.onProgress?.('  nenhum arquétipo aproveitável');
        continue;
      }

      // Composições idênticas se FUNDEM dentro de uma chamada de
      // `buildArchetypeDrafts` (um alvo só), mas nada garantia isso ENTRE
      // alvos: Xiangling, Bennett e Xingqiu redescobrem o mesmo "National"
      // com ids diferentes, e o segundo alvo batia em "id duplicado" no
      // `validateMeta` — falha de forma segura, mas derrubava o lote inteiro
      // daquele alvo por uma composição que já estava no banco. Aqui a
      // identidade é a COMPOSIÇÃO (`archetypeCompositionKey`), não o id: o
      // que já existe fica como está, o resto segue para validação.
      const knownCompositions = new Set(knownArchetypes.map(archetypeCompositionKey));
      const freshArchetypes: RawTeamArchetype[] = [];
      for (const archetype of draftResult.archetypes) {
        const key = archetypeCompositionKey(archetype);
        if (knownCompositions.has(key)) {
          deps.onProgress?.(
            `  já conhecido (mesma composição de um arquétipo existente, não regravado): ${archetype.id}`,
          );
          continue;
        }
        knownCompositions.add(key); // não regrava a mesma composição duas vezes dentro do próprio alvo
        freshArchetypes.push(archetype);
      }

      if (freshArchetypes.length === 0) {
        deps.onProgress?.('  nenhum arquétipo novo (todos já conhecidos ou recusados)');
        continue;
      }

      // Valida TODOS os arquétipos NOVOS deste alvo contra o banco inteiro
      // ANTES de gravar qualquer um deles.
      const problems = validateMeta({
        profiles: deps.existing.profiles,
        archetypes: [...knownArchetypes, ...freshArchetypes],
      });
      if (problems.length > 0) {
        failed.push({ slug: subject, error: `arquétipos inválidos: ${problems.join('; ')}` });
        deps.onProgress?.(`  falhou: ${problems.join('; ')}`);
        continue;
      }

      for (const archetype of freshArchetypes) {
        deps.write(archetype);
        written.push(archetype.id);
        deps.onProgress?.(`  gravado ${archetype.id} (${archetype.strength})`);
      }
      knownArchetypes = [...knownArchetypes, ...freshArchetypes];
    } catch (e) {
      const error = describeApiError(e);
      failed.push({ slug: subject, error });
      deps.onProgress?.(`  falhou: ${error}`);
    }
  }

  const usage = { inputTokens, outputTokens };
  // Igual a `runBatch`: quem popula `unresolved` de verdade é
  // `withUnresolvedTracking`, na entrada de CLI — aqui fica sempre vazio.
  return { written, refused, failed, unresolved: [], usage, estimatedCostUsd: estimateCostUsd(usage) };
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, '..', 'data');

function currentGameVersion(): string {
  const file = path.join(DATA, 'game-version.json');
  return (JSON.parse(readFileSync(file, 'utf8')) as { version: string }).version;
}

const USAGE = 'uso: meta:research:archetypes (--only <slug,slug> | --all) [--limit N] [--dry-run]';

if (import.meta.main) {
  const flags = parseArgs(process.argv.slice(2));

  if (flags.error !== undefined) {
    console.error(flags.error);
    console.error(USAGE);
    process.exitCode = 1;
  } else {
    const raw = readRawMeta();
    const catalog = loadCharacters() as unknown as Record<string, { slug: string }>;
    const gameVersion = currentGameVersion();

    // `--all` pesquisa times para quem já tem ficha mas ainda não aparece em
    // nenhum arquétipo — a mesma lista que `meta:gaps` chama de "com ficha,
    // mas em nenhum arquétipo" (computeGaps().withoutArchetype).
    let targets = flags.only.length > 0
      ? [...flags.only]
      : flags.all
        ? [...computeGaps({ catalog, raw, currentVersion: gameVersion }).withoutArchetype]
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
        mkdirSync(path.join(DATA, 'archetypes'), { recursive: true });
        const tracked = withUnresolvedTracking((subject, text, onUnresolved) =>
          extractArchetypes(subject, text, { client: client.messages, onUnresolved }),
        );
        const report = await runArchetypeBatch({
          targets,
          gameVersion,
          existing: raw,
          research: (subject) => researchArchetypes(subject, { client: client.messages }),
          extract: tracked.extract,
          write: (archetype) => {
            writeFileSync(
              path.join(DATA, 'archetypes', `${archetype.id}.json`),
              `${JSON.stringify(archetype, null, 2)}\n`,
              'utf8',
            );
          },
          onProgress: (line) => console.log(line),
        });
        console.log(formatBatchReport({ ...report, unresolved: tracked.unresolved }));
      }
    }
  }
}
