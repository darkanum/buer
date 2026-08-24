// Task 2.1 — Interfaces do motor (esqueleto da spec §6).
//
// Transcrito verbatim dos blocos TypeScript da spec:
//   docs/superpowers/specs/2026-08-24-onewash-design.md, seção 6 (§6.1–§6.7).
//
// Zero regra de meta aqui — apenas tipos e assinaturas. A propriedade preservada:
// curated → analytic → simulation entram em sequência sem tocar UI, banco ou busca.
// Objetivo e Restrições são dados serializáveis, nunca nós de um motor.
//
// `Element`, `CharacterKey`, `WeaponKey`, `ArtifactSetKey` e `StatKey` já existem em
// @onewash/core (Marco 1) — importados daqui, não redefinidos, para evitar duplicidade
// entre o branded-type de core e uma cópia local.
import type { ArtifactSetKey, CharacterKey, Element, StatKey, WeaponKey } from '@onewash/core';

// ---------------------------------------------------------------------------
// §6.1 Núcleo
// ---------------------------------------------------------------------------

export type SchemaVersion = 1;
export type GameVersion = `${number}.${number}`;

// unions ABERTAS: o domínio muda a cada patch
export type ReactionKey = string;
export type RoleTag = string;

export type ArtifactSlot = 'flower' | 'plume' | 'sands' | 'goblet' | 'circlet';

export interface Substat {
  readonly key: StatKey;
  readonly tiers: readonly (1 | 2 | 3 | 4)[]; // reconstruído de (valor, times) — bijeção
  readonly value: number; // soma canônica dos tiers
  readonly source: 'exact' | 'reconstructed'; // enka appendPropId vs hoyolab (valor,times)
}

export interface ArtifactPiece {
  readonly fingerprint: string; // não há GUID de instância
  readonly setKey: ArtifactSetKey;
  readonly slot: ArtifactSlot;
  readonly rarity: 3 | 4 | 5; // GOOD aceita 3-5; 1/2 rejeitados na borda
  readonly level: number; // 0..20
  readonly mainStatKey: StatKey;
  readonly substats: readonly Substat[];
  readonly locked: boolean;
  readonly equippedBy: CharacterKey | null; // exclusividade global: uma peça, um portador
}

export interface WeaponInstance {
  readonly key: WeaponKey;
  readonly level: number;
  readonly ascension: number; // 0..6; BasePromote 5 OU 7 → clampar
  readonly refinement: 1 | 2 | 3 | 4 | 5;
  readonly equippedBy: CharacterKey | null;
}

export interface CharacterInstance {
  readonly key: CharacterKey; // composto quando Traveler
  readonly element?: Element; // obrigatório para Traveler
  readonly level: number;
  readonly ascension: number; // par (level, ascension) SEMPRE junto
  readonly constellation: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  readonly talents: { readonly auto: number; readonly skill: number; readonly burst: number };
}

export interface Roster {
  readonly schemaVersion: SchemaVersion;
  readonly characters: ReadonlyMap<CharacterKey, CharacterInstance>;
  readonly artifacts: readonly ArtifactPiece[];
  readonly weapons: readonly WeaponInstance[];
  readonly provenance: {
    readonly source: 'hoyolab' | 'good-import' | 'enka' | 'manual' | 'merged';
    readonly completeness: 'full' | 'showcase-only' | 'partial';
    readonly capturedAt: string;
    readonly lang: string;
  };
}

// ---------------------------------------------------------------------------
// §6.2 Build, time, inimigo
// ---------------------------------------------------------------------------

export interface Build {
  readonly schemaVersion: SchemaVersion;
  readonly character: CharacterInstance;
  readonly weapon: WeaponInstance;
  readonly artifacts: Readonly<Record<ArtifactSlot, ArtifactPiece | null>>;
  readonly conditionals: ConditionalState;
}

