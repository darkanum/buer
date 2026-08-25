import type { BuildVariant } from '@buer/meta';
import type { ArtifactSetKey } from '@buer/core';
import type { Build } from '../../interfaces.js';
import { statusFor, type Finding } from '../findings.js';

/** setKey -> quantas peças equipadas. */
function equippedCounts(build: Build): ReadonlyMap<ArtifactSetKey, number> {
  const counts = new Map<ArtifactSetKey, number>();
  for (const piece of Object.values(build.artifacts)) {
    if (!piece) continue;
    counts.set(piece.setKey, (counts.get(piece.setKey) ?? 0) + 1);
  }
  return counts;
}

/** rank 1 -> 1.0, rank 2 -> 0.75, rank 3 -> 0.5, … nunca abaixo de 0.25. */
function creditForRank(rank: number): number {
  return Math.max(0.25, 1 - 0.25 * (rank - 1));
}

export function checkSet(build: Build, variant: BuildVariant): Finding {
  const counts = equippedCounts(build);
  const equipped = [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1]);

  let best: { credit: number; label: string } | null = null;

  for (const option of variant.sets) {
    const satisfied =
      option.kind === '4pc'
        ? (counts.get(option.sets[0]!) ?? 0) >= 4
        : option.sets.every((s) => (counts.get(s) ?? 0) >= 2);
    if (!satisfied) continue;
    const credit = creditForRank(option.rank);
    const label = option.kind === '4pc' ? `4pc rank ${option.rank}` : `2+2 rank ${option.rank}`;
    if (!best || credit > best.credit) best = { credit, label };
  }

  if (!best) {
    const describe =
      equipped.length === 0
        ? 'nenhum bônus de conjunto ativo'
        : equipped.map(([key, n]) => `${n}pc de ${key}`).join(' + ');
    return {
      check: 'set',
      status: 'off-target',
      credit: 0,
      summary: `Conjunto fora da ficha: ${describe}.`,
    };
  }

  return {
    check: 'set',
    status: statusFor(best.credit),
    credit: best.credit,
    summary: `Conjunto ${best.label} da ficha.`,
  };
}
