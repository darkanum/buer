import { createHash } from 'node:crypto';
import { decimalsForId } from './properties.js';

export interface CanonArtifact {
  slot: 1|2|3|4|5; set: number; lvl: number; rarity: 3|4|5;
  main: [number, number]; subs: [number, number, 1|2|3|4][]; fp: string;
}
export interface CharacterDoc {
  v: 1; char: string; lvl: number; asc: number; cons: number; friend: number;
  weapon: { id: number; lvl: number; promote: number; refine: number };
  talents: [number, number][]; artifacts: CanonArtifact[];
}

// --- Canonical (deterministic, content-hashable) serialization ------------
//
// CharacterDoc's fields are either always-integer game counters (level,
// ascension, constellation, friendship, weapon id/level/promote/refine,
// talent id/level, artifact slot/set/level/rarity) or an artifact main/sub
// stat VALUE, whose correct display precision depends on which property it
// is — flat stats (HP/ATK/DEF/EM) are integers, percentages carry 1 decimal
// (see properties.ts's `decimalsForId`, itself backed by @buer/gi-data's
// FightProp table). A single blanket `toFixed(1)` for every number gets the
// second kind wrong for flat stats (e.g. flat HP "269" round-trips as
// "269.0", which no longer matches HoYoLAB's own integer display) — so
// artifact main/sub values are formatted explicitly with `fmtPropValue`
// below, while every other (always-integer) field keeps the old blanket
// rule as `fmtNum`.
//
// This is a hand-written walk of CharacterDoc's known shape rather than a
// fully generic one, specifically so artifact stat values can be formatted
// by which property they are — but it reproduces the SAME key order the
// previous generic `Object.keys(v).sort()` walker produced (alphabetical
// per object), so the on-disk canonical shape and existing hash-adjacent
// tests (see canon.test.ts) are unaffected beyond the flat-stat decimals fix
// itself.

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** Formats an artifact main/sub stat's numeric value at ITS OWN property's
 * display precision (0 decimals for flat stats, 1 for percentages). */
function fmtPropValue(propertyType: number, value: number): string {
  return value.toFixed(decimalsForId(propertyType));
}

function canonArtifact(a: CanonArtifact): string {
  const [mainProp, mainValue] = a.main;
  const subs = a.subs
    .map(([propertyType, value, tier]) => `[${propertyType},${fmtPropValue(propertyType, value)},${tier}]`)
    .join(',');
  // key order: fp, lvl, main, rarity, set, slot, subs (alphabetical).
  return `{"fp":${JSON.stringify(a.fp)},"lvl":${fmtNum(a.lvl)},` +
    `"main":[${mainProp},${fmtPropValue(mainProp, mainValue)}],` +
    `"rarity":${fmtNum(a.rarity)},"set":${fmtNum(a.set)},"slot":${fmtNum(a.slot)},"subs":[${subs}]}`;
}

function canonWeapon(w: CharacterDoc['weapon']): string {
  // key order: id, lvl, promote, refine (alphabetical).
  return `{"id":${fmtNum(w.id)},"lvl":${fmtNum(w.lvl)},"promote":${fmtNum(w.promote)},"refine":${fmtNum(w.refine)}}`;
}

function canonTalents(talents: [number, number][]): string {
  return `[${talents.map(([id, lvl]) => `[${fmtNum(id)},${fmtNum(lvl)}]`).join(',')}]`;
}

function canonDoc(doc: CharacterDoc): string {
  if (doc == null) throw new Error('canon: null não permitido');
  // key order: artifacts, asc, char, cons, friend, lvl, talents, v, weapon
  // (alphabetical).
  const artifacts = `[${doc.artifacts.map(canonArtifact).join(',')}]`;
  return `{"artifacts":${artifacts},"asc":${fmtNum(doc.asc)},"char":${JSON.stringify(doc.char)},` +
    `"cons":${fmtNum(doc.cons)},"friend":${fmtNum(doc.friend)},"lvl":${fmtNum(doc.lvl)},` +
    `"talents":${canonTalents(doc.talents)},"v":${fmtNum(doc.v)},"weapon":${canonWeapon(doc.weapon)}}`;
}

export function canonBytes(doc: CharacterDoc): Uint8Array {
  return new TextEncoder().encode(canonDoc(doc));
}
export function contentHash(doc: CharacterDoc): string {
  return createHash('sha256').update(canonBytes(doc)).digest('hex');
}
export function artifactFingerprint(a: Omit<CanonArtifact,'fp'>): string {
  const subs = [...a.subs].sort((x, y) => x[0] - y[0])
    .map(([p, , t]) => `${p}x${t}`).join(',');
  return `${a.set}:${a.slot}:${a.main[0]}:${subs}`;
}
export function accountHash(pairs: { charKey: string; contentHash: string }[]): string {
  const sorted = [...pairs].sort((a, b) => a.charKey.localeCompare(b.charKey));
  const h = createHash('sha256');
  for (const p of sorted) h.update(p.charKey).update('\0').update(p.contentHash).update('\n');
  return h.digest('hex');
}