// Endereçável por string e serializável. NUNCA inferir automaticamente.
export type ConditionalState = Readonly<Record<string, Readonly<Record<string, string>>>>;

export interface ConditionalMigration {
  readonly from: SchemaVersion;
  readonly to: SchemaVersion;
  migrate(s: ConditionalState): ConditionalState;
}

export interface TeamComposition {
  readonly schemaVersion: SchemaVersion;
  readonly slots: readonly [TeamSlot, TeamSlot?, TeamSlot?, TeamSlot?];
  readonly enemy: EnemyProfile; // propriedade do TIME
  readonly teamConditionals: ConditionalState; // ressonância e reação vivem aqui
}

export interface TeamSlot {
  readonly build: Build;
  readonly role: readonly RoleTag[];
  readonly onFieldShare?: number; // 0..1; julgamento humano, não inferência
}

export interface EnemyProfile {
  readonly level: number;
  readonly res: Readonly<Partial<Record<Element | 'physical', number>>>;
  readonly resShred: Readonly<Partial<Record<Element | 'physical', number>>>;
  readonly defReduction: number; // cap efetivo 0.9
  readonly defIgnore: number; // cap 1.0
  readonly count: number; // single vs AoE muda o ranking
  readonly source: 'preset' | 'catalog' | 'manual';
}

// ---------------------------------------------------------------------------
// §6.3 Objetivo e restrições (dados serializáveis)
// ---------------------------------------------------------------------------

export interface AbilityRef {
  readonly kind: 'normal' | 'charged' | 'plunging' | 'skill' | 'burst' | 'named';
  readonly index?: number; // auto[] é lista-de-listas por componente
  readonly variant?: string;
  readonly path?: readonly string[]; // escape hatch
  readonly scalesOn: 'atk' | 'def' | 'hp' | 'eleMas';
  readonly ignoreDefPercent?: number;
  readonly elevation?: number;
}

export type HitMode =
  | { readonly kind: 'hit' }
  | { readonly kind: 'critHit' }
  | { readonly kind: 'avgHit' }
  | { readonly kind: 'guaranteedCrit'; readonly reason: 'weakPoint' | 'effect' }
  | { readonly kind: 'override'; readonly critRate?: number; readonly critDMG?: number };

export interface ReactionPremise {
  readonly reaction: ReactionKey;
  readonly uptime: number; // 0..1
  readonly icdGroupNote?: string;
  readonly auraTax?: number;
  readonly declaredBy: 'user' | 'archetype' | 'evaluator-default';
}

export type ObjectiveTerm =
  | {
      readonly kind: 'damage';
      readonly of: CharacterKey;
      readonly ability: AbilityRef;
      readonly hitMode: HitMode;
      readonly reaction?: ReactionPremise;
      readonly infusion?: Element;
      readonly snapshot?: { readonly at: 'cast' | 'hit'; readonly buffsFrom?: 'team' | 'self' };
      readonly weight: number;
    }
  | {
      readonly kind: 'reactionOverTime';
      readonly of: CharacterKey;
      readonly reaction: ReactionKey;
      readonly expectedTriggers: number;
      readonly windowSeconds: number;
      readonly weight: number;
    }
  | { readonly kind: 'stat'; readonly of: CharacterKey; readonly stat: StatKey; readonly weight: number }
  | { readonly kind: 'healing' | 'shield'; readonly of: CharacterKey; readonly weight: number };

export interface Objective {
  readonly schemaVersion: SchemaVersion;
  readonly id: string;
  readonly label: string;
  readonly terms: readonly ObjectiveTerm[]; // multi-alvo ponderado desde o dia 1
  readonly aggregate: 'sum' | 'min' | 'rotationDPS';
  readonly rotation?: RotationRef;
}

export interface RotationRef {
  readonly id: string;
  readonly gameVersion: GameVersion;
  readonly providerId: string;
  readonly authoredBy: string;
  readonly durationSeconds: number;
}

