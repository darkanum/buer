import { describe, it, expect } from 'vitest';
import { runBatch, parseArgs, estimateCostUsd, formatBatchReport } from '../scripts/research-characters.js';
import type { CharacterClaims } from '../scripts/research/claims.js';

const emptyMeta = { profiles: [], archetypes: [] };
const usage = { inputTokens: 100, outputTokens: 50 };

const claimsFor = (slug: string, complete: boolean): CharacterClaims => ({
  character: slug,
  claims: [
    {
      source: 'icy-veins', url: `https://icy-veins.com/${slug}`,
      ...(complete
        ? {
            sets: ['emblem-of-severed-fate'],
            mainStats: { sands: ['enerRech_'], goblet: ['pyro_dmg_'], circlet: ['critRate_'] },
            roles: ['sub-dps'], scalesOn: 'atk',
          }
        : {}),
    },
    {
      source: 'game8', url: `https://game8.co/${slug}`,
      ...(complete
        ? {
            sets: ['emblem-of-severed-fate'],
            mainStats: { sands: ['enerRech_'], goblet: ['pyro_dmg_'], circlet: ['critRate_'] },
            roles: ['sub-dps'], scalesOn: 'atk',
          }
        : {}),
    },
  ],
});

function deps(targets: string[], over: Partial<Parameters<typeof runBatch>[0]> = {}) {
  const written: string[] = [];
  return {
    written,
    deps: {
      targets,
      gameVersion: '7.0',
      authoredAt: '2026-08-25',
      existing: emptyMeta,
      research: async (slug: string) => ({ text: `pesquisa de ${slug}`, urls: [], usage }),
      extract: async (slug: string) => claimsFor(slug, slug !== 'incompleto'),
      write: (draft: { profile: { character: string } | null }) => {
        written.push(draft.profile!.character);
      },
      ...over,
    } as Parameters<typeof runBatch>[0],
  };
}

describe('parseArgs', () => {
  it('--only aceita lista separada por vírgula', () => {
    expect(parseArgs(['--only', 'xiangling,bennett']).only).toEqual(['xiangling', 'bennett']);
  });

  it('--all e --limit e --dry-run', () => {
    const f = parseArgs(['--all', '--limit', '5', '--dry-run']);
    expect(f.all).toBe(true);
    expect(f.limit).toBe(5);
    expect(f.dryRun).toBe(true);
  });

  it('sem alvo nenhum não assume --all', () => {
    const f = parseArgs([]);
    expect(f.all).toBe(false);
    expect(f.only).toEqual([]);
  });
});

describe('estimateCostUsd', () => {
  it('usa a tabela de preço do modelo', () => {
    // 1M de entrada + 1M de saída em claude-opus-5 = 5 + 25
    expect(estimateCostUsd({ inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(30, 5);
  });
});

describe('runBatch', () => {
  it('escreve rascunho para quem a pesquisa cobriu', async () => {
    const { deps: d, written } = deps(['xiangling']);
    const r = await runBatch(d);
    expect(written).toEqual(['xiangling']);
    expect(r.written).toEqual(['xiangling']);
  });

  it('recusa sem gravar quando falta o mínimo, e diz por quê', async () => {
    const { deps: d, written } = deps(['incompleto']);
    const r = await runBatch(d);
    expect(written).toEqual([]);
    expect(r.refused.map((x) => x.slug)).toEqual(['incompleto']);
    expect(r.refused[0]!.because.join(' ')).toMatch(/conjunto|papel|escala|main-stat/i);
  });

  it('uma falha não derruba o lote — os outros continuam', async () => {
    const { deps: d, written } = deps(['quebra', 'xiangling'], {
      research: async (slug: string) => {
        if (slug === 'quebra') throw new Error('limite de taxa atingido');
        return { text: 'ok', urls: [], usage };
      },
    });
    const r = await runBatch(d);
    expect(r.failed.map((x) => x.slug)).toEqual(['quebra']);
    expect(written).toEqual(['xiangling']);
  });

  it('soma o uso de tokens de todos os alvos', async () => {
    const { deps: d } = deps(['xiangling', 'incompleto']);
    const r = await runBatch(d);
    expect(r.usage.inputTokens).toBe(200);
    expect(r.estimatedCostUsd).toBeGreaterThan(0);
  });

  it('o relatório nomeia escritos, recusados e falhados', async () => {
    const { deps: d } = deps(['xiangling', 'incompleto']);
    const texto = formatBatchReport(await runBatch(d));
    expect(texto).toContain('xiangling');
    expect(texto).toContain('incompleto');
    expect(texto).toMatch(/recusad/i);
    expect(texto).toMatch(/US\$|custo/i);
  });
});
