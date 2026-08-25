import type { ObservedStats } from '@buer/core';
import type { BuildVariant, CharacterProfile, ScoringWeights } from '@buer/meta';
import type { Build } from '../interfaces.js';
import { assess } from './scoring.js';

export interface VariantChoice {
  readonly variant: BuildVariant;
  readonly reason: 'pinned' | 'archetype' | 'only' | 'best-match';
  /** Vai SEMPRE para a Explanation: o usuário precisa saber contra o quê foi julgado. */
  readonly explanation: string;
  /**
   * Interseção entre os papéis que o slot pede (`opts.slotRoles`) e os que a
   * variante escolhida DECLARA. Vazia quando o slot não pede papel nenhum —
   * e vazia também quando nenhuma variante da ficha cumpre o que o slot pede,
   * caso em que a `explanation` diz isso em voz alta.
   *
   * Existe para que `roleCoverage` (team/evaluator.ts) tenha de onde tirar a
   * verdade: o papel rotulado no slot não é prova de que o ocupante o cumpre.
   */
  readonly coveredSlotRoles: readonly string[];
}

export interface SelectVariantOptions {
  /** Variante que o usuário fixou. */
  readonly pinned?: string;
  /** Variante que o slot do arquétipo exige. */
  readonly fromArchetype?: string;
  /**
   * Papéis declarados pelo slot do arquétipo que este personagem vai ocupar.
   * Quando presentes, a regra 3 PREFERE uma variante que cubra ao menos um
   * deles — `candidatesFor` casa o personagem com o slot por `.some(...)`, e
   * julgá-lo depois contra uma variante de outro papel é julgá-lo contra
   * alvos que este time não pede.
   */
  readonly slotRoles?: readonly string[];
}

/** Papéis do slot que esta variante de fato declara. */
function covered(variant: BuildVariant, slotRoles: readonly string[]): string[] {
  const declared = new Set<string>(variant.roles);
  return slotRoles.filter((role) => declared.has(role));
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
 *
 * Quando o slot declara papéis (`slotRoles`), a regra 3 roda sobre as
 * variantes que cumprem ao menos um deles. Se nenhuma cumprir, a escolha é a
 * de sempre — mas a explicação REGISTRA a lacuna, porque "julgado contra uma
 * variante que não faz o que este slot pede" é informação que o usuário
 * precisa ter (spec §7.3), não um detalhe que se engole.
 */
export function selectVariant(
  profile: CharacterProfile,
  build: Build,
  stats: ObservedStats | null,
  weights: ScoringWeights,
  opts: SelectVariantOptions,
): VariantChoice {
  const slotRoles = opts.slotRoles ?? [];

  const byId = (id: string | undefined): BuildVariant | undefined =>
    id === undefined ? undefined : profile.variants.find((v) => v.id === id);

  /** Fecha a escolha, anexando a ressalva de papel quando ela existe. */
  const decide = (
    variant: BuildVariant,
    reason: VariantChoice['reason'],
    explanation: string,
  ): VariantChoice => {
    const coveredSlotRoles = covered(variant, slotRoles);
    const shortfall =
      slotRoles.length > 0 && coveredSlotRoles.length === 0
        ? ` Atenção: "${variant.label}" não cumpre o papel que este slot pede ` +
          `(${slotRoles.join('/')}) — a ficha não declara nenhuma variante que cumpra.`
        : '';
    return { variant, reason, explanation: explanation + shortfall, coveredSlotRoles };
  };

  const pinned = byId(opts.pinned);
  if (pinned) {
    return decide(pinned, 'pinned', `Julgado contra a variante "${pinned.label}", fixada por você.`);
  }

  const fromArchetype = byId(opts.fromArchetype);
  if (fromArchetype) {
    return decide(
      fromArchetype,
      'archetype',
      `Julgado contra a variante "${fromArchetype.label}", que este time exige.`,
    );
  }

  const first = profile.variants[0];
  if (!first) throw new Error(`ficha de ${profile.character} não declara variante nenhuma`);

  // O universo da regra 3: só as variantes que cumprem o papel do slot, se
  // alguma cumprir. Nenhuma cumprindo, volta a ser a ficha inteira — e o
  // `decide` acima carimba a ressalva.
  const fitting = slotRoles.length === 0
    ? profile.variants
    : profile.variants.filter((v) => covered(v, slotRoles).length > 0);
  const pool = fitting.length > 0 ? fitting : profile.variants;

  const head = pool[0]!;
  if (pool.length === 1) {
    return decide(
      head,
      'only',
      profile.variants.length === 1
        ? `Julgado contra "${head.label}", a única variante da ficha.`
        : `Julgado contra "${head.label}", a única variante desta ficha que cumpre ` +
          `o papel deste slot (${slotRoles.join('/')}).`,
    );
  }

  // Regra 3: pontua contra todas as do universo e fica com a melhor. Empate
  // (>=) preservado para a primeira da lista — a ordem declarada É a
  // prioridade de desempate.
  let best = head;
  let bestValue = assess(build, head, stats, weights).value;
  for (const variant of pool.slice(1)) {
    const value = assess(build, variant, stats, weights).value;
    if (value > bestValue) {
      best = variant;
      bestValue = value;
    }
  }

  const others = profile.variants.filter((v) => v.id !== best.id).map((v) => v.label);
  return decide(
    best,
    'best-match',
    `Julgado contra a variante "${best.label}" — foi a que a build equipada mais se aproxima. ` +
      `Outras desta ficha: ${others.join(', ')}.`,
  );
}
