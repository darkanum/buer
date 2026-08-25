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
  it('reconstrói substat plano (flat) pelo valor inteiro exibido (property_type 2 = HP)', () => {
    const c = normalize(raw).characters.find(ch => ch.charKey === '10000089')!;
    const flatHp = c.doc.artifacts[0]!.subs.find(s => s[0] === 2)!;
    expect(flatHp).toBeDefined();
    expect(flatHp[1]).toBe(209); // valor exibido, sem decimal espúrio
    expect(flatHp[2]).toBe(1);   // 209 = tier 1 exato (209.13 → 1 roll)
  });
  it('usa `skills[].level` quando `level_current` não existe (payload real da HoYoLAB)', () => {
    const c = normalize(raw).characters.find(ch => ch.charKey === '10000046')!;
    expect(c.doc.talents).toEqual([[10351, 8]]);
  });
  it('mapeia property_type pelo esquema FightProp correto (6=ATK%, não ATK)', () => {
    const c = normalize(raw).characters.find(ch => ch.charKey === '10000089')!;
    // property_type 20 = critRate_ (não ATK/HP como no mapa antigo e errado).
    const critRate = c.doc.artifacts[0]!.subs.find(s => s[0] === 20)!;
    expect(critRate[1]).toBe(2.7);
  });
});
