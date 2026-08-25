import { describe, it, expect } from 'vitest';
import { charKey, parseCharKey } from '../src/keys.js';

describe('charKey', () => {
  it('não-Traveler usa só o avatarId', () => {
    expect(charKey(10000089)).toBe('10000089');
  });
  it('Traveler exige elemento e compõe', () => {
    expect(charKey(10000005, 'pyro')).toBe('10000005:pyro');
    expect(charKey(10000007, 'electro')).toBe('10000007:electro');
  });
  it('Traveler sem elemento lança', () => {
    expect(() => charKey(10000005)).toThrow();
  });
  it('roundtrip', () => {
    expect(parseCharKey(charKey(10000005, 'geo'))).toEqual({ avatarId: 10000005, element: 'geo' });
    expect(parseCharKey(charKey(10000089))).toEqual({ avatarId: 10000089 });
  });
});
