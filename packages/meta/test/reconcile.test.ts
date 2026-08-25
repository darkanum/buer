import { describe, it, expect } from 'vitest';
import { reconcileCharacter } from '../scripts/research/reconcile.js';
import type { CharacterClaims, SourceClaim } from '../scripts/research/claims.js';

const claim = (over: Partial<SourceClaim> & Pick<SourceClaim, 'source' | 'url'>): SourceClaim =>
  ({ ...over }) as SourceClaim;

const three = (a: Partial<SourceClaim>, b: Partial<SourceClaim>, c: Partial<SourceClaim>): CharacterClaims => ({
  character: 'xiangling',
  claims: [
    claim({ source: 'icy-veins', url: 'https://icy-veins.com/x', ...a }),
    claim({ source: 'game8', url: 'https://game8.co/x', ...b }),
    claim({ source: 'genshin-builds', url: 'https://genshin-builds.com/x', ...c }),
  ],
});

describe('reconcileCharacter — campos de LISTA: união e ranking, nunca descarte', () => {
  it('três fontes com a mesma lista produz a lista, sem divergência', () => {
    const r = reconcileCharacter(three(
      { sets: ['emblem-of-severed-fate'] },
      { sets: ['emblem-of-severed-fate'] },
      { sets: ['emblem-of-severed-fate'] },
    ));
    expect(r.agreed.sets).toEqual(['emblem-of-severed-fate']);
    expect(r.divergences).toEqual([]);
    expect(r.confidence).toBe('medium');
  });

  it('fontes com conjuntos DIFERENTES guardam os dois, o mais citado primeiro', () => {
    const r = reconcileCharacter(three(
      { sets: ['emblem-of-severed-fate'] },
      { sets: ['emblem-of-severed-fate'] },
      { sets: ['crimson-witch-of-flames'] },
    ));
    // nada é descartado: a ficha suporta alternativa ranqueada, e a segunda
    // opção vira rank 2 em vez de sumir
    expect(r.agreed.sets).toEqual(['emblem-of-severed-fate', 'crimson-witch-of-flames']);
  });

  it('divergência de lista é `alternatives` e NÃO derruba a confiança', () => {
    const r = reconcileCharacter(three(
      { sets: ['a-set'] }, { sets: ['a-set'] }, { sets: ['b-set'] },
    ));
    const d = r.divergences.find((x) => x.field === 'sets')!;
    expect(d.kind).toBe('alternatives');
    expect(r.confidence).toBe('medium');
  });

  it('três listas totalmente diferentes viram três opções ranqueadas', () => {
    const r = reconcileCharacter(three(
      { sets: ['a-set'] }, { sets: ['b-set'] }, { sets: ['c-set'] },
    ));
    expect(r.agreed.sets).toHaveLength(3);
    // sem consenso em nenhum item, a ordem é determinística (alfabética)
    expect(r.agreed.sets).toEqual(['a-set', 'b-set', 'c-set']);
  });

  it('item citado por mais fontes vence item citado em posição melhor por uma só', () => {
    const r = reconcileCharacter(three(
      { weapons: ['engulfing-lightning', 'the-catch'] },
      { weapons: ['the-catch'] },
      { weapons: ['the-catch'] },
    ));
    expect(r.agreed.weapons![0]).toBe('the-catch');
  });

  it('empate de apoio é desempatado pela posição média nas fontes', () => {
    const r = reconcileCharacter(three(
      { weapons: ['the-catch', 'dragon-s-bane'] },
      { weapons: ['the-catch', 'dragon-s-bane'] },
      {},
    ));
    expect(r.agreed.weapons).toEqual(['the-catch', 'dragon-s-bane']);
    expect(r.divergences).toEqual([]);
  });

  it('main-stats reconciliam por slot, cada um com união e ranking', () => {
    const r = reconcileCharacter(three(
      { mainStats: { sands: ['enerRech_'], goblet: ['pyro_dmg_'] } },
      { mainStats: { sands: ['enerRech_'], goblet: ['pyro_dmg_'] } },
      { mainStats: { sands: ['atk_'], goblet: ['pyro_dmg_'] } },
    ));
    expect(r.agreed.mainStats?.sands).toEqual(['enerRech_', 'atk_']);
    expect(r.agreed.mainStats?.goblet).toEqual(['pyro_dmg_']);
    expect(r.divergences.map((d) => d.field)).toEqual(['mainStats.sands']);
  });
});

