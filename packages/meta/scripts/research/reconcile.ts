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