export type Constraint =
  | {
      readonly kind: 'stat';
      readonly of: CharacterKey;
      readonly stat: StatKey;
      readonly min?: number;
      readonly max?: number;
      readonly hard: boolean;
    }
  | {
      readonly kind: 'energyFeasible';
      readonly of: CharacterKey;
      readonly threshold: ErThreshold;
      readonly hard: boolean;
    }
  | { readonly kind: 'artifactSet'; readonly setKey: ArtifactSetKey; readonly forbid: readonly (2 | 4)[] }
  | { readonly kind: 'mainStat'; readonly slot: ArtifactSlot; readonly allow: readonly StatKey[] };

export interface ErContext {
  readonly team: TeamComposition;
  readonly of: CharacterKey;
  readonly rotation: RotationRef;
  readonly teamSize: 1 | 2 | 3 | 4;
  readonly offFieldMultiplier: number;
  readonly flatEnergySources: readonly string[];
}
export type ErThreshold =
  | { readonly kind: 'literal'; readonly value: number; readonly source: string }
  | { readonly kind: 'provided'; readonly providerId: string; readonly percentile?: number };
export interface ErThresholdProvider {
  readonly id: string;
  resolve(ctx: ErContext): Promise<{ readonly value: number; readonly provenance: Provenance }>;
}

// ---------------------------------------------------------------------------
// §6.4 `BuildEvaluator` — o seam
// ---------------------------------------------------------------------------

export type EvaluatorKind = 'curated' | 'analytic' | 'simulation';

export interface EvaluatorCapabilities {
  readonly kind: EvaluatorKind;
  readonly output: 'ordinal' | 'relative' | 'absolute';
  readonly supportsTermKinds: readonly ObjectiveTerm['kind'][];
  readonly supportsAggregates: readonly Objective['aggregate'][];
  readonly supportsConstraintKinds: readonly Constraint['kind'][];
  readonly supportsHitModes: readonly HitMode['kind'][];
  readonly modelsSnapshot: boolean;
  readonly modelsAuraAndIcd: boolean;
  readonly providesBounds: boolean; // habilita branch-and-bound
  readonly deterministic: boolean;
  readonly estimatedCostPerBuildMs: number;
  readonly maxBatchSize: number;
  readonly runtime: 'node' | 'wasm' | 'worker' | 'remote';
}

export interface EvaluationContext {
  readonly gameVersion: GameVersion;
  readonly team: TeamComposition;
  readonly subject: CharacterKey;
  readonly objective: Objective;
  readonly constraints: readonly Constraint[];
  readonly signal?: AbortSignal;
}

export type CapabilityVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reasons: readonly string[]; readonly degradedTo?: Objective };

export interface BuildEvaluator {
  readonly id: string;
  readonly capabilities: EvaluatorCapabilities;
  canHandle(ctx: EvaluationContext): CapabilityVerdict; // negociação ANTES de rodar
  prepare(ctx: EvaluationContext): Promise<PreparedEvaluator>;
}

export interface PreparedEvaluator extends AsyncDisposable {
  evaluate(builds: readonly Build[]): Promise<readonly Score[]>; // LOTE, nunca unitário
  estimateBounds?(partial: PartialBuild): Promise<Interval>;
  explain?(build: Build): Promise<Explanation>;
}

export interface Score {
  readonly value: number;
  readonly unit: 'damage' | 'dps' | 'stat' | 'score';
  readonly distribution?: {
    readonly mean: number;
    readonly sd: number;
    readonly p5: number;
    readonly p50: number;
    readonly p95: number;
  };
  readonly violations: readonly ConstraintViolation[];
  readonly breakdown?: Readonly<Record<string, number>>;
  readonly provenance: Provenance;
}

