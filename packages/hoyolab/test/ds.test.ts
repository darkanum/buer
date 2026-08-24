import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { ds1, DS_SALT } from '../src/ds.js';

describe('ds1', () => {
  it('bate com o md5 esperado para (t,r) fixos', () => {
    const t = 1700000000, r = '123456';
    const expected = createHash('md5').update(`salt=${DS_SALT}&t=${t}&r=${r}`).digest('hex');
    expect(ds1(t, r)).toBe(`${t},${r},${expected}`);
  });
});
