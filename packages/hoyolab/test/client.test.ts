import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { HoyolabClient, HoyolabError } from '../src/index.js';

const fx = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), 'utf8'));

const mockFetch = (map: Record<string, unknown>): typeof fetch =>
  (async (url: any) => {
    const key = Object.keys(map).find((k) => String(url).includes(k))!;
    return new Response(JSON.stringify(map[key]), { status: 200 });
  }) as any;

describe('HoyolabClient', () => {
  it('descobre role e detalha personagens', async () => {
    const c = new HoyolabClient({
      cookies: { ltoken_v2: 'x', ltuid_v2: '1' },
      fetch: mockFetch({
        getUserGameRolesByCookie: fx('roles'),
        'character/list': fx('list'),
        'character/detail': fx('detail'),
      }),
    });
    const all = await c.fetchAll();
    expect(all.account.region).toMatch(/^os_/);
    expect((all.detail as any).list.length).toBeGreaterThan(0);
    expect(all.account.gameUid).toBe('800000000');
    expect(all.account.nickname).toBe('Traveler');
    expect((all.list as any).list.length).toBe(2);
  });

  it('classifica retcode de sessão expirada', async () => {
    const c = new HoyolabClient({
      cookies: { ltoken_v2: 'x', ltuid_v2: '1' },
      fetch: (async () => new Response(JSON.stringify({ retcode: 10001, message: 'not logged in' }))) as any,
    });
    await expect(c.getGameRole()).rejects.toThrow(HoyolabError);
    try {
      await c.getGameRole();
      throw new Error('deveria ter lançado');
    } catch (err) {
      expect(err).toBeInstanceOf(HoyolabError);
      expect((err as HoyolabError).retcode).toBe('10001');
      expect((err as HoyolabError).kind).toBe('session');
    }
  });

  it('não estoura em corpo não-JSON (Method Not Allowed)', async () => {
    const c = new HoyolabClient({
      cookies: { ltoken_v2: 'x', ltuid_v2: '1' },
      fetch: (async () => new Response('Method Not Allowed', { status: 405 })) as any,
    });
    await expect(c.getGameRole()).rejects.toThrow(HoyolabError);
    try {
      await c.getGameRole();
      throw new Error('deveria ter lançado');
    } catch (err) {
      expect(err).toBeInstanceOf(HoyolabError);
      expect((err as HoyolabError).kind).toBe('unknown');
      // nunca deve incluir o cookie na mensagem de erro
      expect((err as HoyolabError).message).not.toMatch(/ltoken_v2=x/);
    }
  });

  it('classifica retcode de rate limit (10102/1034/-110)', async () => {
    for (const retcode of [10102, 1034, -110]) {
      const c = new HoyolabClient({
        cookies: { ltoken_v2: 'x', ltuid_v2: '1' },
        maxRetries: 0,
        fetch: (async () => new Response(JSON.stringify({ retcode, message: 'slow down' }))) as any,
      });
      await expect(c.getGameRole()).rejects.toMatchObject({ kind: 'ratelimit', retcode: String(retcode) });
    }
  });

  it('classifica retcode de chronicle não disponível (10104/1009)', async () => {
    for (const retcode of [10104, 1009]) {
      const c = new HoyolabClient({
        cookies: { ltoken_v2: 'x', ltuid_v2: '1' },
        fetch: (async () => new Response(JSON.stringify({ retcode, message: 'no chronicle' }))) as any,
      });
      await expect(c.getGameRole()).rejects.toMatchObject({ kind: 'no-chronicle', retcode: String(retcode) });
    }
  });

  it('envia por padrão Cookie apenas com ltoken_v2/ltuid_v2, x-rpc-language pt-pt e header DS (useDs default true)', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fetchSpy = (async (url: any, init: any) => {
      calls.push({ url: String(url), headers: { ...(init?.headers ?? {}) } });
      return new Response(JSON.stringify(fx('roles')), { status: 200 });
    }) as any;
    const c = new HoyolabClient({ cookies: { ltoken_v2: 'x', ltuid_v2: '1' }, fetch: fetchSpy });
    await c.getGameRole();
    expect(calls).toHaveLength(1);
    const { headers, url } = calls[0]!;
    expect(url).toContain('https://api-account-os.hoyolab.com/binding/api/getUserGameRolesByCookie');
    expect(url).toContain('game_biz=hk4e_global');
    expect(headers['Cookie']).toBe('ltoken_v2=x; ltuid_v2=1');
    expect(headers['x-rpc-language']).toBe('pt-pt');
    expect(headers['x-rpc-app_version']).toBe('1.5.0');
    expect(headers['x-rpc-client_type']).toBe('5');
    expect(headers['DS']).toBeDefined();
    expect(headers['DS']).toMatch(/^\d+,.+,[0-9a-f]{32}$/);
  });

  it('omite o header DS quando useDs:false', async () => {
    let seenHeaders: Record<string, string> = {};
    const fetchSpy = (async (_url: any, init: any) => {
      seenHeaders = { ...(init?.headers ?? {}) };
      return new Response(JSON.stringify(fx('roles')), { status: 200 });
    }) as any;
    const c = new HoyolabClient({ cookies: { ltoken_v2: 'x', ltuid_v2: '1' }, fetch: fetchSpy, useDs: false });
    await c.getGameRole();
    expect(seenHeaders['DS']).toBeUndefined();
  });

  it('lança HoyolabError no-chronicle quando não há conta hk4e_global vinculada', async () => {
    const c = new HoyolabClient({
      cookies: { ltoken_v2: 'x', ltuid_v2: '1' },
      fetch: (async () =>
        new Response(
          JSON.stringify({ retcode: 0, message: 'OK', data: { list: [{ game_biz: 'bh3_global', region: 'os_asia', game_uid: '1' }] } }),
        )) as any,
    });
    await expect(c.getGameRole()).rejects.toThrow(HoyolabError);
  });
});
