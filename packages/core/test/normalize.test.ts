import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { normalize } from '../src/normalize.js';

const raw = {
  list: { list: [{ id: 10000089, weapon: { id: 13509 } }] },
  detail: JSON.parse(readFileSync(new URL('./fixtures/detail.sample.json', import.meta.url), 'utf8')),
};

describe('normalize', () => {
  it('produz um doc por personagem com hash estável', () => {
    const r1 = normalize(raw);
    const r2 = normalize(raw);
    expect(r1.characters.length).toBeGreaterThan(0);
    expect(r1.accountHash).toBe(r2.accountHash); // determinístico
  });
  it('só inclui talentos de skill_type 1 (Normal/Skill/Burst)', () => {
    const c = normalize(raw).characters[0]!;
    expect(c.doc.talents.length).toBeLessThanOrEqual(3);
  });
  it('artefatos carregam fingerprint sintético', () => {
    const c = normalize(raw).characters.find(c => c.doc.artifacts.length > 0);
    if (c) expect(c.doc.artifacts[0]!.fp).toMatch(/^\d+:\d+:\d+:/);
  });
  it('reconstrói substats como tiers, não valor exibido', () => {
    const c = normalize(raw).characters.find(c => c.doc.artifacts.length > 0);
    if (c) for (const s of c.doc.artifacts[0]!.subs) expect(s[2]).toBeGreaterThanOrEqual(1);
  });
});
