import { describe, it, expect, vi, afterEach, afterAll } from 'vitest';
import { sessionFromStorageState, EmbeddedProvider } from '../src/embedded.js';
import { EmbeddedProvider as EmbeddedProviderFromBarrel, sessionFromStorageState as sessionFromStorageStateFromBarrel } from '../src/index.js';

describe('exports pelo ponto de entrada do pacote (src/index.ts)', () => {
  it('EmbeddedProvider é reexportado e instanciável a partir do barrel', () => {
    expect(EmbeddedProviderFromBarrel).toBe(EmbeddedProvider);
    const p = new EmbeddedProviderFromBarrel();
    expect(p.id).toBe('embedded');
  });

  it('sessionFromStorageState é reexportado e é a mesma função', () => {
    expect(sessionFromStorageStateFromBarrel).toBe(sessionFromStorageState);
  });
});

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

describe('EmbeddedProvider.tryGet() nunca lança', () => {
  // tryGet() deliberately logs a console.warn on every failure path (so a
  // human running the CLI sees *why* the provider came back empty) — spy
  // on it so these tests can assert the note was logged without leaking
  // that expected stderr output into the test run's own output.
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

  afterEach(() => {
    warn.mockClear();
  });

  afterAll(() => {
    warn.mockRestore();
  });

  it('devolve null (não rejeita) quando playwright não está instalado (loadChromium rejeita)', async () => {
    const p = new EmbeddedProvider({
      loadChromium: async () => {
        throw new Error('Cannot find module "playwright"');
      },
    });
    await expect(p.tryGet()).resolves.toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/playwright não está instalado/);
  });

  it('devolve null (não rejeita) quando chromium.launch() falha — caso real: playwright instalado mas o binário do Chromium não foi baixado', async () => {
    const p = new EmbeddedProvider({
      loadChromium: async () => ({
        launch: async () => {
          throw new Error("Executable doesn't exist at .../chromium-1234/chrome.exe");
        },
      }),
    });
    await expect(p.tryGet()).resolves.toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/falha ao abrir\/usar o navegador embutido/);
  });

  it('devolve null (não rejeita) quando a automação falha após um launch() bem-sucedido (ex.: goto() rejeita)', async () => {
    let contextClosed = false;
    let browserClosed = false;
    const p = new EmbeddedProvider({
      loadChromium: async () => ({
        launch: async () => ({
          newContext: async () => ({
            newPage: async () => ({
              goto: async () => {
                throw new Error('net::ERR_CONNECTION_REFUSED');
              },
            }),
            storageState: async () => ({ cookies: [] }),
            close: async () => {
              contextClosed = true;
            },
          }),
          close: async () => {
            browserClosed = true;
          },
        }),
      }),
    });
    await expect(p.tryGet()).resolves.toBeNull();
    // Cleanup still ran even though the automation step failed.
    expect(contextClosed).toBe(true);
    expect(browserClosed).toBe(true);
  });
});
