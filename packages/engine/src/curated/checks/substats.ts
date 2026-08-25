import type { BuildVariant } from '@buer/meta';
import type { Build } from '../../interfaces.js';
import { statusFor, type Finding } from '../findings.js';

/**
 * Fração de rolls nas stats prioritárias a partir da qual a build é
 * considerada bem investida. Não é 1.0 porque nenhuma peça real tem 100% dos
 * rolls úteis: cada artefato nasce com substats sorteados.
 */
const SHARE_FOR_FULL_CREDIT = 0.6;

/**
 * Mede QUANTOS ROLLS foram para as stats que a variante quer, contra o total
 * investido. A contagem de rolls é exata em qualquer raridade — vem de
 * `times + 1`, não da tabela de tier — então esta verificação funciona na
 * conta inteira. O que degrada em peça não-5★ é a QUALIDADE do tier, e isso
 * sai como ressalva visível em vez de virar número silenciosamente errado
 * (spec §6.2, §14.6).
 */
export function checkSubstats(build: Build, variant: BuildVariant): Finding {
  const priority = new Set<string>(variant.substats);
  let useful = 0;
  let total = 0;
  let hasNonFiveStar = false;

  for (const piece of Object.values(build.artifacts)) {
    if (!piece) continue;
    if (piece.rarity !== 5) hasNonFiveStar = true;
    for (const sub of piece.substats) {
      const rolls = sub.tiers.length;
      total += rolls;
      if (priority.has(sub.key)) useful += rolls;
    }
  }

  const caveat = hasNonFiveStar
    ? 'Há peça de raridade abaixo de 5★: a contagem de rolls é exata, mas a qualidade de cada roll é estimada (não existe tabela de tier verificada para 3★/4★).'
    : undefined;

  // Ficha sem prioridade de substats: não há regra para violar. Precisa vir
  // ANTES do caminho `total === 0` — aquele é "a ficha pede e a build não
  // entregou", isto é "a ficha não pede nada" — vereditos diferentes.
  if (priority.size === 0) {
    return {
      check: 'substats',
      status: 'on-target',
      credit: 1,
      summary: 'A ficha não fixa prioridade de substats.',
      ...(caveat === undefined ? {} : { caveat }),
    };
  }

  if (total === 0) {
    return {
      check: 'substats',
      status: 'off-target',
      credit: 0,
      summary: 'Nenhum substat para avaliar.',
      ...(caveat === undefined ? {} : { caveat }),
    };
  }

  const share = useful / total;
  const credit = Math.min(1, share / SHARE_FOR_FULL_CREDIT);
  const pct = (share * 100).toFixed(0);

  return {
    check: 'substats',
    status: statusFor(credit),
    credit,
    summary: `${useful} de ${total} rolls (${pct}%) nas stats prioritárias: ${variant.substats.join(', ')}.`,
    ...(caveat === undefined ? {} : { caveat }),
  };
}
