import { describe, it, expect } from 'vitest';
import { runBatch, parseArgs, estimateCostUsd, formatBatchReport, withUnresolvedTracking } from '../scripts/research-characters.js';
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
      // Uso zerado por padrão: os testes que já somam `r.usage` a partir só
      // da pesquisa continuam válidos sem reescrever a conta. O teste
      // dedicado a somar as DUAS chamadas usa valores explícitos.
      extract: async (slug: string) => ({
        claims: claimsFor(slug, slug !== 'incompleto'),
        usage: { inputTokens: 0, outputTokens: 0 },
      }),
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

  it('--limit sem valor nenhum é erro de uso, não NaN silencioso', () => {
    const f = parseArgs(['--all', '--limit']);
    expect(f.limit).toBeUndefined();
    expect(f.error).toBeDefined();
  });

  it('--limit com valor não numérico é erro de uso, não NaN silencioso', () => {
    const f = parseArgs(['--all', '--limit', 'abc']);
    expect(f.limit).toBeUndefined();
    expect(f.error).toBeDefined();
  });

  it('--limit sem valor não engole a flag seguinte — --dry-run continua true', () => {
    // O bug que isto pega: sem essa guarda, "--limit --dry-run" consumiria
    // "--dry-run" como SE FOSSE o valor de --limit, e a flag que existe para
    // não gastar dinheiro sumiria em silêncio.
    const f = parseArgs(['--all', '--limit', '--dry-run']);
    expect(f.dryRun).toBe(true);
    expect(f.limit).toBeUndefined();
    expect(f.error).toBeDefined();
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

  it('soma o uso das DUAS chamadas de API por alvo — pesquisa E extração, não só a primeira', async () => {
    const { deps: d } = deps(['xiangling'], {
      research: async () => ({ text: 'ok', urls: [], usage: { inputTokens: 100, outputTokens: 200 } }),
      extract: async (slug: string) => ({
        claims: claimsFor(slug, true),
        usage: { inputTokens: 50, outputTokens: 25 },
      }),
    });
    const r = await runBatch(d);
    expect(r.usage).toEqual({ inputTokens: 150, outputTokens: 225 });
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

describe('withUnresolvedTracking — o mecanismo de descarte fica ligado, não só disponível', () => {
  it('acumula os nomes descartados por alvo, sem mudar a forma que runBatch espera de `extract`', async () => {
    const tracked = withUnresolvedTracking(async (slug: string, _text: string, onUnresolved) => {
      if (slug === 'xiangling') onUnresolved('game8', ['Conjunto Que Não Existe']);
      return { claims: claimsFor(slug, true), usage: { inputTokens: 1, outputTokens: 1 } };
    });

    await tracked.extract('xiangling', 'texto');
    await tracked.extract('bennett', 'texto'); // não descarta nada — não deve aparecer

    expect(tracked.unresolved).toEqual([{ slug: 'xiangling', names: ['Conjunto Que Não Existe'] }]);
  });

  it('o nome descartado chega ao relatório final, numa seção própria', async () => {
    const { deps: d } = deps(['xiangling']);
    const report = await runBatch(d);
    const texto = formatBatchReport({
      ...report,
      unresolved: [{ slug: 'xiangling', names: ['Conjunto Que Não Existe'] }],
    });
    expect(texto).toMatch(/NÃO RECONHECIDOS/);
    expect(texto).toContain('Conjunto Que Não Existe');
  });

  it('sem nomes descartados, a seção diz "nenhum" — não fica em branco nem some', () => {
    const texto = formatBatchReport({
      written: [], refused: [], failed: [], unresolved: [],
      usage: { inputTokens: 0, outputTokens: 0 }, estimatedCostUsd: 0,
    });
    expect(texto).toMatch(/NÃO RECONHECIDOS \(descartados\) \(0\)/);
  });
});
