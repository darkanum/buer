import type { ObservedStats } from '@buer/core';
import type { BuildVariant, ScoringWeights } from '@buer/meta';
import type { Build } from '../interfaces.js';
import type { CheckId, Finding } from './findings.js';
import { defaultKeyNames, type KeyNames } from './names.js';
import { checkSet } from './checks/set.js';
import { checkMainStats } from './checks/main-stats.js';
import { checkTargets } from './checks/targets.js';
import type { ViolatedTarget } from './checks/targets.js';
import { checkWeapon } from './checks/weapon.js';
import { checkSubstats } from './checks/substats.js';

export interface CuratedAssessment {
  readonly findings: readonly Finding[];
  /** Só para ORDENAR. O produto é a lista de achados. */
  readonly value: number;
  readonly breakdown: Readonly<Record<CheckId, number>>;
  /** Alvos hard violados, cada um com o valor MEDIDO real (spec: sem número fabricado). */
  readonly violated: readonly ViolatedTarget[];
  readonly blocked: boolean;
}

/**
 * Penalidade de bloqueio. Subtrair uma constante maior que a soma máxima dos
 * pesos garante que TODA build com alvo hard violado fique abaixo de TODA
 * build sem bloqueio, sem achatar a ordenação dentro de cada grupo — não se
 * compensa ER insuficiente com crit bom (spec §6.3).
 */
const BLOCKED_PENALTY = 1000;

export function assess(
  build: Build,
  variant: BuildVariant,
  stats: ObservedStats | null,
  weights: ScoringWeights,
  // Tradutor de chave -> nome legível, injetado (curated/names.ts). O default
  // é o catálogo do gi-data porque a saída é para humano ler; quem testa
  // troca por um dublê. As cinco verificações continuam puras: elas recebem
  // o tradutor, não abrem catálogo nenhum.
  names: KeyNames = defaultKeyNames,
): CuratedAssessment {
  const targets = checkTargets(stats, variant.targets);

  const findings: Finding[] = [
    checkSet(build, variant, names),
    checkMainStats(build, variant),
    targets.finding,
    checkWeapon(build, variant, names),
    checkSubstats(build, variant),
  ];

  const weightOf: Readonly<Record<CheckId, number>> = {
    set: weights.set,
    mainStats: weights.mainStats,
    targets: weights.targets,
    weapon: weights.weapon,
    substats: weights.substats,
  };

  const breakdown = {} as Record<CheckId, number>;
  let value = 0;
  for (const finding of findings) {
    const contribution = weightOf[finding.check] * finding.credit;
    breakdown[finding.check] = contribution;
    value += contribution;
  }

  const blocked = findings.some((f) => f.status === 'blocking');
  return {
    findings,
    value: blocked ? value - BLOCKED_PENALTY : value,
    breakdown,
    violated: targets.violated,
    blocked,
  };
}