// Contrato de produto: isto é COMPARAÇÃO, não PREVISÃO.
export interface Provenance {
  readonly evaluatorId: string;
  readonly kind: EvaluatorKind;
  readonly gameVersion: GameVersion;
  readonly datasetSha: string;
  readonly confidence: 'high' | 'medium' | 'low';
  readonly assumptions: readonly string[];
  readonly rosterCompleteness: Roster['provenance']['completeness'];
  readonly cacheKey: string;
}

export interface ConstraintViolation {
  readonly constraint: Constraint;
  readonly actual: number;
  readonly required: number;
  readonly hard: boolean;
}
export interface Interval {
  readonly min: number;
  readonly max: number;
}
export type PartialBuild = Omit<Build, 'artifacts'> & {
  readonly artifacts: Readonly<Partial<Record<ArtifactSlot, ArtifactPiece | null>>>;
};
export interface Explanation {
  readonly summary: string;
  readonly reasons: readonly { readonly claim: string; readonly evidence?: string }[];
  readonly citations?: readonly string[];
}

// ---------------------------------------------------------------------------
// §6.5 Busca (separada da avaliação; time é matching)
// ---------------------------------------------------------------------------

export interface SearchPolicy {
  readonly respectLocks: boolean;
  readonly allowStealingFrom: readonly CharacterKey[]; // default [] — não roubar
  readonly assumeArtifactLevel?: number; // comparar +0 com +20 é injusto
  readonly maxCombinations: number;
  readonly timeBudgetMs: number;
}

export interface SearchProblem {
  readonly context: EvaluationContext;
  readonly candidates: Readonly<Record<ArtifactSlot, readonly ArtifactPiece[]>>;
  readonly weapons: readonly WeaponInstance[];
  readonly topN: number;
  readonly reservations: ReadonlyMap<string, CharacterKey>; // fingerprint -> portador
  readonly policy: SearchPolicy;
}

export interface BuildSearcher {
  readonly id: string;
  search(
    p: SearchProblem,
    e: BuildEvaluator,
    onProgress?: (x: SearchProgress) => void,
  ): Promise<SearchResult>;
}

// Otimizar 4 personagens NÃO são 4 problemas independentes: é MATCHING.
export interface TeamSearchProblem {
  readonly context: Omit<EvaluationContext, 'subject' | 'objective'>;
  readonly objectives: ReadonlyMap<CharacterKey, Objective>;
  readonly inventory: Roster;
  readonly policy: SearchPolicy;
}
export interface TeamSearcher {
  readonly id: string;
  readonly strategy: 'greedy-by-slot' | 'relaxed-then-swap' | 'assignment';
  readonly orderDependent: boolean;
  search(
    p: TeamSearchProblem,
    e: BuildEvaluator,
    onProgress?: (x: SearchProgress) => void,
  ): Promise<TeamSearchResult>;
}

export interface SearchProgress {
  readonly tested: number;
  readonly failed: number;
  readonly skipped: number;
  readonly total: number | null;
  readonly perSecond: number;
}
export interface SearchResult {
  readonly builds: readonly { readonly build: Build; readonly score: Score }[];
  readonly truncated: boolean;
  readonly notes: readonly string[]; // "orçamento esgotado", "poda desabilitada"
}
export interface TeamSearchResult {
  readonly assignment: ReadonlyMap<CharacterKey, Build>;
  readonly scores: ReadonlyMap<CharacterKey, Score>;
  readonly conflicts: readonly {
    readonly fingerprint: string;
    readonly contestedBy: readonly CharacterKey[];
  }[];
  readonly truncated: boolean;
  readonly notes: readonly string[];
}

// ---------------------------------------------------------------------------
// §6.6 Time e aquisição
// ---------------------------------------------------------------------------

export interface TeamEvaluator {
  readonly id: string;
  readonly capabilities: EvaluatorCapabilities;
  evaluate(team: TeamComposition, ctx: TeamEvalContext): Promise<TeamAssessment>;
}