describe('reconcileCharacter — campo de CONJUNTO não ordenado (`roles`): união alfabética, sem ranking por posição ou frequência', () => {
  it('fontes com o mesmo conjunto de papéis produz a união, sem divergência, e conta como corroborado (confiança medium)', () => {
    const r = reconcileCharacter(three(
      { roles: ['dps'] }, { roles: ['dps'] }, { roles: ['dps'] },
    ));
    expect(r.agreed.roles).toEqual(['dps']);
    expect(r.divergences).toEqual([]);
    expect(r.confidence).toBe('medium');
  });

  it('fontes com papéis DIFERENTES: união de todos, ordenada alfabeticamente, divergência `alternatives` que não derruba a confiança', () => {
    const r = reconcileCharacter(three(
      { roles: ['dps'] }, { roles: ['dps'] }, { roles: ['support'] },
    ));
    expect(r.agreed.roles).toEqual(['dps', 'support']);
    const d = r.divergences.find((x) => x.field === 'roles')!;
    expect(d.kind).toBe('alternatives');
    // duas fontes concordam em 'dps' — corroborado, e não há contradição
    // (que só existe para campo escalar) — logo a confiança não é derrubada
    expect(r.confidence).toBe('medium');
  });

  it('papel citado por duas fontes e papel citado por uma só entram os dois, e a ordem continua alfabética — NÃO por frequência', () => {
    const r = reconcileCharacter(three(
      { roles: ['support'] }, { roles: ['support'] }, { roles: ['dps'] },
    ));
    // 'support' tem o dobro de citações de 'dps', mas a ordem alfabética
    // ('dps' < 'support') vence: é o que distingue mergeSet de mergeRanked,
    // que ordenaria 'support' primeiro por ter mais apoio.
    expect(r.agreed.roles).toEqual(['dps', 'support']);
  });

  it('fonte que não cobre `roles` não vota nem diverge', () => {
    const r = reconcileCharacter(three({ roles: ['dps'] }, { roles: ['dps'] }, {}));
    expect(r.agreed.roles).toEqual(['dps']);
    expect(r.divergences).toEqual([]);
    expect(r.confidence).toBe('medium');
  });

  // -------------------------------------------------------------------------
  // Corroboração de `roles` conta FONTES DISTINTAS, nunca ocorrências.
  //
  // `RawClaimSchema` não exige unicidade dentro de `roles`, e `fold()` colapsa
  // "Sub DPS" e "sub-dps" no mesmo `sub-dps`: uma fonte só listando o papel
  // duas vezes é um caso alcançável, não hipotético. Contar ocorrências fazia
  // essa ficha single-sourced sair `medium` — e `corroborated` é metade da
  // regra de confiança que chega ao usuário.
  // -------------------------------------------------------------------------

  it('UMA fonte repetindo o mesmo papel NÃO corrobora — a ficha continua single-sourced (low)', () => {
    const r = reconcileCharacter({
      character: 'x',
      claims: [claim({ source: 'icy-veins', url: 'u', roles: ['sub-dps', 'sub-dps'] })],
    });
    expect(r.agreed.roles).toEqual(['sub-dps']);
    expect(r.confidence).toBe('low');
  });

  it('DUAS fontes citando o mesmo papel continuam corroborando (medium)', () => {
    const r = reconcileCharacter({
      character: 'x',
      claims: [
        claim({ source: 'icy-veins', url: 'u1', roles: ['sub-dps'] }),
        claim({ source: 'game8', url: 'u2', roles: ['sub-dps'] }),
      ],
    });
    expect(r.agreed.roles).toEqual(['sub-dps']);
    expect(r.confidence).toBe('medium');
  });
});

