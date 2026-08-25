import { describe, it, expect } from 'vitest';
import { computeGaps, formatGaps } from '../scripts/gaps.js';
import type { RawMeta } from '../src/types.js';

const catalog = {
  '1': { slug: 'xiangling' },
  '2': { slug: 'bennett' },
  '3': { slug: 'ayaka' },
};

const raw: RawMeta = {
  profiles: [
    {
      schemaVersion: 1, character: 'xiangling', variants: [],
      provenance: { authoredBy: 'human', sources: [], authoredAt: '2026-08-24', validatedForVersion: '7.0', confidence: 'medium' },
    },
    {
      schemaVersion: 1, character: 'bennett', variants: [],
      provenance: { authoredBy: 'human', sources: [], authoredAt: '2026-01-01', validatedForVersion: '6.2', confidence: 'medium' },
    },
  ],
  archetypes: [
    {
      schemaVersion: 1, id: 'national', label: 'National', gameVersionAdded: '1.0',
      strength: 'meta', tags: [], sources: [],
      provenance: { authoredBy: 'human', confidence: 'medium' },
      slots: [{ role: ['sub-dps'], requires: { kind: 'character', anyOf: ['xiangling'] }, substitutable: false }],
    },
  ],
};

describe('computeGaps', () => {
  it('lista personagem do catálogo que não tem ficha', () => {
    const r = computeGaps({ catalog, raw, currentVersion: '7.0' });
    expect(r.withoutProfile).toEqual(['ayaka']);
  });

  it('lista personagem COM ficha que nenhum arquétipo nomeia', () => {
    const r = computeGaps({ catalog, raw, currentVersion: '7.0' });
    expect(r.withoutArchetype).toEqual(['bennett']);
  });

  it('lista ficha cujo patch de validade ficou para trás', () => {
    const r = computeGaps({ catalog, raw, currentVersion: '7.0' });
    expect(r.stale).toEqual([{ slug: 'bennett', validatedFor: '6.2' }]);
  });

  it('conta os totais', () => {
    const r = computeGaps({ catalog, raw, currentVersion: '7.0' });
    expect(r.totals).toEqual({ catalog: 3, profiles: 2, archetypes: 1 });
  });

  it('catálogo inteiro coberto devolve listas vazias', () => {
    const full = { ...raw, profiles: [...raw.profiles, { ...raw.profiles[0]!, character: 'ayaka' }] };
    const r = computeGaps({ catalog, raw: full, currentVersion: '7.0' });
    expect(r.withoutProfile).toEqual([]);
  });

  it('formatGaps produz texto em português que nomeia os faltantes', () => {
    const text = formatGaps(computeGaps({ catalog, raw, currentVersion: '7.0' }));
    expect(text).toContain('ayaka');
    expect(text).toMatch(/sem ficha/i);
    expect(text).toContain('bennett');
  });
});