export interface TeamAssessment {
  // Curado PRIMEIRO. Scoring computado só como desempate.
  readonly archetype: { readonly id: string; readonly label: string; readonly matchConfidence: number } | null;
  readonly reactions: readonly ReactionAvailability[];
  readonly resonance: readonly ResonanceEffect[];
  readonly roleCoverage: Readonly<Record<RoleTag, 'missing' | 'weak' | 'covered'>>;
  readonly energyFeasibility: readonly {
    readonly of: CharacterKey;
    readonly required: number;
    readonly actual: number;
  }[];
  readonly score: Score;
  readonly explanation: Explanation;
}

export interface ReactionAvailability {
  readonly reaction: ReactionKey;
  readonly requires: { readonly elements: readonly Element[]; readonly enabledByAnyOf?: readonly CharacterKey[] };
  readonly satisfied: boolean;
  readonly missing: readonly (Element | CharacterKey)[];
}

export interface ResonanceEffect {
  readonly id: string;
  readonly stats?: Readonly<Partial<Record<StatKey, number>>>;
  readonly auraDurationMultiplier?: { readonly element: Element; readonly factor: number };
  readonly particleGeneration?: {
    readonly element: Element;
    readonly cooldownSeconds: number;
    readonly onReactions: readonly ReactionKey[];
  };
  readonly conditional?: string;
}

// Banco curado. Dado autoral, com fonte e patch — auditável e expirável.
export interface TeamArchetype {
  readonly schemaVersion: SchemaVersion;
  readonly id: string;
  readonly label: string;
  readonly gameVersionAdded: GameVersion;
  readonly gameVersionRetired?: GameVersion;
  readonly slots: readonly ArchetypeSlot[];
  readonly rotation?: RotationRef;
  readonly erThresholds?: ReadonlyMap<CharacterKey, number>;
  readonly sources: readonly string[];
}
export interface ArchetypeSlot {
  readonly role: readonly RoleTag[];
  readonly requires:
    | { readonly kind: 'character'; readonly anyOf: readonly CharacterKey[] }
    | { readonly kind: 'element'; readonly element: Element; readonly withRole: readonly RoleTag[] };
  readonly minConstellation?: number;
  readonly minRefinement?: number;
  readonly substitutable: boolean;
}

// Aquisição = valor marginal contra gap analysis, não tier list.
export type InvestmentAxis =
  | { readonly kind: 'artifact' }
  | { readonly kind: 'constellation'; readonly from: number; readonly to: number }
  | { readonly kind: 'talent'; readonly which: 'auto' | 'skill' | 'burst'; readonly from: number; readonly to: number }
  | { readonly kind: 'refinement'; readonly from: 1 | 2 | 3 | 4 | 5; readonly to: 1 | 2 | 3 | 4 | 5 }
  | { readonly kind: 'newCharacter'; readonly character: CharacterKey }
  | { readonly kind: 'newWeapon'; readonly weapon: WeaponKey };

export interface RosterAdvisor {
  advise(roster: Roster, prefs: AdvisorPreferences): Promise<AcquisitionAdvice>;
}
export interface AcquisitionAdvice {
  readonly candidates: readonly AcquisitionCandidate[];
  readonly coverageGaps: readonly CoverageGap[];
}
export interface AcquisitionCandidate {
  readonly axis: InvestmentAxis;
  readonly unlocks: readonly { readonly archetype: TeamArchetype; readonly wasBlockedBy: readonly string[] }[];
  readonly improves: readonly {
    readonly archetype: TeamArchetype;
    readonly delta: Interval;
    readonly deltaDistribution?: Score['distribution'];
    readonly replaces?: CharacterKey;
  }[];
  readonly redundancyWith: readonly CharacterKey[];
  readonly explanation: Explanation;
  readonly provenance: Provenance;
}
export interface CoverageGap {
  readonly description: string;
  readonly missing: { readonly element?: Element; readonly roles: readonly RoleTag[] };
  readonly blockedArchetypes: readonly string[];
  readonly severity: 'critical' | 'notable' | 'minor';
}

