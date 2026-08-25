import { describe, it, expect } from 'vitest';
import type { Element } from '@buer/core';
import { reactionsFor, resonanceFor } from '../../src/team/rules.js';

const el = (...x: string[]) => x as Element[];

describe('reactionsFor', () => {
  it('pyro + hydro habilita vaporize', () => {
    const r = reactionsFor(el('pyro', 'hydro'));
    expect(r.find((x) => x.reaction === 'vaporize')?.satisfied).toBe(true);
  });

  it('pyro sozinho não habilita vaporize e nomeia o que falta', () => {
    const v = reactionsFor(el('pyro')).find((x) => x.reaction === 'vaporize')!;
    expect(v.satisfied).toBe(false);
    expect(v.missing).toContain('hydro');
  });

  it('anemo com qualquer elemento aplicável habilita swirl', () => {
    expect(reactionsFor(el('anemo', 'electro')).find((x) => x.reaction === 'swirl')?.satisfied).toBe(true);
    expect(reactionsFor(el('anemo', 'geo')).find((x) => x.reaction === 'swirl')?.satisfied).toBe(false);
  });

  it('hyperbloom exige dendro, hydro e electro juntos', () => {
    expect(reactionsFor(el('dendro', 'hydro')).find((x) => x.reaction === 'hyperbloom')?.satisfied).toBe(false);
    expect(reactionsFor(el('dendro', 'hydro', 'electro')).find((x) => x.reaction === 'hyperbloom')?.satisfied).toBe(true);
  });
});

describe('resonanceFor', () => {
  it('dois pyro dão ressonância de ATQ', () => {
    const r = resonanceFor(el('pyro', 'pyro', 'anemo', 'hydro'));
    expect(r).toHaveLength(1);
    expect(r[0]!.id).toBe('pyro');
    expect(r[0]!.stats?.atk_).toBe(25);
  });

  it('quatro elementos distintos não dão ressonância elemental', () => {
    expect(resonanceFor(el('pyro', 'hydro', 'cryo', 'electro'))).toHaveLength(0);
  });

  it('dois dendro dão maestria', () => {
    expect(resonanceFor(el('dendro', 'dendro'))[0]!.stats?.eleMas).toBe(50);
  });
});
