import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runAnalyze } from '../src/commands/analyze.js';
import { renderReport } from '../src/report.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, '..', '..', '..', 'packages', 'core', 'test', 'fixtures', 'real-account.scrubbed.json');
const GOLDEN = path.join(HERE, '__golden__', 'analyze-63.json');

describe('runAnalyze --character', () => {
  it('devolve times e veredito para xiangling', async () => {
    const result = await runAnalyze({ from: FIXTURE, character: 'xiangling' });
    expect(result.scope).toBe('character');
    expect(result.characters).toHaveLength(1);
    const entry = result.characters[0]!;
    expect(entry.slug).toBe('xiangling');
    expect(entry.playableTeams.length).toBeGreaterThan(0);
    expect(entry.playableTeams[0]!.findings.length).toBe(5);
  });

  it('personagem sem ficha devolve os FATOS e diz que não há veredito', async () => {
    const result = await runAnalyze({ from: FIXTURE, character: 'barbara' });
    const entry = result.characters[0]!;
    expect(entry.playableTeams).toHaveLength(0);
    expect(entry.note).toMatch(/sem ficha|sem time curado/i);
    expect(entry.observed.atk).toBeTypeOf('number');
  });

  it('--variant fixa a variante julgada', async () => {
    const result = await runAnalyze({ from: FIXTURE, character: 'xiangling', variant: 'vaporize' });
    const team = result.characters[0]!.playableTeams[0];
    if (team) expect(team.variantId).toBe('vaporize');
  });

  it('slug desconhecido falha com mensagem útil, não com stack', async () => {
    await expect(runAnalyze({ from: FIXTURE, character: 'nao-existe' })).rejects.toThrow(/nao-existe/);
  });
});

describe('renderReport', () => {
  it('nomeia a variante julgada e traz o why de todo achado bloqueante', async () => {
    const result = await runAnalyze({ from: FIXTURE, character: 'xiangling' });
    const text = renderReport(result);
    expect(text).toMatch(/variante/i);
    for (const entry of result.characters) {
      for (const team of entry.playableTeams) {
        for (const finding of team.findings) {
          if (finding.status === 'blocking') expect(finding.why ?? '').not.toBe('');
        }
      }
    }
  });
});

describe('golden file da conta inteira', () => {
  it('o relatório dos 63 personagens não mudou sem revisão', async () => {
    const result = await runAnalyze({ from: FIXTURE, account: true });
    const serialized = JSON.stringify(result, null, 2);

    if (process.env['UPDATE_GOLDEN'] === '1' || !existsSync(GOLDEN)) {
      writeFileSync(GOLDEN, serialized);
    }
    expect(serialized).toBe(readFileSync(GOLDEN, 'utf8'));
  });

  it('invariantes sobre os 63 reais (spec §12, camada 3)', async () => {
    const result = await runAnalyze({ from: FIXTURE, account: true });
    expect(result.characters).toHaveLength(63);

    for (const entry of result.characters) {
      // todo personagem ou tem time, ou tem um motivo explícito de não ter
      const hasTeams = entry.playableTeams.length + entry.blockedTeams.length > 0;
      expect(hasTeams || (entry.note ?? '') !== '').toBe(true);

      for (const team of [...entry.playableTeams, ...entry.blockedTeams]) {
        expect(team.variantId ?? '').not.toBe('');   // variante SEMPRE nomeada
        expect(team.explanation).not.toBe('');       // veredito SEMPRE explicado
        for (const finding of team.findings) {
          expect(finding.summary).not.toBe('');
          if (finding.status === 'blocking') expect(finding.why ?? '').not.toBe('');
        }
      }
    }
  });
});
