export type { Element, CharacterKey, WeaponKey, ArtifactSetKey } from './keys.js';
export { charKey, parseCharKey } from './keys.js';

export type { CanonArtifact, CharacterDoc } from './canon.js';
export { canonBytes, contentHash, artifactFingerprint, accountHash } from './canon.js';

// substat.js re-exports `Element` from keys.js too; skip it here to avoid
// an ambiguous-export clash (TS2308) and take it from keys.js above instead.
export type { StatKey } from './substat.js';
export { reconstructTiers } from './substat.js';

export * from './protocol.js';

export type { PromotedCols, NormalizedSnapshot } from './normalize.js';
export { normalize } from './normalize.js';

export { scrubRaw } from './scrub.js';

export { extractObservedStats } from './observed.js';

// `propKey` já era usado internamente por normalize.ts e canon.ts, mas nunca
// tinha sido exposto na fronteira do pacote — @buer/engine precisa dele para
// traduzir `property_type` (main/sub stat de artefato) direto do payload cru
// do HoYoLAB, sem duplicar a tabela FightProp que já vive em @buer/gi-data.
export { propKey } from './properties.js';

export * from './domain.js';
