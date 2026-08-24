import { createHash } from 'node:crypto';

export interface CanonArtifact {
  slot: 1|2|3|4|5; set: number; lvl: number; rarity: 3|4|5;
  main: [number, number]; subs: [number, number, 1|2|3|4][]; fp: string;
}
export interface CharacterDoc {
  v: 1; char: string; lvl: number; asc: number; cons: number; friend: number;
  weapon: { id: number; lvl: number; promote: number; refine: number };
  talents: [number, number][]; artifacts: CanonArtifact[];
}

function canonValue(v: unknown): string {
  if (v === null) throw new Error('canon: null não permitido');
  if (Array.isArray(v)) return `[${v.map(canonValue).join(',')}]`;
  if (typeof v === 'object') {
    const keys = Object.keys(v as object).sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${canonValue((v as any)[k])}`).join(',')}}`;
  }
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(1);
  return JSON.stringify(v);
}

export function canonBytes(doc: CharacterDoc): Uint8Array {
  return new TextEncoder().encode(canonValue(doc));
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
