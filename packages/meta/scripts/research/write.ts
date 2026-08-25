// packages/meta/scripts/research/write.ts
//
// Reconciliação -> RawCharacterProfile, e a borda que RECUSA.
//
// Recusar importa mais que montar: uma ficha incompleta gravada em
// data/characters/ é carregada por loadMeta() e quebra os casos-âncora e os
// testes de todos os outros pacotes. A pesquisa que não deu o mínimo vira
// relatório, não arquivo.

import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { StatTarget } from '@buer/core';
import type { RawCharacterProfile } from '../../src/types.js';
import { validateMeta } from '../../src/validate.js';
import { DATA_DIR } from '../catalog.js';
import { SOURCE_IDS, type CharacterClaims, type ReconcileResult } from './claims.js';

export interface DraftDeps {
  readonly character: string;
  readonly reconciled: ReconcileResult;
  readonly claims: CharacterClaims;
  readonly gameVersion: string;
  /** Injetado, nunca `new Date()`: o rascunho precisa ser reproduzível. */
  readonly authoredAt: string;
  /**
   * As URLs que a busca web DE FATO consultou (`ResearchOutput.urls`).
   *
   * É isto — e só isto — que vai para `provenance.sources`. A Global
   * Constraint do plano diz "toda URL CONSULTADA vai para
   * `MetaProvenance.sources`", e antes daqui ia a URL que o MODELO declarou
   * no passo de extração: uma afirmação do modelo apresentada como registro
   * de acesso. O valor real existia desde a Task 3, com teste, e o lote de
   * personagens simplesmente nunca o lia.
   *
   * Obrigatório de propósito: um parâmetro opcional aqui voltaria em silêncio
   * para a afirmação do modelo no dia em que alguém esquecesse de passá-lo.
   */
  readonly consultedUrls: readonly string[];
  /** A pesquisa saiu cortada por esgotar `maxResumes` (`ResearchOutput.truncated`). */
  readonly truncated: boolean;
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

/**
 * Um valor de `bySource` legível para humano. `bySourceOf` (reconcile.ts)
 * usa `JSON.stringify` uniformemente sobre o `value` de cada voto — um
 * escalar string sai entre aspas literais (`'"atk"'`), uma lista sai como
 * array JSON (`'["a","b"]'`), um número sai limpo (`'200'`). Isso é tratado
 * AQUI, na renderização, e não em `reconcile.ts`: aquele arquivo já passou
 * por revisão e o formato de `bySource` é contrato entre as duas funções.
 */
function renderDivergenceValue(raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw; // não deveria acontecer — bySource sempre vem de JSON.stringify.
  }
  if (typeof parsed === 'string') return parsed;
  if (Array.isArray(parsed)) return parsed.join(', ');
  return String(parsed);
}

