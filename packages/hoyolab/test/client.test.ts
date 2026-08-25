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

  it('envia os bodies corretos (role_id/server/sort_type e role_id/server/character_ids) e encadeia os ids de listCharacters até characterDetail via fetchAll', async () => {
    const calls: { url: string; reqBody: string | undefined; resPayload: unknown }[] = [];
    const responses: Record<string, unknown> = {
      getUserGameRolesByCookie: fx('roles'),
      'character/list': fx('list'),
      'character/detail': fx('detail'),
    };
    const recordingFetch = (async (url: any, init: any) => {
      const key = Object.keys(responses).find((k) => String(url).includes(k))!;
      const resPayload = responses[key];
      calls.push({ url: String(url), reqBody: init?.body, resPayload });
      return new Response(JSON.stringify(resPayload), { status: 200 });
    }) as any;

    const c = new HoyolabClient({ cookies: { ltoken_v2: 'x', ltuid_v2: '1' }, fetch: recordingFetch });
    await c.fetchAll();

    const listCall = calls.find((call) => call.url.includes('character/list'));
    const detailCall = calls.find((call) => call.url.includes('character/detail'));
    expect(listCall).toBeDefined();
    expect(detailCall).toBeDefined();

    const listReqBody = JSON.parse(listCall!.reqBody as string);
    expect(listReqBody).toEqual({ role_id: '800000000', server: 'os_asia', sort_type: 1 });

    // Deriva os ids esperados da RESPOSTA gravada de character/list (não de um literal
    // hardcoded [10000089, 10000046]) — se o encadeamento listCharacters() ->
    // characterDetail() quebrar (ids errados, reordenados, ou hardcoded no cliente), os
    // dois lados divergem e o teste falha. A resposta gravada é exatamente o que o mock
    // devolveu para a chamada de character/list — não uma cópia paralela do fixture.
    const listResponsePayload = listCall!.resPayload as { data: { list: Array<{ id: number }> } };
    const expectedIds = listResponsePayload.data.list.map((char) => char.id);

    const detailReqBody = JSON.parse(detailCall!.reqBody as string);
    expect(detailReqBody.role_id).toBe('800000000');
    expect(detailReqBody.server).toBe('os_asia');
    expect(detailReqBody.character_ids).toEqual(expectedIds);
  });
});

