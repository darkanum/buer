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

  it('nunca produz confidence high — isso exige humano', () => {
    const r = reconcileCharacter(three(
      { sets: ['x'], erThreshold: 200, substats: ['critRate_'] },
      { sets: ['x'], erThreshold: 200, substats: ['critRate_'] },
      { sets: ['x'], erThreshold: 200, substats: ['critRate_'] },
    ));
    expect(r.confidence).not.toBe('high');
  });
});
