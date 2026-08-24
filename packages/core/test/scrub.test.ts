import { describe, it, expect } from 'vitest';
import { scrubRaw } from '../src/scrub.js';

describe('scrubRaw', () => {
  it('anonimiza uid e nickname em qualquer profundidade', () => {
    const dirty = { data: { role_id: '812345678', nickname: 'RealName', list: [{ level: 90 }] } };
    const clean = scrubRaw(dirty) as any;
    expect(clean.data.role_id).toBe('800000000');
    expect(clean.data.nickname).toBe('Traveler');
    expect(clean.data.list[0].level).toBe(90); // dado de jogo intacto
  });
  it('remove qualquer resquício de cookie', () => {
    const clean = JSON.stringify(scrubRaw({ ltoken_v2: 'v2_secret', ltuid_v2: '999' }));
    expect(clean).not.toContain('v2_secret');
    expect(clean).not.toContain('999');
  });
  it('é idempotente', () => {
    const once = scrubRaw({ nickname: 'A' });
    expect(scrubRaw(once)).toEqual(once);
  });
});
