// Task 8.4 — GET /api/img/[hash]: lazy mirror of third-party (HoYoLAB/Enka
// CDN) images into Cloudflare R2, served with an immutable Cache-Control.
// Spec: docs/superpowers/specs/2026-08-24-onewash-design.md §4.2.
//
// §4.2's `assets:sync` script (packages/gi-data/scripts/assets-sync.ts)
// mirrors the ~350 known assets UP FRONT and records `originalUrl ->
// assetKey` in packages/gi-data/data/assets.json (read here via
// `loadAssetManifest()` — see @onewash/gi-data's src/index.ts). This route
// is the request-time complement: a hash is only ever "known" if it's a
// VALUE somewhere in that manifest (i.e. some source URL really does hash to
// it — assetKey() itself, packages/gi-data/src/assets.ts, is what produced
// that value; this route never recomputes it, only reverses the mapping).
// A hash that isn't in the manifest at all is unconditionally 404 — R2 is
// never even queried for it. A hash that IS known but hasn't been uploaded
// yet (assets:sync hasn't run against live R2 credentials, or a genuinely
// new asset the batch job hasn't seen) is mirrored lazily on first request:
// fetch the bytes from the recorded source URL, PUT them to R2 with the
// immutable Cache-Control, then serve. Every subsequent request for that
// same hash hits the "already in R2" branch instead.
//
// The whole thing is built as `handleImg(deps, hash)` over an explicit
// `ImgDeps` seam (R2 get/put + the manifest lookup + fetch), with a thin
// `GET` wrapper (./route.ts) that supplies the real R2-backed implementation
// — same shape as app/api/ingest/handler.ts's `handleIngest`/`IngestDeps` —
// so test/img.test.ts exercises the real branching logic against injected
// stubs, with no network access and no live R2 credentials required.
//
// This logic lives in its own module (not route.ts) because a Next.js
// `route.ts` may only export the whitelisted route-handler names
// (GET/POST/config/runtime/...) — any other export fails `next build`'s
// generated route-type check (TS2344 in .next/types/app/**/route.ts).

import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { loadAssetManifest } from '@onewash/gi-data';

/** Matches §4.2's `Cache-Control: public, max-age=31536000, immutable` —
 * applied both when serving an object already in R2 and right after this
 * route mirrors one into it for the first time. */
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

// ---------------------------------------------------------------------------
// Manifest reverse lookup — hash (assetKey) -> original source URL.
// ---------------------------------------------------------------------------
//
// loadAssetManifest() (from @onewash/gi-data) returns `{}`, never throws,
// when packages/gi-data/data/assets.json doesn't exist yet — the normal
// state until assets:sync has actually run against live R2 credentials
// (never the case in dev/CI/Fase 1, per that function's own doc comment).
// Every hash is then simply "unknown" and this route 404s, which is the
// correct behavior for a sparse/empty manifest, not a bug to work around.

const ASSET_MANIFEST = loadAssetManifest();

/** Reverses ASSET_MANIFEST (originalUrl -> hash) into (hash -> originalUrl).
 * Built once at module load, same lifetime as ASSET_MANIFEST itself. */
const SOURCE_URL_BY_HASH: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(ASSET_MANIFEST).map(([url, hash]) => [hash, url]),
);

function resolveSourceUrlFromManifest(hash: string): string | undefined {
  return SOURCE_URL_BY_HASH[hash];
}

// ---------------------------------------------------------------------------
// Injectable dependencies
// ---------------------------------------------------------------------------

export interface ImgObject {
  readonly body: Uint8Array;
  readonly contentType?: string;
}

