import type { BuildVariant } from '@buer/meta';
import type { Build } from '../../interfaces.js';
import { statusFor, type Finding } from '../findings.js';

const SLOTS = ['sands', 'goblet', 'circlet'] as const;

/** posição 0 -> 1.0, 1 -> 0.75, 2 -> 0.5; nunca abaixo de 0.5 quando está na lista. */
function creditForIndex(index: number): number {
  return Math.max(0.5, 1 - 0.25 * index);
}

export function checkMainStats(build: Build, variant: BuildVariant): Finding {
  const scored: number[] = [];
  const wrong: string[] = [];

  for (const slot of SLOTS) {
    const wanted = variant.mainStats[slot];
    // Ficha sem preferência para o slot: não é acerto nem erro, sai da conta.
    if (wanted.length === 0) continue;

    const piece = build.artifacts[slot];
    if (!piece) {
      scored.push(0);
      wrong.push(`${slot} vazio`);
      continue;
    }

    const index = wanted.indexOf(piece.mainStatKey);
    if (index < 0) {
      scored.push(0);
      wrong.push(`${slot} com ${piece.mainStatKey} (a ficha pede ${wanted.join(' ou ')})`);
    } else {
      scored.push(creditForIndex(index));
    }
  }

  if (scored.length === 0) {
    return { check: 'mainStats', status: 'on-target', credit: 1, summary: 'A ficha não fixa main-stats.' };
  }

  const credit = scored.reduce((a, b) => a + b, 0) / scored.length;
  return {
    check: 'mainStats',
    status: statusFor(credit),
    credit,
    summary: wrong.length === 0 ? 'Main-stats conforme a ficha.' : `Main-stat fora do alvo: ${wrong.join('; ')}.`,
  };
}
