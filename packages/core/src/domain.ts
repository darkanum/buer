/**
 * Vocabulário de domínio compartilhado.
 *
 * Estes tipos são consumidos por @buer/meta (dado curado autorado) E por
 * @buer/engine (o motor que o consome). Como a dependência corre
 * engine → meta → core, `core` é o único lugar que os dois alcançam sem
 * ciclo. `@buer/engine` re-exporta tudo daqui, então nenhum consumidor
 * existente precisa mudar de import.
 */
import type { StatKey } from './substat.js';

export type SchemaVersion = 1;
export type GameVersion = `${number}.${number}`;

export type ArtifactSlot = 'flower' | 'plume' | 'sands' | 'goblet' | 'circlet';

/**
 * Vocabulário FECHADO de papéis (spec §5.3). É fechado porque
 * `TeamAssessment.roleCoverage` mapeia sobre ele e porque um slot flex de
 * arquétipo casa por papel — um papel escrito errado numa ficha viraria um
 * slot que nunca casa, em silêncio. O teste de integridade de @buer/meta
 * rejeita qualquer valor fora desta lista.
 */
export const ROLE_TAGS = [
  'main-dps',
  'sub-dps',
  'buffer',
  'debuffer',
  'healer',
  'shielder',
  'battery',
  'driver',
  'enabler',
] as const;

export type RoleTag = (typeof ROLE_TAGS)[number];

export function isRoleTag(v: string): v is RoleTag {
  return (ROLE_TAGS as readonly string[]).includes(v);
}

/**
 * Stats finais de uma build, como o jogo os reporta. "Observed" e não
 * "computed" de propósito: só existem para a build que foi CAPTURADA. Uma
 * build hipotética não tem como preenchê-los — é o que força o
 * ComputedStatResolver da Fase 3 a existir em vez de ser contornado.
 */
export type ObservedStats = Readonly<Partial<Record<StatKey, number>>>;

/**
 * Um alvo verificável de uma variante de build. É a única parte da ficha
 * curada que produz número; o resto é comparação de igualdade ou de posição
 * em lista ordenada.
 *
 * `why` é obrigatório: a explicação nunca diz "ER baixo", diz por que 180.
 */
export type StatTarget =
  | {
      readonly kind: 'min';
      readonly stat: StatKey;
      readonly value: number;
      readonly hard: boolean;
      readonly why: string;
    }
  | {
      readonly kind: 'range';
      readonly stat: StatKey;
      readonly min: number;
      readonly max: number;
      readonly why: string;
    }
  | {
      readonly kind: 'ratio';
      readonly numerator: StatKey;
      readonly denominator: StatKey;
      readonly min: number;
      readonly max: number;
      readonly why: string;
    };
