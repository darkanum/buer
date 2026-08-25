import type { BuildVariant } from '@buer/meta';
import type { Build } from '../../interfaces.js';
import { statusFor, type Finding } from '../findings.js';

/** rank 1 -> 1.0, 2 -> 0.85, 3 -> 0.7; nunca abaixo de 0.4. */
function creditForRank(rank: number): number {
  return Math.max(0.4, 1 - 0.15 * (rank - 1));
}

/**
 * Arma fora da lista NÃO zera: a lista curada é um punhado de nomes, e o
 * jogo tem 249 armas. Uma arma não listada é falta de informação sobre ela,
 * não prova de que é ruim. Meio crédito e uma frase de conselho.
 */
const CREDIT_UNLISTED = 0.5;

export function checkWeapon(build: Build, variant: BuildVariant): Finding {
  if (variant.weapons.length === 0) {
    return { check: 'weapon', status: 'on-target', credit: 1, summary: 'A ficha não fixa arma.' };
  }

  const equipped = build.weapon;
  const option = variant.weapons.find((w) => w.weapon === equipped.key);

  if (!option) {
    const best = [...variant.weapons].sort((a, b) => a.rank - b.rank)[0]!;
    return {
      check: 'weapon',
      status: statusFor(CREDIT_UNLISTED),
      credit: CREDIT_UNLISTED,
      summary: `Arma ${equipped.key} não está na ficha; a de rank 1 é ${best.weapon}.`,
    };
  }

  const base = creditForRank(option.rank);
  const needsRefine = option.minRefinement !== undefined && equipped.refinement < option.minRefinement;
  const credit = needsRefine ? base * 0.8 : base;

  return {
    check: 'weapon',
    status: statusFor(credit),
    credit,
    summary: needsRefine
      ? `Arma ${equipped.key} (rank ${option.rank}) em R${equipped.refinement}; a ficha pede R${option.minRefinement}.`
      : `Arma ${equipped.key}, rank ${option.rank} da ficha.`,
  };
}
