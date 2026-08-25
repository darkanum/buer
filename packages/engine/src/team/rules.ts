import type { Element } from '@buer/core';
import type { ReactionAvailability, ReactionKey, ResonanceEffect } from '../interfaces.js';

/**
 * Reações e o que cada uma exige. Isto é REGRA DE JOGO, não meta: sai dos
 * elementos presentes e é verdade para qualquer time, com confiança alta e
 * sem depender de curadoria nenhuma.
 *
 * `anyOf` existe para swirl e crystallize, que precisam do elemento base
 * MAIS qualquer um de um conjunto.
 */
interface ReactionRule {
  readonly reaction: ReactionKey;
  readonly all: readonly Element[];
  readonly anyOf?: readonly Element[];
}

const AURA: readonly Element[] = ['pyro', 'hydro', 'cryo', 'electro'];

const REACTIONS: readonly ReactionRule[] = [
  { reaction: 'vaporize', all: ['pyro', 'hydro'] },
  { reaction: 'melt', all: ['pyro', 'cryo'] },
  { reaction: 'overloaded', all: ['pyro', 'electro'] },
  { reaction: 'electro-charged', all: ['hydro', 'electro'] },
  { reaction: 'frozen', all: ['hydro', 'cryo'] },
  { reaction: 'superconduct', all: ['cryo', 'electro'] },
  { reaction: 'burning', all: ['pyro', 'dendro'] },
  { reaction: 'bloom', all: ['hydro', 'dendro'] },
  { reaction: 'quicken', all: ['electro', 'dendro'] },
  { reaction: 'hyperbloom', all: ['hydro', 'dendro', 'electro'] },
  { reaction: 'burgeon', all: ['hydro', 'dendro', 'pyro'] },
  { reaction: 'swirl', all: ['anemo'], anyOf: AURA },
  { reaction: 'crystallize', all: ['geo'], anyOf: AURA },
];

export function reactionsFor(elements: readonly Element[]): ReactionAvailability[] {
  const present = new Set(elements);

  return REACTIONS.map((rule): ReactionAvailability => {
    const missingAll = rule.all.filter((e) => !present.has(e));
    const anyOfSatisfied = rule.anyOf === undefined || rule.anyOf.some((e) => present.has(e));
    const satisfied = missingAll.length === 0 && anyOfSatisfied;

    const missing: Element[] = [...missingAll];
    if (missingAll.length === 0 && !anyOfSatisfied && rule.anyOf) missing.push(...rule.anyOf);

    return {
      reaction: rule.reaction,
      requires: { elements: [...rule.all, ...(rule.anyOf ?? [])] },
      satisfied,
      missing,
    };
  });
}

/** Ressonância elemental: 2 ou mais do mesmo elemento no time de 4. */
const RESONANCE: Readonly<Record<Element, Omit<ResonanceEffect, 'id'>>> = {
  pyro: { stats: { atk_: 25 }, conditional: 'Ressonância Ardente: +25% ATQ.' },
  hydro: { stats: { hp_: 25 }, conditional: 'Ressonância Fervorosa: +25% Vida.' },
  cryo: {
    stats: { critRate_: 15 },
    conditional: 'Ressonância Cristalina: +15% de Taxa Crítica contra alvos afetados por Cryo ou congelados.',
  },
  electro: {
    particleGeneration: { element: 'electro', cooldownSeconds: 5, onReactions: ['overloaded', 'electro-charged', 'superconduct'] },
    conditional: 'Ressonância Impetuosa: gera partícula de Electro ao causar reação relacionada.',
  },
  geo: { stats: { shield_: 15 }, conditional: 'Ressonância Inabalável: +15% de Força do Escudo e bônus de dano com escudo ativo.' },
  anemo: { conditional: 'Ressonância Impetuosa dos Ventos: -15% de tempo de recarga e -15% de consumo de vigor.' },
  dendro: { stats: { eleMas: 50 }, conditional: 'Ressonância Exuberante: +50 de Maestria Elemental, com mais sob reação.' },
};

export function resonanceFor(elements: readonly Element[]): ResonanceEffect[] {
  const counts = new Map<Element, number>();
  for (const element of elements) counts.set(element, (counts.get(element) ?? 0) + 1);

  const out: ResonanceEffect[] = [];
  for (const [element, count] of counts) {
    if (count < 2) continue;
    const effect = RESONANCE[element];
    if (effect) out.push({ id: element, ...effect });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
