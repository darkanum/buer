import { describe, it, expect } from 'vitest';
import {
  characterSlugs, checkTargets, currentGameVersion, describeUnknownTargets,
} from '../scripts/catalog.js';

describe('currentGameVersion', () => {
  it('lê o patch corrente do dado versionado, num só lugar', () => {
    expect(currentGameVersion()).toMatch(/^\d+\.\d+$/);
  });
});

describe('characterSlugs', () => {
  it('devolve os slugs do catálogo do gi-data, ordenados', () => {
    const slugs = characterSlugs();
    expect(slugs.length).toBeGreaterThan(100);
    expect(slugs).toContain('xiangling');
    expect([...slugs]).toEqual([...slugs].sort());
  });
});

// ---------------------------------------------------------------------------
// `--only xianglin` (typo) virava alvo real: duas chamadas de API pagas,
// pesquisa sobre um personagem que não existe, e só então `writeDraft`
// recusava. O catálogo já está carregado antes de o lote começar a gastar.
// ---------------------------------------------------------------------------

describe('checkTargets', () => {
  const catalogo = ['xiangling', 'xingqiu', 'bennett', 'chevreuse'];

  it('slug conhecido não vira problema', () => {
    expect(checkTargets(['xiangling', 'bennett'], catalogo)).toEqual([]);
  });

  it('slug desconhecido é reportado, com as sugestões próximas', () => {
    const [problema] = checkTargets(['xianglin'], catalogo);
    expect(problema!.slug).toBe('xianglin');
    expect(problema!.suggestions).toContain('xiangling');
  });

  it('slug sem nada parecido é reportado mesmo assim, com sugestão nenhuma', () => {
    const [problema] = checkTargets(['zzzzzzzzzzzz'], catalogo);
    expect(problema!.slug).toBe('zzzzzzzzzzzz');
    expect(problema!.suggestions).toEqual([]);
  });

  it('reporta TODOS os desconhecidos, não só o primeiro', () => {
    const problemas = checkTargets(['xianglin', 'bennet', 'xingqiu'], catalogo);
    expect(problemas.map((p) => p.slug)).toEqual(['xianglin', 'bennet']);
  });

  it('lista vazia (o caso de --all) não inventa problema', () => {
    expect(checkTargets([], catalogo)).toEqual([]);
  });

  it('a mensagem nomeia o slug e, quando há, a sugestão', () => {
    const texto = describeUnknownTargets(checkTargets(['xianglin', 'zzzzzzzzzzzz'], catalogo));
    expect(texto).toContain('xianglin');
    expect(texto).toContain('xiangling');
    expect(texto).toContain('zzzzzzzzzzzz');
  });
});