// ---------------------------------------------------------------------------
// §6.7 Acionabilidade, registry e dados
// ---------------------------------------------------------------------------

export interface EquipPlan {
  readonly steps: readonly {
    readonly order: number;
    readonly character: CharacterKey;
    readonly slot: ArtifactSlot | 'weapon';
    readonly equip: string; // fingerprint | weapon instance id
    readonly unequipsFrom?: CharacterKey;
  }[];
  readonly netLosers: readonly { readonly character: CharacterKey; readonly deltaScore: Interval }[];
}

export interface FarmPlan {
  readonly targets: readonly {
    readonly setKey: ArtifactSetKey;
    readonly slot: ArtifactSlot;
    readonly mainStatKey: StatKey;
    readonly expectedDelta: Interval;
    readonly domain?: string;
  }[];
  readonly assumptions: readonly string[]; // probabilidades de drop NÃO estão no game data
}

export interface EvaluatorRegistry {
  register(e: BuildEvaluator): void;
  resolve(
    ctx: EvaluationContext,
    prefer?: EvaluatorKind,
  ): { readonly evaluator: BuildEvaluator; readonly degraded: CapabilityVerdict };
  list(): readonly EvaluatorCapabilities[];
}

export interface GameDataProvider {
  readonly version: GameVersion;
  readonly datasetSha: string; // pinning obrigatório
  characterCurves(k: CharacterKey): Promise<CharacterStatCurves>;
  // TRÊS fórmulas, não uma: hp/atk/def com ascensão; arma specialized SEM ascensão;
  // personagem specialized = promotion + base.critrate/critdmg quando aplicável.
  computeStats(c: CharacterInstance, w: WeaponInstance): Promise<Readonly<Partial<Record<StatKey, number>>>>;
  skillParams(k: CharacterKey): Promise<SkillParamTable>;
  artifactSet(k: ArtifactSetKey): Promise<ArtifactSetData>; // twopcNumeric: boolean
  reactionTable(): Promise<ReactionTable>; // NÃO está no Enka nem no allStat_gen
  enemyProfile(id: string): Promise<EnemyProfile>;
  substatTiers(rarity: 3 | 4 | 5, key: StatKey): Promise<readonly number[]>;
  reconstructSubstat(
    rarity: 3 | 4 | 5,
    key: StatKey,
    displayValue: string,
    times: number,
  ): Promise<readonly (1 | 2 | 3 | 4)[]>;
}

export interface RosterSource {
  readonly id: 'hoyolab' | 'good' | 'enka' | 'manual';
  readonly completeness: Roster['provenance']['completeness'];
  load(input: unknown): Promise<Roster>;
}
export interface RosterMerger {
  merge(sources: readonly Roster[]): Roster;
}
export interface GoodCodec {
  toGOOD(r: Roster): unknown; // {format:'GOOD', source:'onewash', version:3}
  fromGOOD(x: unknown): Roster; // rejeitar rarity 1|2 na borda
}

// ---------------------------------------------------------------------------
// Placeholders — tipos referenciados em §6 mas ainda não expandidos na spec.
// A spec §6 usa estes nomes em assinaturas (TeamEvaluator.evaluate,
// GameDataProvider.*, RosterAdvisor.advise) sem definir sua forma — ela mesma
// nota que a implementação real é "segundo ciclo". Ficam vazios de propósito:
// nenhum campo foi inventado aqui.
// ---------------------------------------------------------------------------

export interface TeamEvalContext {
  readonly _todo?: never;
}
export interface CharacterStatCurves {
  readonly _todo?: never;
}
export interface SkillParamTable {
  readonly _todo?: never;
}
export interface ArtifactSetData {
  readonly _todo?: never;
}
export interface ReactionTable {
  readonly _todo?: never;
}
export interface AdvisorPreferences {
  readonly _todo?: never;
}
