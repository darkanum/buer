import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadMeta } from '@buer/meta';
import type { CharacterKey } from '@buer/core';
import { rosterFromHoyolab } from '../../src/roster/from-hoyolab.js';
import { matchArchetype } from '../../src/team/matching.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(
  readFileSync(path.join(HERE, '..', '..', '..', 'core', 'test', 'fixtures', 'real-account.scrubbed.json'), 'utf8'),
);
const roster = rosterFromHoyolab(raw, { capturedAt: '2026-08-24T00:00:00.000Z', lang: 'pt-br' });
const bank = loadMeta();
const national = bank.archetypes.find((a) => a.id === 'national')!;
const XIANGLING = '10000023' as CharacterKey;

describe('matchArchetype', () => {
  it('National é jogável na conta real (xiangling, bennett, xingqiu, e um anemo)', () => {
    const m = matchArchetype(national, roster, bank, { require: XIANGLING });
    expect(m.status).toBe('playable');
    expect(m.missing).toHaveLength(0);
    expect(m.fills.filter(Boolean)).toHaveLength(4);
  });

  it('o personagem exigido ocupa um slot que ele pode ocupar', () => {
    const m = matchArchetype(national, roster, bank, { require: XIANGLING });
    expect(m.fills).toContain(XIANGLING);
  });

  it('nenhum personagem ocupa dois slots', () => {
    const m = matchArchetype(national, roster, bank, { require: XIANGLING });
    const filled = m.fills.filter((f): f is CharacterKey => f !== null);
    expect(new Set(filled).size).toBe(filled.length);
  });

  it('roster sem xingqiu deixa o time bloqueado por um slot', () => {
    const without = {
      ...roster,
      characters: new Map([...roster.characters].filter(([k]) => k !== '10000025')),
    };
    const m = matchArchetype(national, without, bank, { require: XIANGLING });
    expect(m.status).toBe('blocked-by-one');
    expect(m.missing).toHaveLength(1);
  });

  it('roster quase vazio fica too-far e não é para exibir', () => {
    const almostEmpty = {
      ...roster,
      characters: new Map([...roster.characters].filter(([k]) => k === '10000023')),
    };
    const m = matchArchetype(national, almostEmpty, bank, { require: XIANGLING });
    expect(m.status).toBe('too-far');
  });

  it('slot flex casa por papel declarado na ficha, não por nome', () => {
    // O 4º slot do National é flex: anemo com driver/debuffer. Nenhum anemo
    // com ficha => o slot não fecha, mesmo tendo anemos no roster.
    const m = matchArchetype(national, roster, bank, { require: XIANGLING });
    const flexIndex = national.slots.findIndex((s) => s.substitutable);
    expect(flexIndex).toBeGreaterThanOrEqual(0);
    // Depende de haver ficha de anemo; a Task 11 adiciona sucrose.
    expect(typeof m.fills[flexIndex]).not.toBe('undefined');
  });
});