// ---------------------------------------------------------------------------
// Seleção de conta (multi-conta) — `roles-multi` tem DUAS contas Genshin
// hk4e_global: uid=700000001/os_asia ("Alt") e uid=800000000/os_usa
// ("Traveler"), imitando uma conta HoYoLAB real com um alt em os_asia e a
// conta principal em os_usa (o bug original: getGameRole() pegava sempre a
// primeira, o alt vazio, em vez da conta que o usuário queria).
// ---------------------------------------------------------------------------
describe('HoyolabClient — seleção de conta (multi-conta)', () => {
  it('sem seletor + múltiplas contas: getGameRole lança listando as duas contas', async () => {
    const c = new HoyolabClient({
      cookies: { ltoken_v2: 'x', ltuid_v2: '1' },
      fetch: mockFetch({ getUserGameRolesByCookie: fx('roles-multi') }),
    });
    await expect(c.getGameRole()).rejects.toThrow(HoyolabError);
    try {
      await c.getGameRole();
      throw new Error('deveria ter lançado');
    } catch (err) {
      expect(err).toBeInstanceOf(HoyolabError);
      const e = err as HoyolabError;
      expect(e.kind).toBe('multiple-accounts');
      expect(e.message).toContain('uid=700000001');
      expect(e.message).toContain('os_asia');
      expect(e.message).toContain('uid=800000000');
      expect(e.message).toContain('os_usa');
      // nunca deve incluir o cookie na mensagem de erro
      expect(e.message).not.toMatch(/ltoken_v2=x/);
    }
  });

  it('--region os_usa seleciona a conta os_usa (encadeada até os bodies de list/detail)', async () => {
    const calls: { url: string; reqBody: string | undefined }[] = [];
    const responses: Record<string, unknown> = {
      getUserGameRolesByCookie: fx('roles-multi'),
      'character/list': fx('list'),
      'character/detail': fx('detail'),
    };
    const recordingFetch = (async (url: any, init: any) => {
      const key = Object.keys(responses).find((k) => String(url).includes(k))!;
      calls.push({ url: String(url), reqBody: init?.body });
      return new Response(JSON.stringify(responses[key]), { status: 200 });
    }) as any;

    const c = new HoyolabClient({ cookies: { ltoken_v2: 'x', ltuid_v2: '1' }, fetch: recordingFetch });
    const role = await c.getGameRole({ region: 'os_usa' });
    expect(role).toEqual({ gameUid: '800000000', region: 'os_usa', nickname: 'Traveler' });

    const all = await c.fetchAll({ region: 'os_usa' });
    expect(all.account.gameUid).toBe('800000000');
    expect(all.account.region).toBe('os_usa');

    const listCall = calls.find((call) => call.url.includes('character/list'));
    const detailCall = calls.find((call) => call.url.includes('character/detail'));
    expect(JSON.parse(listCall!.reqBody as string)).toMatchObject({ role_id: '800000000', server: 'os_usa' });
    expect(JSON.parse(detailCall!.reqBody as string)).toMatchObject({ role_id: '800000000', server: 'os_usa' });
  });

  it('--uid 700000001 seleciona a conta os_asia (o alt), mesmo havendo uma conta os_usa', async () => {
    const calls: { url: string; reqBody: string | undefined }[] = [];
    const responses: Record<string, unknown> = {
      getUserGameRolesByCookie: fx('roles-multi'),
      'character/list': fx('list'),
      'character/detail': fx('detail'),
    };
    const recordingFetch = (async (url: any, init: any) => {
      const key = Object.keys(responses).find((k) => String(url).includes(k))!;
      calls.push({ url: String(url), reqBody: init?.body });
      return new Response(JSON.stringify(responses[key]), { status: 200 });
    }) as any;

    const c = new HoyolabClient({ cookies: { ltoken_v2: 'x', ltuid_v2: '1' }, fetch: recordingFetch });
    const role = await c.getGameRole({ uid: '700000001' });
    expect(role).toEqual({ gameUid: '700000001', region: 'os_asia', nickname: 'Alt' });

    const all = await c.fetchAll({ uid: '700000001' });
    expect(all.account.gameUid).toBe('700000001');
    expect(all.account.region).toBe('os_asia');

    const listCall = calls.find((call) => call.url.includes('character/list'));
    expect(JSON.parse(listCall!.reqBody as string)).toMatchObject({ role_id: '700000001', server: 'os_asia' });
  });

  it('--uid inexistente lança HoyolabError listando as contas disponíveis', async () => {
    const c = new HoyolabClient({
      cookies: { ltoken_v2: 'x', ltuid_v2: '1' },
      fetch: mockFetch({ getUserGameRolesByCookie: fx('roles-multi') }),
    });
    await expect(c.getGameRole({ uid: '999' })).rejects.toMatchObject({ kind: 'multiple-accounts' });
    try {
      await c.getGameRole({ uid: '999' });
      throw new Error('deveria ter lançado');
    } catch (err) {
      const e = err as HoyolabError;
      expect(e.message).toContain('uid=700000001');
      expect(e.message).toContain('uid=800000000');
    }
  });

  it('--region sem correspondência lança HoyolabError listando as contas disponíveis', async () => {
    const c = new HoyolabClient({
      cookies: { ltoken_v2: 'x', ltuid_v2: '1' },
      fetch: mockFetch({ getUserGameRolesByCookie: fx('roles-multi') }),
    });
    await expect(c.getGameRole({ region: 'os_euro' })).rejects.toMatchObject({ kind: 'multiple-accounts' });
  });

  it('--region com múltiplas contas na mesma região lança pedindo --uid', async () => {
    const c = new HoyolabClient({
      cookies: { ltoken_v2: 'x', ltuid_v2: '1' },
      fetch: (async () =>
        new Response(
          JSON.stringify({
            retcode: 0,
            message: 'OK',
            data: {
              list: [
                { game_biz: 'hk4e_global', region: 'os_asia', game_uid: '700000001', nickname: 'Alt' },
                { game_biz: 'hk4e_global', region: 'os_asia', game_uid: '700000002', nickname: 'Alt2' },
              ],
            },
          }),
        )) as any,
    });
    await expect(c.getGameRole({ region: 'os_asia' })).rejects.toMatchObject({ kind: 'multiple-accounts' });
    try {
      await c.getGameRole({ region: 'os_asia' });
      throw new Error('deveria ter lançado');
    } catch (err) {
      const e = err as HoyolabError;
      expect(e.message).toContain('--uid');
      expect(e.message).toContain('uid=700000001');
      expect(e.message).toContain('uid=700000002');
    }
  });

  it('conta única + sem seletor: continua funcionando (usa a única conta)', async () => {
    const c = new HoyolabClient({
      cookies: { ltoken_v2: 'x', ltuid_v2: '1' },
      fetch: mockFetch({ getUserGameRolesByCookie: fx('roles') }),
    });
    const role = await c.getGameRole();
    expect(role).toEqual({ gameUid: '800000000', region: 'os_asia', nickname: 'Traveler' });
  });

  it('listGameRoles() devolve todas as contas Genshin vinculadas ao cookie', async () => {
    const c = new HoyolabClient({
      cookies: { ltoken_v2: 'x', ltuid_v2: '1' },
      fetch: mockFetch({ getUserGameRolesByCookie: fx('roles-multi') }),
    });
    const roles = await c.listGameRoles();
    expect(roles).toEqual([
      { gameUid: '700000001', region: 'os_asia', nickname: 'Alt' },
      { gameUid: '800000000', region: 'os_usa', nickname: 'Traveler' },
    ]);
  });
});