export interface ImgDeps {
  /** hash -> original CDN URL, or `undefined` if this hash isn't a value
   * anywhere in the assets manifest (i.e. genuinely unknown). */
  resolveSourceUrl(hash: string): string | undefined;
  /** Reads an object from R2 by key. Resolves `null` when absent — that is
   * the expected "not yet mirrored" case, not an error. Rejects only on a
   * genuine R2/network failure. */
  getObject(key: string): Promise<ImgObject | null>;
  /** Uploads bytes to R2 under `key` with the immutable Cache-Control. */
  putObject(key: string, body: Uint8Array, contentType: string | undefined): Promise<void>;
  /** Injectable `fetch` — the global one in production, a stub in tests. */
  fetchImpl: typeof fetch;
}

// ---------------------------------------------------------------------------
// The handler — pure branching logic over ImgDeps, no direct R2/network I/O.
// ---------------------------------------------------------------------------

/**
 * 1. Unknown hash (not a value in the manifest) -> 404, R2/fetch untouched.
 * 2. Known hash already in R2 -> served immediately with immutable caching.
 * 3. Known hash NOT yet in R2 -> lazy mirror: fetch from the source URL, PUT
 *    to R2, then serve (also immutable).
 * 4. A genuine R2 read failure, upstream fetch rejection/non-ok response, OR
 *    a failure while reading the fetch response's body (aborted/truncated/
 *    decode-error mid-stream, even after a 200 `ok` response) is reported
 *    as 502 — never an uncaught throw. A failed MIRROR WRITE (putObject,
 *    step 3) is logged but does not fail the response: the bytes were
 *    already fetched successfully, so the user gets them; the next request
 *    for the same hash just retries the (idempotent, content-addressed)
 *    mirror.
 */
export async function handleImg(deps: ImgDeps, hash: string): Promise<Response> {
  const sourceUrl = deps.resolveSourceUrl(hash);
  if (!sourceUrl) {
    return new Response('not found', { status: 404 });
  }

  let existing: ImgObject | null;
  try {
    existing = await deps.getObject(hash);
  } catch (err) {
    console.error(`GET /api/img/${hash}: falha ao ler do R2`, err);
    return new Response('bad gateway', { status: 502 });
  }
  if (existing) {
    return imageResponse(existing.body, existing.contentType);
  }

  // Lazy mirror: known hash, cache miss in R2.
  let fetched: Response;
  try {
    fetched = await deps.fetchImpl(sourceUrl);
  } catch (err) {
    console.error(`GET /api/img/${hash}: falha ao buscar ${sourceUrl}`, err);
    return new Response('bad gateway', { status: 502 });
  }
  if (!fetched.ok) {
    console.error(`GET /api/img/${hash}: upstream ${sourceUrl} respondeu HTTP ${fetched.status}`);
    return new Response('bad gateway', { status: 502 });
  }

  // A response that resolved with `ok: true` can still fail while its body
  // is actually read (aborted/truncated/decode-error mid-stream) — a real
  // fetch failure mode distinct from the reject/`!ok` cases above, and one
  // that must NOT be allowed to throw out of handleImg either.
  let body: Uint8Array;
  let contentType: string | undefined;
  try {
    body = new Uint8Array(await fetched.arrayBuffer());
    contentType = fetched.headers.get('content-type') ?? undefined;
  } catch (err) {
    console.error(`GET /api/img/${hash}: falha ao ler o corpo da resposta de ${sourceUrl}`, err);
    return new Response('bad gateway', { status: 502 });
  }

  try {
    await deps.putObject(hash, body, contentType);
  } catch (err) {
    console.error(`GET /api/img/${hash}: falha ao espelhar para R2 (servindo mesmo assim)`, err);
  }

  return imageResponse(body, contentType);
}

function imageResponse(body: Uint8Array, contentType: string | undefined): Response {
  const headers = new Headers({ 'Cache-Control': IMMUTABLE_CACHE_CONTROL });
  if (contentType) headers.set('Content-Type', contentType);
  // `body` (an ImgObject/deps-supplied Uint8Array — from R2's SdkStreamMixin,
  // a source fetch's arrayBuffer(), or a test stub) is typed with the
  // generic `Uint8Array<ArrayBufferLike>` default. `Response`'s `BodyInit`
  // requires the narrower `Uint8Array<ArrayBuffer>` (DOM's `BufferSource` is
  // parameterized over concrete `ArrayBuffer`, not `SharedArrayBuffer`) —
  // re-wrapping normalizes to that concrete generic instead of casting past
  // the type checker.
  return new Response(new Uint8Array(body), { status: 200, headers });
}

