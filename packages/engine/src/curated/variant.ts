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
