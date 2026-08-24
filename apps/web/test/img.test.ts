// Task 8.4 — GET /api/img/[hash]. Spec: docs/superpowers/specs/2026-08-24-onewash-design.md §4.2.
//
// Exercises handleImg's branching directly against injected ImgDeps (no R2,
// no real network — see route.ts's own header comment on why this is safe),
// plus one smoke test of the real GET wrapper for the "hash absent from the
// manifest" path, which never touches R2/fetch at all (see route.ts) and is
// therefore also runnable with zero R2 env vars set.

import { describe, expect, it, vi } from 'vitest';
import { GET } from '../app/api/img/[hash]/route.js';
import { handleImg, type ImgDeps, type ImgObject } from '../app/api/img/[hash]/handler.js';

const KNOWN_HASH = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef.png';
const SOURCE_URL = 'https://act-webstatic.hoyoverse.com/x/UI_AvatarIcon_Furina.png';
const BYTES = new Uint8Array([1, 2, 3, 4, 5]);
const CONTENT_TYPE = 'image/png';

/** Builds a fully-stubbed ImgDeps, overridable per test — every method
 * defaults to "should not be called" so a test only has to specify the
 * dependencies it actually expects to be exercised. */
function makeDeps(overrides: Partial<ImgDeps> = {}): ImgDeps {
  return {
    resolveSourceUrl: vi.fn(() => {
      throw new Error('resolveSourceUrl: not stubbed for this test');
    }),
    getObject: vi.fn(async () => {
      throw new Error('getObject: not stubbed for this test');
    }),
    putObject: vi.fn(async () => {
      throw new Error('putObject: not stubbed for this test');
    }),
    fetchImpl: vi.fn(async () => {
      throw new Error('fetchImpl: not stubbed for this test');
    }),
    ...overrides,
  };
}

function fakeFetchResponse(body: Uint8Array, ok: boolean, contentType?: string): Response {
  const headers = new Headers();
  if (contentType) headers.set('content-type', contentType);
  // See route.ts's imageResponse() comment: re-wrap to the concrete
  // `Uint8Array<ArrayBuffer>` generic BodyInit requires.
  return new Response(new Uint8Array(body), { status: ok ? 200 : 500, headers });
}

describe('GET /api/img/[hash]', () => {
  it('404 para hash desconhecido (wrapper real, sem tocar R2/fetch)', async () => {
    const res = await GET(new Request('http://x'), { params: Promise.resolve({ hash: 'nope' }) });
    expect(res.status).toBe(404);
  });

  it('404 via handleImg quando resolveSourceUrl não conhece o hash', async () => {
    const deps = makeDeps({ resolveSourceUrl: vi.fn(() => undefined) });
    const res = await handleImg(deps, 'nope.png');
    expect(res.status).toBe(404);
    expect(deps.getObject).not.toHaveBeenCalled();
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });

  it('serve com cache immutable quando o objeto já existe em R2', async () => {
    const getObject = vi.fn(async (key: string): Promise<ImgObject | null> => {
      expect(key).toBe(KNOWN_HASH);
      return { body: BYTES, contentType: CONTENT_TYPE };
    });
    const deps = makeDeps({
      resolveSourceUrl: vi.fn(() => SOURCE_URL),
      getObject,
    });

    const res = await handleImg(deps, KNOWN_HASH);

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect(res.headers.get('content-type')).toBe(CONTENT_TYPE);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(BYTES);
    // Cache hit — no need to ever touch the source URL or write to R2.
    expect(deps.fetchImpl).not.toHaveBeenCalled();
    expect(deps.putObject).not.toHaveBeenCalled();
  });

  it('espelho preguiçoso: ausente em R2 -> busca do CDN, sobe ao R2, serve immutable', async () => {
    const putObject = vi.fn(async (_key: string, _body: Uint8Array, _contentType: string | undefined) => {});
    const deps = makeDeps({
      resolveSourceUrl: vi.fn((hash: string) => (hash === KNOWN_HASH ? SOURCE_URL : undefined)),
      getObject: vi.fn(async () => null), // cache miss
      fetchImpl: vi.fn(async (url: string | URL | Request) => {
        expect(String(url)).toBe(SOURCE_URL);
        return fakeFetchResponse(BYTES, true, CONTENT_TYPE);
      }),
      putObject,
    });

    const res = await handleImg(deps, KNOWN_HASH);

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(BYTES);
    // The mirror actually happened.
    expect(putObject).toHaveBeenCalledTimes(1);
    expect(putObject).toHaveBeenCalledWith(KNOWN_HASH, expect.anything(), CONTENT_TYPE);
    const putBody = putObject.mock.calls[0]?.[1] as Uint8Array;
    expect(new Uint8Array(putBody)).toEqual(BYTES);
  });

  it('502 quando a leitura do R2 falha (não deixa escapar um throw)', async () => {
    const deps = makeDeps({
      resolveSourceUrl: vi.fn(() => SOURCE_URL),
      getObject: vi.fn(async () => {
        throw new Error('boom: R2 indisponível');
      }),
    });

    const res = await handleImg(deps, KNOWN_HASH);
    expect(res.status).toBe(502);
  });

  it('502 quando o fetch no CDN de origem falha', async () => {
    const deps = makeDeps({
      resolveSourceUrl: vi.fn(() => SOURCE_URL),
      getObject: vi.fn(async () => null),
      fetchImpl: vi.fn(async () => {
        throw new TypeError('network error');
      }),
    });

    const res = await handleImg(deps, KNOWN_HASH);
    expect(res.status).toBe(502);
  });

  it('502 quando o CDN de origem responde com erro HTTP', async () => {
    const deps = makeDeps({
      resolveSourceUrl: vi.fn(() => SOURCE_URL),
      getObject: vi.fn(async () => null),
      fetchImpl: vi.fn(async () => fakeFetchResponse(new Uint8Array(), false)),
    });

    const res = await handleImg(deps, KNOWN_HASH);
    expect(res.status).toBe(502);
  });

  it('ainda serve os bytes buscados mesmo se a escrita no R2 (espelho) falhar', async () => {
    const deps = makeDeps({
      resolveSourceUrl: vi.fn(() => SOURCE_URL),
      getObject: vi.fn(async () => null),
      fetchImpl: vi.fn(async () => fakeFetchResponse(BYTES, true, CONTENT_TYPE)),
      putObject: vi.fn(async () => {
        throw new Error('boom: R2 indisponível para escrita');
      }),
    });

    const res = await handleImg(deps, KNOWN_HASH);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(BYTES);
  });

  it('502 quando a leitura do corpo da resposta falha após um 200 ok (stream abortado/truncado)', async () => {
    // A REAL Response body can only be read once — reading it here up front
    // (deliberately, before handleImg ever sees it) makes fetched.arrayBuffer()
    // inside handleImg reject for real (a genuine "body stream already
    // used/aborted" failure), rather than simulating one with a fake object.
    // ok stays true: this is exactly the "`fetchImpl` resolved fine, the
    // BODY read is what fails" case — distinct from both the reject and
    // !ok branches already covered above.
    const alreadyConsumedResponse = fakeFetchResponse(BYTES, true, CONTENT_TYPE);
    await alreadyConsumedResponse.arrayBuffer();

    const deps = makeDeps({
      resolveSourceUrl: vi.fn(() => SOURCE_URL),
      getObject: vi.fn(async () => null),
      fetchImpl: vi.fn(async () => alreadyConsumedResponse),
    });

    const res = await handleImg(deps, KNOWN_HASH);
    expect(res.status).toBe(502);
  });
});
