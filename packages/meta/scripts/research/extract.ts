// packages/meta/scripts/research/extract.ts
//
// A segunda chamada de API: prosa da pesquisa -> SourceClaim[] tipado.
//
// A normalização de nome-humano para slug é PURA e roda contra o catálogo do
// gi-data: o modelo devolve "Emblem of Severed Fate", e é o código que decide
// se isso resolve. Nome que não resolve é DESCARTADO e reportado — nunca
// aproximado, porque um slug errado vira ficha que aponta para nada.

import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { loadArtifactSets, loadProperty, loadWeapons } from '@buer/gi-data';
import { ROLE_TAGS } from '@buer/core';
import { MODEL } from './client.js';
import { SOURCE_IDS, type CharacterClaims, type SourceClaim, type SourceId } from './claims.js';

const MainStatsSchema = z.object({
  sands: z.array(z.string()).optional(),
  goblet: z.array(z.string()).optional(),
  circlet: z.array(z.string()).optional(),
});

const RawClaimSchema = z.object({
  source: z.enum(SOURCE_IDS),
  url: z.string(),
  sets: z.array(z.string()).optional(),
  mainStats: MainStatsSchema.optional(),
  substats: z.array(z.string()).optional(),
  weapons: z.array(z.string()).optional(),
  erThreshold: z.number().optional(),
  erWhy: z.string().optional(),
  roles: z.array(z.string()).optional(),
  scalesOn: z.string().optional(),
});

const ClaimsSchema = z.object({ claims: z.array(RawClaimSchema) });

export type RawClaim = z.infer<typeof RawClaimSchema>;

export interface Catalogs {
  readonly sets: ReadonlyMap<string, string>;
  readonly weapons: ReadonlyMap<string, string>;
  readonly stats: ReadonlyMap<string, string>;
  readonly roles: ReadonlySet<string>;
}

