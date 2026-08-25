import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { FirefoxProvider } from '../src/firefox.js';

// fileURLToPath (not URL#pathname) so this resolves to a real, OS-native
// path on Windows too (pathname keeps a leading "/" before the drive
// letter, which node:fs does not accept).
const FIXTURES_DIR = fileURLToPath(new URL('./fixtures/', import.meta.url));

describe('FirefoxProvider', () => {
  it('extrai ltoken_v2 e ltuid_v2 do cookies.sqlite', async () => {
    const p = new FirefoxProvider({ profilePath: FIXTURES_DIR });
    const s = await p.tryGet();
    expect(s?.ltoken_v2).toBeTruthy();
    expect(s?.ltuid_v2).toBeTruthy();
  });

  it('extrai exatamente os valores sintéticos da fixture (e ignora cookies não-HoYoLAB)', async () => {
    const p = new FirefoxProvider({ profilePath: FIXTURES_DIR });
    const s = await p.tryGet();
    expect(s).toEqual({ ltoken_v2: 'faketoken', ltuid_v2: '42' });
  });

  it('devolve null quando o profile não existe', async () => {
    const p = new FirefoxProvider({ profilePath: '/caminho/inexistente' });
    expect(await p.tryGet()).toBeNull();
  });

  it('não deixa nenhum arquivo temporário de cópia para trás', async () => {
    const { readdirSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const before = readdirSync(tmpdir()).filter((f) => f.startsWith('ow-'));
    const p = new FirefoxProvider({ profilePath: FIXTURES_DIR });
    await p.tryGet();
    const after = readdirSync(tmpdir()).filter((f) => f.startsWith('ow-'));
    expect(after.length).toBe(before.length);
  });
});