describe('reconcileCharacter — campos de VALOR ÚNICO: aqui divergir é contradição', () => {
  it('maioria simples decide o limiar de ER', () => {
    const r = reconcileCharacter(three(
      { erThreshold: 200 }, { erThreshold: 200 }, { erThreshold: 160 },
    ));
    expect(r.agreed.erThreshold).toBe(200);
  });

  it('contradição em campo escalar é `conflict` e DERRUBA a confiança', () => {
    const r = reconcileCharacter(three(
      { erThreshold: 200 }, { erThreshold: 200 }, { erThreshold: 160 },
    ));
    const d = r.divergences.find((x) => x.field === 'erThreshold')!;
    expect(d.kind).toBe('conflict');
    expect(r.confidence).toBe('low');
  });

  it('sem maioria, o campo escalar fica AUSENTE — não escolhemos por desempate', () => {
    const r = reconcileCharacter(three(
      { scalesOn: 'atk' }, { scalesOn: 'hp' }, { scalesOn: 'def' },
    ));
    expect(r.agreed.scalesOn).toBeUndefined();
    expect(r.confidence).toBe('low');
  });

  it('fonte que não cobre o campo não vota nem diverge', () => {
    const r = reconcileCharacter(three({ erThreshold: 200 }, { erThreshold: 200 }, {}));
    expect(r.agreed.erThreshold).toBe(200);
    expect(r.divergences).toEqual([]);
    expect(r.confidence).toBe('medium');
  });
});

describe('reconcileCharacter — confiança e proveniência', () => {
  it('nada corroborado por 2+ fontes derruba para low, mesmo sem contradição', () => {
    const r = reconcileCharacter(three({ erThreshold: 200 }, {}, {}));
    expect(r.agreed.erThreshold).toBe(200);
    expect(r.confidence).toBe('low');
  });

  it('nenhuma fonte cobrindo nada devolve agreed vazio e low', () => {
    const r = reconcileCharacter(three({}, {}, {}));
    expect(r.agreed).toEqual({});
    expect(r.confidence).toBe('low');
  });

  it('sources traz a URL de TODA fonte consultada, mesmo a que não cobriu nada', () => {
    const r = reconcileCharacter(three({ sets: ['x'] }, {}, {}));
    expect(r.sources).toEqual([
      'https://icy-veins.com/x',
      'https://game8.co/x',
      'https://genshin-builds.com/x',
    ]);
  });

  it('é determinístico independente da ordem das fontes no array — lista com alternativas e escalar em conflito', () => {
    // Mesmos três claims que exercitam os dois caminhos: `sets` diverge como
    // `alternatives` (união+ranking) e `erThreshold` diverge como `conflict`
    // (maioria escalar). O que muda entre r1 e r2 é só a ORDEM em que as
    // fontes aparecem no array — a reconciliação não pode depender disso.
    const icyVeins = claim({ source: 'icy-veins', url: 'https://icy-veins.com/x', sets: ['a-set', 'b-set'], erThreshold: 200 });
    const game8 = claim({ source: 'game8', url: 'https://game8.co/x', sets: ['b-set', 'a-set'], erThreshold: 200 });
    const genshinBuilds = claim({ source: 'genshin-builds', url: 'https://genshin-builds.com/x', sets: ['c-set'], erThreshold: 160 });

    const r1 = reconcileCharacter({ character: 'xiangling', claims: [icyVeins, game8, genshinBuilds] });
    const r2 = reconcileCharacter({ character: 'xiangling', claims: [game8, icyVeins, genshinBuilds] });

    // prova que o teste atravessa os dois caminhos, não só compara dois vazios
    expect(r1.agreed.sets).toEqual(['a-set', 'b-set', 'c-set']);
    expect(r1.confidence).toBe('low');
    expect(r1.divergences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'sets', kind: 'alternatives' }),
        expect.objectContaining({ field: 'erThreshold', kind: 'conflict' }),
      ]),
    );

    expect(r2.agreed).toEqual(r1.agreed);
    expect(r2.confidence).toBe(r1.confidence);
    expect(r2.divergences.map((d) => ({ field: d.field, kind: d.kind })))
      .toEqual(r1.divergences.map((d) => ({ field: d.field, kind: d.kind })));

    // `sources` é a única saída que legitimamente segue a ordem de entrada
    expect(r1.sources).toEqual(['https://icy-veins.com/x', 'https://game8.co/x', 'https://genshin-builds.com/x']);
    expect(r2.sources).toEqual(['https://game8.co/x', 'https://icy-veins.com/x', 'https://genshin-builds.com/x']);
  });
});
