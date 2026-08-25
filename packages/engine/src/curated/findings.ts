/**
 * O avaliador curado produz ACHADOS, não uma nota (spec §6.2). Cada achado
 * é explicável sozinho: diz o que verificou, como saiu, e por quê. A nota
 * (§6.3) é derivada disto só para ordenar.
 */
export type CheckId = 'set' | 'mainStats' | 'targets' | 'weapon' | 'substats';

export type FindingStatus = 'on-target' | 'acceptable' | 'off-target' | 'blocking';

export interface Finding {
  readonly check: CheckId;
  readonly status: FindingStatus;
  /** 0..1 — quanto desta verificação foi cumprido. Multiplica o peso. */
  readonly credit: number;
  /** Uma frase, pronta para exibir. */
  readonly summary: string;
  /** O `why` do alvo curado, quando houver. */
  readonly why?: string;
  /** Limite conhecido do que se pode afirmar aqui. */
  readonly caveat?: string;
}

/**
 * Crédito -> status. Os cortes são deliberadamente generosos: o produto
 * existe para orientar, não para reprovar. `blocking` NUNCA sai daqui —
 * só de alvo `hard` violado, que a verificação de alvos decide.
 */
export function statusFor(credit: number): Exclude<FindingStatus, 'blocking'> {
  if (credit >= 0.9) return 'on-target';
  if (credit >= 0.6) return 'acceptable';
  return 'off-target';
}
