// packages/gi-data/scripts/assets-sync.ts
//
// Mirrors third-party image URLs (from the catalog/payload — Enka/HoYoLAB CDN
// icons, etc.) into our own Cloudflare R2 bucket, so we don't hot-link or
// depend on upstream CDN availability. For each URL:
//   1. compute assetKey(url) — a deterministic, content-addressed object key
//      (see ../src/assets.ts, the only pure/tested part of this script);
//   2. skip it if it's already in the manifest or already present in R2
//      (idempotent — re-running only uploads what's new);
//   3. otherwise download the bytes and PUT them to R2 with
//      `Cache-Control: public, max-age=31536000, immutable`;
//   4. record originalUrl -> assetKey in ../data/assets.json.
//
// R2 credentials/endpoint/bucket are read from env vars — NEVER hardcoded:
//   R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
// (See https://developers.cloudflare.com/r2/api/s3/api/ — R2's S3-compatible
// API takes an account-scoped endpoint and access-key credentials, no AWS
// account/region.)
//
// This script needs live credentials to actually upload, so it is NOT
// exercised in CI — only assetKey (in ../src/assets.ts) is unit-tested.
//
// Run: `pnpm --filter @buer/gi-data assets:sync <urls.json>`, where
// urls.json is a JSON array of image URL strings. (Node 24 strips TypeScript
// syntax natively, no build step needed.)

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
// NOTE on the extension here: this package has no build/dist step (tsconfig
// has "noEmit": true and "scripts" is intentionally outside its "include" —
// see tsconfig.json — so this file is never typechecked by `tsc`, only run
// directly by Node's native TS type-stripping, same as scripts/sync.ts).
// Node's type-stripping resolves ESM specifiers literally (it does not remap
// ".js" to a sibling ".ts" the way a bundler would), so this has to say
// ".ts" to actually resolve at runtime — unlike src/assets.ts and this
// package's test/*.ts, which use ".js" per NodeNext convention and are
// loaded through vitest's bundler-based resolution instead.
import { assetKey } from '../src/assets.ts';

export { assetKey };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, '..', 'data');
const DEFAULT_MANIFEST_PATH = path.join(DATA, 'assets.json');

/** url original -> chave do objeto em R2 (ver assetKey). */
export type AssetManifest = Record<string, string>;

export interface R2Config {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** R2 ignores region, but the S3 SDK still requires a string; default 'auto'. */
  region?: string;
}

/** Lê endpoint/bucket/credenciais do R2 das env vars. Nunca hardcoded. */
export function loadR2ConfigFromEnv(env: NodeJS.ProcessEnv = process.env): R2Config {
  return {
    endpoint: requireEnv(env, 'R2_ENDPOINT'),
    bucket: requireEnv(env, 'R2_BUCKET'),
    accessKeyId: requireEnv(env, 'R2_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv(env, 'R2_SECRET_ACCESS_KEY'),
  };
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`assets-sync: variável de ambiente ${name} ausente`);
  return value;
}

function makeClient(config: R2Config): S3Client {
  const options: S3ClientConfig = {
    region: config.region ?? 'auto',
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  };
  return new S3Client(options);
}

function isNotFoundError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === 'NotFound' || err.name === 'NoSuchKey') return true;
  const metadata = (err as { $metadata?: { httpStatusCode?: number } }).$metadata;
  return metadata?.httpStatusCode === 404;
}

async function objectExists(client: S3Client, bucket: string, key: string): Promise<boolean> {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (err) {
    if (isNotFoundError(err)) return false;
    throw err;
  }
}

async function downloadBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`assets-sync: falha ao baixar ${url}: HTTP ${res.status}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

function contentTypeFor(key: string): string | undefined {
  return CONTENT_TYPE_BY_EXT[path.extname(key).toLowerCase()];
}

function readManifest(manifestPath: string): AssetManifest {
  if (!existsSync(manifestPath)) return {};
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as AssetManifest;
}

function writeManifest(manifestPath: string, manifest: AssetManifest): void {
  const sorted: AssetManifest = {};
  for (const url of Object.keys(manifest).sort()) {
    sorted[url] = manifest[url]!;
  }
  writeFileSync(manifestPath, JSON.stringify(sorted, null, 2) + '\n', 'utf8');
}

export interface SyncAssetsOptions {
  r2: R2Config;
  /** Defaults to ../data/assets.json. Overridable for tests/tooling. */
  manifestPath?: string;
  /** Injectable S3 client (tests/tooling); defaults to one built from `r2`. */
  client?: S3Client;
  onProgress?: (message: string) => void;
}

/**
 * Mirrors each URL into R2 under assetKey(url), skipping URLs already
 * present (in the manifest, or already uploaded to R2), and returns the
 * updated manifest — which is also persisted to disk. Idempotent: re-running
 * with the same urls only downloads/uploads what's missing.
 */
export async function syncAssets(
  urls: readonly string[],
  options: SyncAssetsOptions,
): Promise<AssetManifest> {
  const manifestPath = options.manifestPath ?? DEFAULT_MANIFEST_PATH;
  const manifest = readManifest(manifestPath);
  const client = options.client ?? makeClient(options.r2);
  const log = options.onProgress ?? (() => {});

  for (const url of urls) {
    if (manifest[url]) {
      log(`skip (já no manifesto): ${url}`);
      continue;
    }

    const key = assetKey(url);
    if (await objectExists(client, options.r2.bucket, key)) {
      log(`skip (já em R2): ${url} -> ${key}`);
      manifest[url] = key;
      continue;
    }

    log(`baixando: ${url}`);
    const bytes = await downloadBytes(url);
    log(`enviando: ${key} (${bytes.byteLength} bytes)`);
    await client.send(
      new PutObjectCommand({
        Bucket: options.r2.bucket,
        Key: key,
        Body: bytes,
        ContentType: contentTypeFor(key),
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
    manifest[url] = key;
  }

  writeManifest(manifestPath, manifest);
  return manifest;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function readUrlsFile(filePath: string): string[] {
  const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  if (!Array.isArray(parsed) || !parsed.every((u) => typeof u === 'string')) {
    throw new Error(`assets-sync: ${filePath} deve conter um array JSON de strings (URLs)`);
  }
  return parsed;
}

async function main(): Promise<void> {
  const urlsFile = process.argv[2];
  if (!urlsFile) {
    console.error('uso: node scripts/assets-sync.ts <urls.json>');
    console.error('  urls.json: array JSON de URLs de imagem a espelhar para R2.');
    process.exitCode = 1;
    return;
  }

  const urls = readUrlsFile(urlsFile);
  const r2 = loadR2ConfigFromEnv();
  const manifest = await syncAssets(urls, { r2, onProgress: (m) => console.log(m) });
  console.log(`assets-sync: ok — manifesto com ${Object.keys(manifest).length} entradas`);
}

const isMainModule = fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '');
if (isMainModule) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