// ---------------------------------------------------------------------------
// Production R2 client — env-configured (R2_ENDPOINT/R2_BUCKET/
// R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY), never hardcoded, same shape as
// packages/gi-data/scripts/assets-sync.ts's loadR2ConfigFromEnv/makeClient.
// Built LAZILY (only inside productionGetObject/productionPutObject, never
// at module import time) so importing this module — as test/img.test.ts does,
// to reach handleImg/ImgDeps — never requires those env vars to be set, and
// a request for a hash that isn't in the manifest (the 404 path) never
// touches R2 at all, so it never requires them either.
// ---------------------------------------------------------------------------

interface R2Env {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

function loadR2EnvOrThrow(): R2Env {
  const { R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
  if (!R2_ENDPOINT || !R2_BUCKET || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    throw new Error(
      'GET /api/img/[hash]: variáveis de ambiente R2_ENDPOINT/R2_BUCKET/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY ausentes',
    );
  }
  return {
    endpoint: R2_ENDPOINT,
    bucket: R2_BUCKET,
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  };
}

let cachedClient: S3Client | undefined;
let cachedBucket: string | undefined;

/** Builds (once) and memoizes the real S3-compatible R2 client + bucket
 * name. Never called on the 404 (unknown hash) path. */
function getR2(): { client: S3Client; bucket: string } {
  if (!cachedClient || cachedBucket === undefined) {
    const env = loadR2EnvOrThrow();
    const options: S3ClientConfig = {
      region: 'auto', // R2 ignores region; the S3 SDK still requires a string.
      endpoint: env.endpoint,
      credentials: { accessKeyId: env.accessKeyId, secretAccessKey: env.secretAccessKey },
    };
    cachedClient = new S3Client(options);
    cachedBucket = env.bucket;
  }
  return { client: cachedClient, bucket: cachedBucket };
}

/** S3's GetObject models a "key not found" as a generic error carrying
 * `name === 'NoSuchKey'` (or an HTTP 404), not a distinct exception class —
 * same duck-typed check as assets-sync.ts's own (unexported)
 * `isNotFoundError`, necessarily re-declared here since that helper isn't
 * part of @onewash/gi-data's public surface. */
function isNotFoundError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === 'NotFound' || err.name === 'NoSuchKey') return true;
  const metadata = (err as { $metadata?: { httpStatusCode?: number } }).$metadata;
  return metadata?.httpStatusCode === 404;
}

async function productionGetObject(key: string): Promise<ImgObject | null> {
  const { client, bucket } = getR2();
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!res.Body) {
      // No body on a 200 response would be an unexpected/malformed R2
      // response, not a normal "not found" — surfaced as a read failure
      // (502 in handleImg) rather than silently treated as a cache miss.
      throw new Error(`GET /api/img: R2 GetObject respondeu sem corpo para ${key}`);
    }
    const body = await res.Body.transformToByteArray();
    return { body, contentType: res.ContentType };
  } catch (err) {
    if (isNotFoundError(err)) return null;
    throw err;
  }
}

async function productionPutObject(
  key: string,
  body: Uint8Array,
  contentType: string | undefined,
): Promise<void> {
  const { client, bucket } = getR2();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: IMMUTABLE_CACHE_CONTROL,
    }),
  );
}

export const productionDeps: ImgDeps = {
  resolveSourceUrl: resolveSourceUrlFromManifest,
  getObject: productionGetObject,
  putObject: productionPutObject,
  fetchImpl: fetch,
};
