// DS1 (Dynamic Secret, variante 1) do HoYoLAB.
//
// `now`/`rand` são injetados pelo chamador (nunca lidos de Date.now()/Math.random()
// aqui dentro) para que a função seja pura e o teste de vetor conhecido seja
// determinístico. Nunca usar DS2 nem salts chineses — ver docs/superpowers/specs/
// 2026-08-24-onewash-design.md §3.3.
import { createHash } from 'node:crypto';

export const DS_SALT = '6s25p5ox5y14umn1p61aqyyvbvvl3lrt';
export const APP_VERSION = '1.5.0';
export const CLIENT_TYPE = '5';

/** `"{now},{rand},{md5}"` com `md5 = md5("salt={DS_SALT}&t={now}&r={rand}")`. */
export function ds1(now: number, rand: string): string {
  const md5 = createHash('md5').update(`salt=${DS_SALT}&t=${now}&r=${rand}`).digest('hex');
  return `${now},${rand},${md5}`;
}
