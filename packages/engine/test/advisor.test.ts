import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadMeta } from '@buer/meta';
import type { CharacterKey } from '@buer/core';
import { rosterFromHoyolab } from '../src/roster/from-hoyolab.js';
import { CuratedRosterAdvisor } from '../src/advisor/advisor.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(
  readFileSync(path.join(HERE, '..', '..', 'core', 'test', 'fixtures', 'real-account.scrubbed.json'), 'utf8'),
);
const full = rosterFromHoyolab(raw, { capturedAt: '2026-08-24T00:00:00.000Z', lang: 'pt-br' });
const bank = loadMeta();
const advisor = new CuratedRosterAdvisor({ bank });
const XIANGLING = '10000023' as CharacterKey;
const XINGQIU = '10000025' as CharacterKey;

const without = (key: string) => ({
  ...full,
  characters: new Map([...full.characters].filter(([k]) => k !== key)),
});

describe('CuratedRosterAdvisor', () => {
  it('roster sem xingqiu sugere adquirir xingqiu, com o arquétipo que ele destrava', async () => {
    const advice = await advisor.adviseFor(XIANGLING, without('10000025'));
    const candidate = advice.candidates.find(
      (c) => c.axis.kind === 'newCharacter' && c.axis.character === XINGQIU,
    );
    expect(candidate).toBeDefined();
    expect(candidate!.unlocks.map((u) => u.archetype.id)).toContain('national');
    expect(candidate!.explanation.summary).toContain('National');
  });

  it('não sugere nada para um arquétipo que já é jogável', async () => {
    const advice = await advisor.adviseFor(XIANGLING, full);
    // Escopado ao National de propósito: a Task 11 acrescenta arquétipos em
    // que Xiangling pode hospedar um slot flex de pyro, e um
    // `toHaveLength(0)` global passaria a quebrar por crescimento do banco,
    // não por regressão do conselheiro.
    const unlocked = advice.candidates.flatMap((c) => c.unlocks.map((u) => u.archetype.id));
    expect(unlocked).not.toContain('national');
  });

  it('improves fica VAZIO na Fase 2 — não se afirma quanto rende (spec §8.4)', async () => {
    const advice = await advisor.adviseFor(XIANGLING, without('10000025'));
    for (const candidate of advice.candidates) expect(candidate.improves).toHaveLength(0);
  });

  it('ordena por quantos arquétipos destrava, depois por força curada', async () => {
    const advice = await advisor.adviseFor(XIANGLING, without('10000025'));
    for (let i = 1; i < advice.candidates.length; i++) {
      const previous = advice.candidates[i - 1]!;
      const current = advice.candidates[i]!;
      expect(previous.unlocks.length).toBeGreaterThanOrEqual(current.unlocks.length);
    }
  });

  it('declara nas assunções que não sabe disponibilidade de gacha', async () => {
    const advice = await advisor.adviseFor(XIANGLING, without('10000025'));
    const text = advice.candidates[0]!.provenance.assumptions.join(' ');
    expect(text).toMatch(/gacha|disponibilidade/i);
  });

  it('slot flex vazio vira CoverageGap com elemento e papéis, não um nome', async () => {
    // remove todos os anemo do roster: o slot flex do National deixa de fechar
    const noAnemo = {
      ...full,
      characters: new Map([...full.characters].filter(([, c]) => c.element !== 'anemo')),
    };
    const advice = await advisor.adviseFor(XIANGLING, noAnemo);
    const gap = advice.coverageGaps.find((g) => g.missing.element === 'anemo');
    expect(gap).toBeDefined();
    expect(gap!.blockedArchetypes).toContain('national');
    expect(['critical', 'notable', 'minor']).toContain(gap!.severity);
  });

  it('a visão de conta cobre todos os arquétipos, não só os de um personagem', async () => {
    const accountView = await advisor.advise(without('10000025'), {} as never);
    const characterView = await advisor.adviseFor(XIANGLING, without('10000025'));
    expect(accountView.candidates.length).toBeGreaterThanOrEqual(characterView.candidates.length);
  });
});
