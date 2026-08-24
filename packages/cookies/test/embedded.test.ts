import { describe, it, expect } from 'vitest';
import { sessionFromStorageState } from '../src/embedded.js';

describe('sessionFromStorageState', () => {
  it('extrai os cookies do formato do Playwright', () => {
    const state = {
      cookies: [
        { name: 'ltoken_v2', value: 'tok', domain: '.hoyolab.com' },
        { name: 'ltuid_v2', value: '7', domain: '.hoyolab.com' },
        { name: 'other', value: 'z', domain: '.hoyolab.com' },
      ],
    };
    expect(sessionFromStorageState(state)).toEqual({ ltoken_v2: 'tok', ltuid_v2: '7' });
  });

  it('ignora cookies extras e não relacionados', () => {
    const state = {
      cookies: [
        { name: 'unrelated_a', value: '1', domain: '.hoyolab.com' },
        { name: 'ltoken_v2', value: 'tok2', domain: '.hoyolab.com' },
        { name: 'unrelated_b', value: '2', domain: 'account.hoyolab.com' },
        { name: 'ltuid_v2', value: '99', domain: '.hoyolab.com' },
      ],
    };
    expect(sessionFromStorageState(state)).toEqual({ ltoken_v2: 'tok2', ltuid_v2: '99' });
  });

  it('devolve null quando falta ltoken_v2 ou ltuid_v2', () => {
    expect(sessionFromStorageState({ cookies: [{ name: 'ltuid_v2', value: '7', domain: '.hoyolab.com' }] })).toBeNull();
    expect(sessionFromStorageState({ cookies: [{ name: 'ltoken_v2', value: 'tok', domain: '.hoyolab.com' }] })).toBeNull();
    expect(sessionFromStorageState({ cookies: [] })).toBeNull();
  });
});
