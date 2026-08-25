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
  const pesquisasGravadas: string[] = [];
  return {
    written,
    pesquisasGravadas,
    deps: {
      targets,
      gameVersion: '7.0',
      authoredAt: '2026-08-25',
      existing: emptyMeta,
      research: async (slug: string) => ({
        text: `pesquisa de ${slug}`,
        urls: [`https://icy-veins.com/${slug}`],
        usage,
        truncated: false,
      }),
      writeResearch: (slug: string, text: string) => {
        pesquisasGravadas.push(`${slug}:${text}`);
      },
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
        return { text: 'ok', urls: [], usage, truncated: false };
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
      research: async () => ({
        text: 'ok', urls: [], usage: { inputTokens: 100, outputTokens: 200 }, truncated: false,
      }),
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
    const texto = formatBatchReport(await runBatch(d), 'characters');
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
    }, 'characters');
    expect(texto).toMatch(/NÃO RECONHECIDOS/);
    expect(texto).toContain('Conjunto Que Não Existe');
  });

  it('sem nomes descartados, a seção diz "nenhum" — não fica em branco nem some', () => {
    const texto = formatBatchReport({
      written: [], refused: [], failed: [], unresolved: [], truncated: [],
      usage: { inputTokens: 0, outputTokens: 0 }, estimatedCostUsd: 0,
    }, 'characters');
    expect(texto).toMatch(/NÃO RECONHECIDOS \(descartados\) \(0\)/);
  });
});

// ---------------------------------------------------------------------------
// O texto da pesquisa é artefato PAGO. Ele vai para o disco assim que volta,
// antes de qualquer decisão de recusar — antes ele só era escrito dentro de
// `writeDraft`, isto é, depois do `validateMeta`, e sumia exatamente nos dois
// caminhos em que o revisor humano mais precisaria dele.
// ---------------------------------------------------------------------------

describe('runBatch — o artefato da pesquisa sobrevive à recusa e à falha', () => {
  it('alvo RECUSADO por pesquisa insuficiente ainda tem o texto gravado', async () => {
    const { deps: d, written, pesquisasGravadas } = deps(['incompleto']);
    const r = await runBatch(d);
    expect(written).toEqual([]);
    expect(r.refused.map((x) => x.slug)).toEqual(['incompleto']);
    expect(pesquisasGravadas).toEqual(['incompleto:pesquisa de incompleto']);
  });

  it('alvo cuja EXTRAÇÃO falha ainda tem o texto gravado — as duas chamadas já foram pagas', async () => {
    const { deps: d, pesquisasGravadas } = deps(['xiangling'], {
      extract: async () => {
        throw new Error('saída fora do schema');
      },
    });
    const r = await runBatch(d);
    expect(r.failed.map((x) => x.slug)).toEqual(['xiangling']);
    expect(pesquisasGravadas).toEqual(['xiangling:pesquisa de xiangling']);
  });

  it('o texto vai para o disco ANTES da extração, não depois', async () => {
    const ordem: string[] = [];
    const { deps: d } = deps(['xiangling'], {
      writeResearch: () => { ordem.push('writeResearch'); },
      extract: async (slug: string) => {
        ordem.push('extract');
        return { claims: claimsFor(slug, true), usage: { inputTokens: 0, outputTokens: 0 } };
      },
    });
    await runBatch(d);
    expect(ordem).toEqual(['writeResearch', 'extract']);
  });
});

describe('runBatch — pesquisa truncada não passa em silêncio', () => {
  it('o alvo truncado aparece no relatório, numa seção própria, e ainda assim grava', async () => {
    const { deps: d } = deps(['xiangling'], {
      research: async (slug: string) => ({
        text: `pesquisa de ${slug}`, urls: [], usage, truncated: true,
      }),
    });
    const r = await runBatch(d);
    expect(r.truncated).toEqual(['xiangling']);
    expect(r.written).toEqual(['xiangling']);
    expect(formatBatchReport(r, 'characters')).toMatch(/PESQUISA TRUNCADA/);
  });

  it('sem truncamento, a seção diz "nenhum" — não some nem fica em branco', async () => {
    const { deps: d } = deps(['xiangling']);
    const r = await runBatch(d);
    expect(r.truncated).toEqual([]);
    expect(formatBatchReport(r, 'characters')).toMatch(/PESQUISA TRUNCADA[^\n]*\(0\)/);
  });
});

// ---------------------------------------------------------------------------
// O rodapé é compartilhado pelos dois lotes e afirma origem, caminho de
// arquivo e caminho de promoção. Para o lote de times as três afirmações eram
// falsas — inclusive chamando de "ficha" o que ali é id de ARQUÉTIPO.
// ---------------------------------------------------------------------------

describe('formatBatchReport — o rodapé diz a verdade para cada lote', () => {
  const vazio = {
    written: ['national'], refused: [], failed: [], unresolved: [], truncated: [],
    usage: { inputTokens: 0, outputTokens: 0 }, estimatedCostUsd: 0,
  };

  it('lote de personagens fala de FICHA e do caminho data/research/<slug>.md', () => {
    const texto = formatBatchReport(vazio, 'characters');
    expect(texto).toMatch(/GRAVADOS — fichas/);
    expect(texto).toContain('data/research/<slug>.md');
    expect(texto).not.toContain('data/research/times-');
  });

  it('lote de times fala de ARQUÉTIPO e do caminho data/research/times-<slug>.md', () => {
    const texto = formatBatchReport(vazio, 'archetypes');
    expect(texto).toMatch(/GRAVADOS — arquétipos/);
    expect(texto).toContain('data/research/times-<slug>.md');
    expect(texto).toMatch(/ids acima são de ARQUÉTIPO/);
    // Não pode chamar de "ficha" uma lista de ids de arquétipo.
    expect(texto).not.toMatch(/Toda ficha gravada/);
  });
});
