import type { ObservedStats } from '@buer/core';
import type { Build } from './interfaces.js';

/**
 * A ÚNICA porta por onde o motor lê stats de uma build.
 *
 * Nenhum avaliador pode ler `build.observedStats` direto. A regra existe
 * para que a Fase 3 entregue um `ComputedStatResolver` (curvas + ascensão +
 * arma + artefatos + bônus de set) e ganhe comparação de builds hipotéticas
 * TROCANDO esta implementação — mesmas fichas, mesmo avaliador, mesmo
 * scoring. É a lição do Genshin Optimizer, que acoplou solver e motor de
 * fórmula e ficou preso numa migração.
 *
 * `null` significa "não sei", nunca zero: um stat ausente e um stat que vale
 * zero levam a vereditos opostos.
 */
export interface StatResolver {
  readonly id: string;
  resolve(build: Build): Promise<ObservedStats | null>;
}

/** Fase 2: lê o que a captura já trouxe. Não calcula nada. */
export class ObservedStatResolver implements StatResolver {
  readonly id = 'observed';

  async resolve(build: Build): Promise<ObservedStats | null> {
    return build.observedStats ?? null;
  }
}