function describeDivergences(reconciled: ReconcileResult): string {
  if (reconciled.divergences.length === 0) return '';
  const linhas = reconciled.divergences.map((d) => {
    const partes = Object.entries(d.bySource).map(
      ([fonte, valor]) => `${fonte}: ${renderDivergenceValue(valor)}`,
    );
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
  const targets: StatTarget[] =
    agreed.erThreshold !== undefined && why !== undefined
      ? [
          {
            kind: 'min',
            stat: 'enerRech_',
            value: agreed.erThreshold,
            hard: true,
            why,
          },
        ]
      : [];
  if (agreed.erThreshold !== undefined && why === undefined) {
    notasExtras.push(
      `As fontes citam um limiar de ER de ${agreed.erThreshold}%, mas nenhuma explicou por quê — ` +
        'o alvo foi omitido em vez de receber uma justificativa inventada (sem justificativa em fonte nenhuma).',
    );
  }

  // As URLs que a extração declarou e a busca não confirmou NÃO somem: viram
  // nota, nomeadas como não confirmadas. O que não podem é entrar em
  // `sources`, que afirma acesso.
  const consultadas = new Set(deps.consultedUrls);
  const declaradasNaoConfirmadas = deps.reconciled.sources.filter((u) => !consultadas.has(u));
  if (declaradasNaoConfirmadas.length > 0) {
    notasExtras.push(
      [
        'URLs citadas pela extração e não confirmadas na busca — ficam FORA de ' +
          '`provenance.sources`, que lista só o que a busca web de fato consultou:',
        ...declaradasNaoConfirmadas.map((u) => `- ${u}`),
      ].join('\n'),
    );
  }
  if (deps.consultedUrls.length === 0) {
    notasExtras.push(
      'A busca web não devolveu URL nenhuma para esta ficha: `provenance.sources` ' +
        'está vazio de propósito, e não preenchido com o que a extração declarou.',
    );
  }
  if (deps.truncated) {
    notasExtras.push(
      'PESQUISA TRUNCADA: o teto de retomadas foi atingido com o turno de busca ainda ' +
        'pausado. Um campo ausente nesta ficha pode ser lacuna da pesquisa, e não da fonte — ' +
        'repita a pesquisa deste personagem antes de promover a confiança.',
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
      // As URLs CONSULTADAS, não as declaradas pelo modelo. Ver `consultedUrls`.
      sources: [...deps.consultedUrls],
      authoredAt: deps.authoredAt,
      validatedForVersion: deps.gameVersion,
      // Sai da reconciliação, nunca do modelo, e nunca 'high'.
      confidence: deps.reconciled.confidence,
    },
  };

  return { profile, refusedBecause: [], notes };
}

/**
 * Grava o texto bruto da pesquisa em `data/research/<fileBase>.md`.
 *
 * Chamado ASSIM QUE a pesquisa volta, antes de qualquer decisão de recusar.
 * Antes disto o `.md` só era escrito dentro de `writeDraft` — isto é, depois
 * do `validateMeta` —, então nos dois caminhos de falha (rascunho recusado e
 * exceção) as chamadas de API já estavam pagas e o texto era descartado. O
 * plano justifica a arquitetura de duas chamadas dizendo que ela "deixa o
 * texto da pesquisa como artefato para o revisor humano ler"; o revisor o
 * perdia exatamente no caso em que mais precisaria dele.
 */
export function writeResearchText(fileBase: string, heading: string, text: string): void {
  mkdirSync(path.join(DATA_DIR, 'research'), { recursive: true });
  writeFileSync(path.join(DATA_DIR, 'research', `${fileBase}.md`), `# ${heading}\n\n${text}\n`, 'utf8');
}

export interface DraftIo {
  /** Valida contra o banco INTEIRO antes de gravar. */
  readonly existing: Parameters<typeof validateMeta>[0];
}

/**
 * Grava o rascunho. LANÇA se a ficha nova invalidar o banco — a borda rejeita
 * antes do disco, não depois. O texto da pesquisa já foi para o disco antes,
 * via `writeResearchText`: ele não pode depender de a ficha ser aceita.
 */
export function writeDraft(draft: DraftResult, io: DraftIo): void {
  if (!draft.profile) throw new Error('rascunho recusado; nada a gravar');

  // SUBSTITUI a ficha deste personagem em vez de anexar: a regra de
  // integridade que a Fase 2 acrescentou rejeita `character` duplicado entre
  // fichas, e repesquisar alguém que já tem ficha lançaria "duplicado" em
  // vez de atualizar.
  const outros = io.existing.profiles.filter((p) => p.character !== draft.profile!.character);
  const problems = validateMeta({
    profiles: [...outros, draft.profile],
    archetypes: io.existing.archetypes,
  });
  if (problems.length > 0) {
    throw new Error(`rascunho de "${draft.profile.character}" inválido:\n  - ${problems.join('\n  - ')}`);
  }

  writeFileSync(
    path.join(DATA_DIR, 'characters', `${draft.profile.character}.json`),
    `${JSON.stringify(draft.profile, null, 2)}\n`,
    'utf8',
  );
}
