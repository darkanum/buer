import { describe, it, expect } from 'vitest';
import { canonBytes, contentHash } from '../src/canon.js';

const doc = {
  v: 1 as const, char: '10000089', lvl: 90, asc: 6, cons: 2, friend: 10,
  weapon: { id: 13509, lvl: 90, promote: 6, refine: 1 },
  talents: [[10097, 10], [10098, 9]] as [number, number][],
  artifacts: [],
};

describe('canon', () => {
  it('é determinística e independe da ordem das chaves de entrada', () => {
    const a = contentHash(doc);
    const shuffled = { artifacts: [], cons: 2, char: '10000089', v: 1 as const,
      weapon: { refine: 1, id: 13509, lvl: 90, promote: 6 },
      talents: [[10097,10],[10098,9]] as [number,number][], lvl: 90, asc: 6, friend: 10 };
    expect(contentHash(shuffled)).toBe(a);
  });
  it('não contém espaços nem chaves fora de ordem', () => {
    const s = new TextDecoder().decode(canonBytes(doc));
    expect(s).not.toMatch(/: /);
    expect(s.indexOf('"asc"')).toBeLessThan(s.indexOf('"char"'));
  });

  it('formata cada valor de substat na precisão da SUA property (plano=0 casas, % =1 casa)', () => {
    const withArtifact = {
      ...doc,
      artifacts: [{
        slot: 1 as const, set: 15025, lvl: 20, rarity: 5 as const,
        main: [2, 209] as [number, number], // 2 = flat HP (0 decimais)
        subs: [
          [2, 269, 3] as [number, number, 1|2|3|4],   // flat HP: inteiro
          [20, 6.6, 2] as [number, number, 1|2|3|4],  // critRate_: 1 casa
        ],
        fp: 'fp-test',
      }],
    };
    const s = new TextDecoder().decode(canonBytes(withArtifact));
    expect(s).toContain('"main":[2,209]'); // não "209.0"
    expect(s).toContain('[2,269,3]');      // não "269.0"
    expect(s).toContain('[20,6.6,2]');     // percentual mantém 1 casa
  });
});