/** "Emblem of Severed Fate" e "emblem-of-severed-fate" batem na mesma chave. */
function fold(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Índices de lookup. Cada slug entra por si mesmo e por sua forma dobrada, o
 * que faz `The Catch`, `the catch` e `the-catch` resolverem para a mesma coisa.
 */
export function buildCatalogs(): Catalogs {
  const sets = new Map<string, string>();
  for (const entry of Object.values(loadArtifactSets())) sets.set(fold(entry.slug), entry.slug);

  const weapons = new Map<string, string>();
  for (const entry of Object.values(loadWeapons())) weapons.set(fold(entry.slug), entry.slug);

  // StatKey aceita tanto o próprio goodKey ('enerRech_') quanto o nome humano
  // que as fontes usam ('Energy Recharge', 'Pyro DMG Bonus', 'CRIT Rate').
  const stats = new Map<string, string>();
  for (const entry of Object.values(loadProperty())) {
    if (!entry.goodKey) continue;
    stats.set(fold(entry.goodKey), entry.goodKey);
  }
  const HUMAN: Readonly<Record<string, string>> = {
    'energy-recharge': 'enerRech_', 'er': 'enerRech_',
    'crit-rate': 'critRate_', 'critical-rate': 'critRate_',
    'crit-dmg': 'critDMG_', 'crit-damage': 'critDMG_', 'critical-damage': 'critDMG_',
    'elemental-mastery': 'eleMas', 'em': 'eleMas',
    'atk': 'atk_', 'atk-percent': 'atk_', 'attack': 'atk_',
    'hp': 'hp_', 'hp-percent': 'hp_',
    'def': 'def_', 'def-percent': 'def_', 'defense': 'def_',
    'healing-bonus': 'heal_',
    'physical-dmg-bonus': 'physical_dmg_',
    'pyro-dmg-bonus': 'pyro_dmg_', 'hydro-dmg-bonus': 'hydro_dmg_', 'cryo-dmg-bonus': 'cryo_dmg_',
    'electro-dmg-bonus': 'electro_dmg_', 'anemo-dmg-bonus': 'anemo_dmg_',
    'geo-dmg-bonus': 'geo_dmg_', 'dendro-dmg-bonus': 'dendro_dmg_',
  };
  for (const [k, v] of Object.entries(HUMAN)) stats.set(k, v);

  return { sets, weapons, stats, roles: new Set<string>(ROLE_TAGS) };
}

function resolveList(
  names: readonly string[] | undefined,
  index: ReadonlyMap<string, string> | ReadonlySet<string>,
  unresolved: string[],
): string[] | undefined {
  if (names === undefined) return undefined;
  const out: string[] = [];
  for (const name of names) {
    const key = fold(name);
    const hit = index instanceof Map ? index.get(key) : index.has(key) ? key : undefined;
    if (hit === undefined) unresolved.push(name);
    else out.push(hit);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Nome humano -> slug do catálogo. Pura.
 *
 * `undefined` entra e `undefined` sai: normalizar nunca transforma "a fonte não
 * cobre" em "a fonte diz vazio".
 */
export function normalizeClaim(
  raw: RawClaim,
  catalogs: Catalogs,
): { claim: SourceClaim; unresolved: readonly string[] } {
  const unresolved: string[] = [];

  const mainStats = raw.mainStats
    ? {
        sands: resolveList(raw.mainStats.sands, catalogs.stats, unresolved),
        goblet: resolveList(raw.mainStats.goblet, catalogs.stats, unresolved),
        circlet: resolveList(raw.mainStats.circlet, catalogs.stats, unresolved),
      }
    : undefined;

  const hasMainStat =
    mainStats !== undefined &&
    (mainStats.sands !== undefined || mainStats.goblet !== undefined || mainStats.circlet !== undefined);

  // Uma chamada por campo, guardada numa variável. Chamar `resolveList` duas
  // vezes para o mesmo campo duplicaria os itens em `unresolved` — e passar um
  // array descartável na segunda chamada perderia o relato.
  const sets = resolveList(raw.sets, catalogs.sets, unresolved);
  const substats = resolveList(raw.substats, catalogs.stats, unresolved);
  const weapons = resolveList(raw.weapons, catalogs.weapons, unresolved);
  const roles = resolveList(raw.roles, catalogs.roles, unresolved);

  const claim: SourceClaim = {
    source: raw.source,
    url: raw.url,
    ...(sets === undefined ? {} : { sets }),
    ...(hasMainStat ? { mainStats } : {}),
    ...(substats === undefined ? {} : { substats }),
    ...(weapons === undefined ? {} : { weapons }),
    ...(raw.erThreshold === undefined ? {} : { erThreshold: raw.erThreshold }),
    ...(raw.erWhy === undefined ? {} : { erWhy: raw.erWhy }),
    ...(roles === undefined ? {} : { roles }),
    ...(raw.scalesOn === undefined ? {} : { scalesOn: raw.scalesOn }),
  } as SourceClaim;

  return { claim, unresolved };
}

export interface ExtractClient {
  parse(params: unknown): Promise<{ parsed_output: unknown }>;
}

export interface ExtractDeps {
  readonly client: ExtractClient;
  readonly model?: string;
  /**
   * Chamado uma vez por claim que teve nomes descartados por não resolverem
   * no catálogo. Sem callback, o descarte acontece do mesmo jeito — só não é
   * relatado a ninguém, e o lote perde rastro do que a pesquisa mencionou mas
   * a ficha não pôde usar.
   */
  readonly onUnresolved?: (source: SourceId, names: readonly string[]) => void;
}

export async function extractClaims(
  slug: string,
  researchText: string,
  deps: ExtractDeps,
): Promise<CharacterClaims> {
  const response = await deps.client.parse({
    model: deps.model ?? MODEL,
    max_tokens: 16000,
    output_config: { format: zodOutputFormat(ClaimsSchema), effort: 'high' },
    messages: [
      {
        role: 'user',
        content: [
          `Estruture o relatório de pesquisa abaixo sobre o personagem "${slug}".`,
          '',
          'Um item por fonte. Se a pesquisa não trouxe um campo para uma fonte, **omita esse campo**',
          'para ela — não copie de outra fonte e não preencha com o valor usual.',
          '',
          '--- RELATÓRIO ---',
          researchText,
        ].join('\n'),
      },
    ],
  });

  const parsed = ClaimsSchema.safeParse(response.parsed_output);
  if (!parsed.success) {
    throw new Error(`não foi possível estruturar a pesquisa de "${slug}": saída fora do schema`);
  }

  const catalogs = buildCatalogs();
  return {
    character: slug,
    claims: parsed.data.claims.map((raw) => {
      const { claim, unresolved } = normalizeClaim(raw, catalogs);
      if (unresolved.length > 0) deps.onUnresolved?.(raw.source, unresolved);
      return claim;
    }),
  };
}
