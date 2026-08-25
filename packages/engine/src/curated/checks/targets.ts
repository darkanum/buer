import type { ObservedStats, StatTarget } from '@buer/core';
import { statusFor, type Finding } from '../findings.js';

/**
 * Um alvo `hard` violado, com o número MEDIDO de verdade — não só o alvo
 * cru. `Score.violations` (spec §6.3, contrato de proveniência) proíbe
 * número sem origem rastreável: `actual` é o que a build tem, `required` é
 * o limiar que a ficha exige, e os dois vêm de `evaluate()`, nunca de um
 * literal inventado no consumidor.
 */
export interface ViolatedTarget {
  readonly target: StatTarget;
  readonly actual: number;
  readonly required: number;
}

export interface TargetsResult {
  readonly finding: Finding;
  /** Alvos `hard` violados — viram Score.violations (spec §6.3). */
  readonly violated: readonly ViolatedTarget[];
}

interface Evaluated {
  readonly ok: boolean;
  readonly credit: number;
  readonly hard: boolean;
  readonly message: string;
  readonly target: StatTarget;
  /** Valor medido de verdade — o que sobrevive até `Score.violations`. */
  readonly actual: number;
  /** Limiar exigido pela ficha/arquétipo para este alvo. */
  readonly required: number;
}

function evaluate(target: StatTarget, stats: ObservedStats): Evaluated | null {
  if (target.kind === 'min') {
    // Alvo mal configurado (value <= 0) não afirma nada: descartar em vez de
    // dividir por zero/negativo, que é como o ramo `ratio` já se protege.
    if (target.value <= 0) return null;
    const actual = stats[target.stat];
    if (actual === undefined) return null;
    const ok = actual >= target.value;
    return {
      ok,
      credit: ok ? 1 : Math.max(0, Math.min(1, actual / target.value)),
      hard: target.hard,
      message: `${target.stat} ${actual.toFixed(1)} (alvo ${target.value})`,
      target,
      actual,
      required: target.value,
    };
  }

  if (target.kind === 'range') {
    const actual = stats[target.stat];
    if (actual === undefined) return null;
    const ok = actual >= target.min && actual <= target.max;
    return {
      ok,
      credit: ok ? 1 : 0.5,
      hard: false,
      message: `${target.stat} ${actual.toFixed(1)} (faixa ${target.min}–${target.max})`,
      target,
      actual,
      required: target.min,
    };
  }

  const num = stats[target.numerator];
  const den = stats[target.denominator];
  if (num === undefined || den === undefined || den === 0) return null;
  const ratio = num / den;
  const ok = ratio >= target.min && ratio <= target.max;
  return {
    ok,
    credit: ok ? 1 : 0.5,
    hard: false,
    message: `${target.numerator}/${target.denominator} = ${ratio.toFixed(2)} (faixa ${target.min}–${target.max})`,
    target,
    actual: ratio,
    required: target.min,
  };
}

/**
 * A única verificação que pode produzir BLOQUEIO — e só por alvo `hard`
 * violado. Sem stats resolvidos não afirma nada: crédito 0 com ressalva, em
 * vez de um veredito inventado.
 */
export function checkTargets(stats: ObservedStats | null, targets: readonly StatTarget[]): TargetsResult {
  if (targets.length === 0) {
    return {
      finding: { check: 'targets', status: 'on-target', credit: 1, summary: 'A ficha não fixa alvos numéricos.' },
      violated: [],
    };
  }

  if (stats === null) {
    return {
      finding: {
        check: 'targets',
        status: 'off-target',
        credit: 0,
        summary: 'Alvos numéricos não verificados.',
        caveat: 'Sem stats resolvidos para esta build — nada foi afirmado sobre ER, crit ou maestria.',
      },
      violated: [],
    };
  }

  const evaluated = targets.map((t) => evaluate(t, stats)).filter((e): e is Evaluated => e !== null);

  if (evaluated.length === 0) {
    return {
      finding: {
        check: 'targets',
        status: 'off-target',
        credit: 0,
        summary: 'Alvos numéricos não verificados.',
        caveat: 'A captura não trouxe os stats que estes alvos exigem.',
      },
      violated: [],
    };
  }

  const blocking = evaluated.filter((e) => e.hard && !e.ok);
  const credit = evaluated.reduce((a, e) => a + e.credit, 0) / evaluated.length;
  const failed = evaluated.filter((e) => !e.ok);

  const summary =
    failed.length === 0
      ? `Alvos cumpridos: ${evaluated.map((e) => e.message).join('; ')}.`
      : `Fora do alvo: ${failed.map((e) => e.message).join('; ')}.`;

  const why = failed.length > 0 ? failed.map((e) => e.target.why).join(' ') : undefined;

  return {
    finding: {
      check: 'targets',
      status: blocking.length > 0 ? 'blocking' : statusFor(credit),
      credit,
      summary,
      ...(why === undefined ? {} : { why }),
    },
    violated: blocking.map((e) => ({ target: e.target, actual: e.actual, required: e.required })),
  };
}
