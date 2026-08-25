import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { CharacterKey, StatKey } from '@buer/core';
import type {
  ArchetypeSlotData, BuildVariant, CharacterProfile, MetaBank,
  RawBuildVariant, RawCharacterProfile, RawMeta, RawTeamArchetype,
  ScoringWeights, SetOption, TeamArchetypeData, WeaponOption,
} from './types.js';
import { resolveCharacter, resolveSet, resolveWeapon } from './resolve.js';
import { validateMeta } from './validate.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, '..', 'data');

function readJsonDir<T>(dir: string): T[] {
  const full = path.join(DATA, dir);
  return readdirSync(full)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(path.join(full, f), 'utf8')) as T);
}

/** Lê os arquivos autorados sem validar nem resolver. Existe para o teste. */
export function readRawMeta(): RawMeta {
  return {
    profiles: readJsonDir<RawCharacterProfile>('characters'),
    archetypes: readJsonDir<RawTeamArchetype>('archetypes'),
  };
}

function resolveVariant(raw: RawBuildVariant): BuildVariant {
  const sets: SetOption[] = raw.sets.map((o) => ({
    kind: o.kind,
    sets: o.sets.map((s) => resolveSet(s)!),
    rank: o.rank,
    ...(o.condition === undefined ? {} : { condition: o.condition }),
  }));
  const weapons: WeaponOption[] = raw.weapons.map((o) => ({
    weapon: resolveWeapon(o.weapon)!,
    rank: o.rank,
    ...(o.minRefinement === undefined ? {} : { minRefinement: o.minRefinement as 1 | 2 | 3 | 4 | 5 }),
  }));
  return {
    id: raw.id,
    label: raw.label,
    roles: raw.roles as BuildVariant['roles'],
    scalesOn: raw.scalesOn as BuildVariant['scalesOn'],
    sets,
    mainStats: {
      sands: raw.mainStats.sands as StatKey[],
      goblet: raw.mainStats.goblet as StatKey[],
      circlet: raw.mainStats.circlet as StatKey[],
    },
    substats: raw.substats as StatKey[],
    weapons,
    targets: raw.targets,
    ...(raw.notes === undefined ? {} : { notes: raw.notes }),
  };
}

function resolveArchetype(raw: RawTeamArchetype): TeamArchetypeData {
  const slots: ArchetypeSlotData[] = raw.slots.map((s) => ({
    role: s.role as ArchetypeSlotData['role'],
    requires:
      s.requires.kind === 'character'
        ? { kind: 'character', anyOf: s.requires.anyOf.map((c) => resolveCharacter(c)!) }
        : { kind: 'element', element: s.requires.element, withRole: s.requires.withRole as ArchetypeSlotData['role'] },
    substitutable: s.substitutable,
    ...(s.variant === undefined ? {} : { variant: s.variant }),
    ...(s.targetOverrides === undefined ? {} : { targetOverrides: s.targetOverrides }),
    ...(s.minConstellation === undefined ? {} : { minConstellation: s.minConstellation }),
    ...(s.minRefinement === undefined ? {} : { minRefinement: s.minRefinement }),
  }));
  return {
    schemaVersion: 1,
    id: raw.id,
    label: raw.label,
    gameVersionAdded: raw.gameVersionAdded as TeamArchetypeData['gameVersionAdded'],
    strength: raw.strength as TeamArchetypeData['strength'],
    tags: raw.tags,
    slots,
    sources: raw.sources,
    ...(raw.gameVersionRetired === undefined
      ? {}
      : { gameVersionRetired: raw.gameVersionRetired as TeamArchetypeData['gameVersionAdded'] }),
  };
}

let cached: MetaBank | null = null;

/**
 * Carrega, valida e resolve o banco curado. LANÇA se o dado estiver
 * inválido — ficha quebrada derruba o build, nunca vira veredito errado em
 * produção (spec §5.5). O resultado é memoizado: o banco é imutável e
 * relê-lo por personagem seria I/O à toa.
 */
export function loadMeta(): MetaBank {
  if (cached) return cached;

  const raw = readRawMeta();
  const problems = validateMeta(raw);
  if (problems.length > 0) {
    throw new Error(`@buer/meta: banco curado inválido:\n  - ${problems.join('\n  - ')}`);
  }

  const profiles = new Map<CharacterKey, CharacterProfile>();
  for (const rawProfile of raw.profiles) {
    const key = resolveCharacter(rawProfile.character)!;
    profiles.set(key, {
      schemaVersion: 1,
      character: key,
      variants: rawProfile.variants.map(resolveVariant),
      provenance: rawProfile.provenance as CharacterProfile['provenance'],
    });
  }

  const scoring = JSON.parse(readFileSync(path.join(DATA, 'scoring.json'), 'utf8')) as ScoringWeights;
  const datasetSha = createHash('sha256')
    .update(JSON.stringify({ raw, scoring }))
    .digest('hex')
    .slice(0, 16);

  cached = { profiles, archetypes: raw.archetypes.map(resolveArchetype), scoring, datasetSha };
  return cached;
}
