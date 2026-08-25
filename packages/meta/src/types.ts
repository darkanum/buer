import type {
  ArtifactSetKey, CharacterKey, GameVersion, RoleTag,
  SchemaVersion, StatKey, StatTarget, WeaponKey,
} from '@buer/core';

// ---------------------------------------------------------------------------
// Forma AUTORADA — o que está nos arquivos JSON. Chaves são slugs legíveis.
// Tudo aqui é `string` cru de propósito: é a fronteira não-validada.
// ---------------------------------------------------------------------------

export interface RawSetOption {
  kind: '4pc' | '2+2';
  sets: string[];
  rank: number;
  condition?: string;
}

export interface RawWeaponOption {
  weapon: string;
  rank: number;
  minRefinement?: number;
}

export interface RawBuildVariant {
  id: string;
  label: string;
  roles: string[];
  scalesOn: string;
  sets: RawSetOption[];
  mainStats: { sands: string[]; goblet: string[]; circlet: string[] };
  substats: string[];
  weapons: RawWeaponOption[];
  targets: StatTarget[];
  notes?: string;
}

export interface RawMetaProvenance {
  authoredBy: string;
  sources: string[];
  authoredAt: string;
  validatedForVersion: string;
  confidence: string;
}

export interface RawCharacterProfile {
  schemaVersion: number;
  character: string;
  variants: RawBuildVariant[];
  provenance: RawMetaProvenance;
}

export interface RawArchetypeSlot {
  role: string[];
  requires:
    | { kind: 'character'; anyOf: string[] }
    | { kind: 'element'; element: string; withRole: string[] };
  variant?: string;
  targetOverrides?: StatTarget[];
  minConstellation?: number;
  minRefinement?: number;
  substitutable: boolean;
}

export interface RawTeamArchetype {
  schemaVersion: number;
  id: string;
  label: string;
  gameVersionAdded: string;
  gameVersionRetired?: string;
  strength: string;
  tags: string[];
  slots: RawArchetypeSlot[];
  sources: string[];
}

export interface RawMeta {
  profiles: RawCharacterProfile[];
  archetypes: RawTeamArchetype[];
}

// ---------------------------------------------------------------------------
// Forma RESOLVIDA — o que o motor consome. Chaves já são ids numéricos.
// ---------------------------------------------------------------------------

export type ScalesOn = 'atk' | 'hp' | 'def' | 'eleMas';

export interface SetOption {
  readonly kind: '4pc' | '2+2';
  readonly sets: readonly ArtifactSetKey[];
  readonly rank: number;
  /** Prosa EXIBIDA, jamais avaliada (spec §5.1). */
  readonly condition?: string;
}

export interface WeaponOption {
  readonly weapon: WeaponKey;
  readonly rank: number;
  readonly minRefinement?: 1 | 2 | 3 | 4 | 5;
}

export interface BuildVariant {
  readonly id: string;
  readonly label: string;
  readonly roles: readonly RoleTag[];
  readonly scalesOn: ScalesOn;
  readonly sets: readonly SetOption[];
  readonly mainStats: Readonly<Record<'sands' | 'goblet' | 'circlet', readonly StatKey[]>>;
  readonly substats: readonly StatKey[];
  readonly weapons: readonly WeaponOption[];
  readonly targets: readonly StatTarget[];
  readonly notes?: string;
}

export interface MetaProvenance {
  readonly authoredBy: 'human' | 'researched' | 'researched-reviewed';
  readonly sources: readonly string[];
  readonly authoredAt: string;
  readonly validatedForVersion: GameVersion;
  readonly confidence: 'high' | 'medium' | 'low';
}

export interface CharacterProfile {
  readonly schemaVersion: SchemaVersion;
  readonly character: CharacterKey;
  readonly variants: readonly BuildVariant[];
  readonly provenance: MetaProvenance;
}

export interface ArchetypeSlotData {
  readonly role: readonly RoleTag[];
  readonly requires:
    | { readonly kind: 'character'; readonly anyOf: readonly CharacterKey[] }
    | { readonly kind: 'element'; readonly element: string; readonly withRole: readonly RoleTag[] };
  readonly variant?: string;
  readonly targetOverrides?: readonly StatTarget[];
  readonly minConstellation?: number;
  readonly minRefinement?: number;
  readonly substitutable: boolean;
}

export interface TeamArchetypeData {
  readonly schemaVersion: SchemaVersion;
  readonly id: string;
  readonly label: string;
  readonly gameVersionAdded: GameVersion;
  readonly gameVersionRetired?: GameVersion;
  readonly strength: 'meta' | 'strong' | 'niche';
  readonly tags: readonly string[];
  readonly slots: readonly ArchetypeSlotData[];
  readonly sources: readonly string[];
}

/**
 * Pesos das cinco verificações. Vivem em dado versionado, não em código —
 * calibrar é um diff revisável (spec §6.3). Entram em Provenance.assumptions.
 */
export interface ScoringWeights {
  readonly version: number;
  readonly set: number;
  readonly mainStats: number;
  readonly targets: number;
  readonly weapon: number;
  readonly substats: number;
}

export interface MetaBank {
  readonly profiles: ReadonlyMap<CharacterKey, CharacterProfile>;
  readonly archetypes: readonly TeamArchetypeData[];
  readonly scoring: ScoringWeights;
  /** Hash do dado curado carregado — vai para Provenance.datasetSha. */
  readonly datasetSha: string;
}
