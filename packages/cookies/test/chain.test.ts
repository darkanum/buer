import { describe, it, expect } from 'vitest';
import { PasteProvider } from '../src/paste.js';
import { getSession, NoSessionError } from '../src/chain.js';

describe('cadeia', () => {
  it('PasteProvider parseia a string de cookie', async () => {
    const s = await new PasteProvider('ltoken_v2=abc; ltuid_v2=42').tryGet();
    expect(s).toEqual({ ltoken_v2: 'abc', ltuid_v2: '42' });
  });
  it('usa o primeiro provider que resolve', async () => {
    const s = await getSession({
      providers: [
        { id: 'a', tryGet: async () => null },
        { id: 'b', tryGet: async () => ({ ltoken_v2: 'x', ltuid_v2: '1' }) },
      ],
    });
    expect(s.ltoken_v2).toBe('x');
  });
  it('lança mensagem acionável listando o que tentou', async () => {
    await expect(
      getSession({ providers: [{ id: 'firefox', tryGet: async () => null }] }),
    ).rejects.toThrow(/firefox/);
  });
});
