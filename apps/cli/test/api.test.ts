import { describe, it, expect } from 'vitest';
import type { IngestEnvelope } from '@onewash/core';
import { postIngest } from '../src/api.js';

const env = {
  protocolVersion: 1,
  cliVersion: '0.0.0',
  takenAt: new Date().toISOString(),
  account: { gameUid: '1', region: 'os_asia', nickname: null, lang: 'pt-pt' },
  raw: { list: {}, detail: {} },
} as unknown as IngestEnvelope;

describe('postIngest', () => {
  it('envia POST /api/ingest com o token no header e devolve changedChars', async () => {
    let seenUrl = '';
    let seenInit: RequestInit | undefined;
    const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
      seenUrl = String(url);
      seenInit = init;
      return new Response(JSON.stringify({ changedChars: 5 }), { status: 200 });
    }) as unknown as typeof fetch;

    const r = await postIngest(env, 'ow_live_test', 'http://x', { fetch: fakeFetch });

    expect(r.changedChars).toBe(5);
    expect(seenUrl).toBe('http://x/api/ingest');
    const headers = seenInit?.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('ow_live_test');
    expect(headers.authorization).toBe('Bearer ow_live_test');
    expect(seenInit?.body).toBe(JSON.stringify(env));
  });

  it('normaliza baseUrl com barra final', async () => {
    let seenUrl = '';
    const fakeFetch = (async (url: string | URL) => {
      seenUrl = String(url);
      return new Response(JSON.stringify({ changedChars: 0 }), { status: 200 });
    }) as unknown as typeof fetch;

    await postIngest(env, 't', 'http://x/', { fetch: fakeFetch });
    expect(seenUrl).toBe('http://x/api/ingest');
  });

  it('lança ApiError descritivo em falha HTTP, sem vazar o token', async () => {
    const fakeFetch = (async () => new Response('boom', { status: 500 })) as unknown as typeof fetch;
    await expect(postIngest(env, 'ow_live_test', 'http://x', { fetch: fakeFetch })).rejects.toThrow(/HTTP 500/);
  });

  it('lança ApiError em falha de transporte (rede)', async () => {
    const fakeFetch = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    await expect(postIngest(env, 'ow_live_test', 'http://x', { fetch: fakeFetch })).rejects.toThrow(/ECONNREFUSED/);
  });
});
