// packages/gi-data/src/assets.ts
//
// Pure helpers for mirroring third-party image URLs into our own R2 bucket.
// This file holds only the deterministic, unit-testable piece (assetKey) —
// the actual network/R2 uploader lives in ../scripts/assets-sync.ts, which
// imports assetKey from here. Kept under src/ (not scripts/) specifically so
// it's covered by this package's tsconfig ("include": ["src", "test"]) and
// therefore typechecked and testable without pulling scripts/ into the
// typecheck scope.

import path from 'node:path';
import { createHash } from 'node:crypto';

/**
 * Content-addressed object key for a mirrored asset: sha1(url) + the
 * original file extension (lowercased), e.g.
 *   https://host/x/UI_AvatarIcon_Furina.png -> "<40-hex-sha1>.png"
 *
 * Pure and deterministic — same URL always yields the same key, with no
 * network access. The extension is taken from the URL's pathname (query
 * strings / fragments are ignored) so downloads keep a recognizable
 * suffix for content-type sniffing and cache friendliness in R2.
 */
export function assetKey(url: string): string {
  const hash = createHash('sha1').update(url).digest('hex');
  const ext = extensionOf(url);
  return ext ? `${hash}${ext}` : hash;
}

function extensionOf(url: string): string {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    // Not a parseable absolute URL — fall back to treating the raw string
    // as a path so this stays total (never throws) for any input string.
    pathname = url;
  }
  return path.extname(pathname).toLowerCase();
}
