/**
 * Shared domain vocabulary for @onewash/core.
 *
 * Reserved for domain types that don't belong to a single module (e.g.
 * gi-data-derived lookups landing in Marco 6). As of Task 1.6,
 * normalize.ts doesn't import anything from here — PromotedCols and
 * NormalizedSnapshot live in normalize.ts, and StatKey/CharacterDoc/
 * CanonArtifact/CharacterKey already have a canonical home in
 * substat.ts/canon.ts/keys.ts respectively — so this file intentionally
 * has no exports yet rather than inventing or re-exporting types that
 * would collide with those modules' own barrel exports.
 */
export {};
