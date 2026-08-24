import { describe, it, expect } from 'vitest';
import { PasteProvider, EmbeddedProvider, FirefoxProvider } from '@buer/cookies';
import { buildProviders } from '../src/commands/sync.js';

// `resolveFirefoxProfileDir` is stubbed in every case below so this test
// never touches the host filesystem / a real Firefox install — it's the
// injectable seam `buildProviders` grew specifically for this.

describe('buildProviders', () => {
  it('--cookie inclui PasteProvider, e ele vem primeiro (prioridade sobre os demais)', () => {
    const providers = buildProviders(
      { cookie: 'ltoken_v2=abc; ltuid_v2=42', login: true },
      { resolveFirefoxProfileDir: () => '/fake/profile' },
    );
    expect(providers[0]).toBeInstanceOf(PasteProvider);
    expect(providers.map((p) => p.id)).toEqual(['paste', 'embedded', 'firefox']);
  });

  it('--login inclui EmbeddedProvider na cadeia', () => {
    const providers = buildProviders({ login: true }, { resolveFirefoxProfileDir: () => null });
    expect(providers.some((p) => p instanceof EmbeddedProvider)).toBe(true);
    expect(providers.map((p) => p.id)).toEqual(['embedded']);
  });

  it('sem flags: FirefoxProvider entra quando um perfil padrão é resolvido', () => {
    const providers = buildProviders({}, { resolveFirefoxProfileDir: () => '/fake/profile' });
    expect(providers).toHaveLength(1);
    expect(providers[0]).toBeInstanceOf(FirefoxProvider);
    expect(providers.map((p) => p.id)).toEqual(['firefox']);
  });

  it('sem flags e sem perfil resolvido: FirefoxProvider fica de fora (cadeia vazia)', () => {
    const providers = buildProviders({}, { resolveFirefoxProfileDir: () => null });
    expect(providers).toEqual([]);
  });

  it('--browser diferente de "firefox" lança erro (só firefox é suportado nesta fase)', () => {
    expect(() => buildProviders({ browser: 'chrome' }, { resolveFirefoxProfileDir: () => null })).toThrow(
      /não suportado/,
    );
  });

  it('--browser "firefox" explícito não lança e segue o fluxo normal', () => {
    expect(() =>
      buildProviders({ browser: 'firefox' }, { resolveFirefoxProfileDir: () => null }),
    ).not.toThrow();
  });
});
