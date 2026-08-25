import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IngestEnvelope } from '@buer/core';

/** What the server hands back after a successful ingest. */
export interface PostIngestResult {
  changedChars: number;
}

/** Thrown by {@link postIngest} for any non-2xx response or transport failure. */
export class ApiError extends Error {}

export interface PostIngestOptions {
  /** Injectable for tests — default: global `fetch` (Node 24's built-in undici client). */
  fetch?: typeof fetch;
}

const TRUNCATE_AT = 300;

function truncate(text: string): string {
  return text.length > TRUNCATE_AT ? `${text.slice(0, TRUNCATE_AT)}…` : text;
}

/**
 * POSTs the raw ingest envelope to `${baseUrl}/api/ingest`.
 *
 * Sends the token both as `Authorization: Bearer <token>` (per the
 * architecture doc's description of this call) *and* as `x-api-key`
 * (the header the concrete `apps/web` auth contract — task 8.1's
 * `verifyApiKey` — actually reads, via Better Auth's `apiKey` plugin
 * default). Sending both costs nothing and keeps this client working
 * against the server regardless of which one it settles on.
 */
export async function postIngest(
  env: IngestEnvelope,
  token: string,
  baseUrl: string,
  opts: PostIngestOptions = {},
): Promise<PostIngestResult> {
  const doFetch = opts.fetch ?? fetch;
  const url = `${baseUrl.replace(/\/+$/, '')}/api/ingest`;

  let res: Response;
  try {
    res = await doFetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-api-key': token,
      },
      body: JSON.stringify(env),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new ApiError(`falha ao conectar em ${url}: ${reason}`);
  }

  const text = await res.text();
  if (!res.ok) {
    throw new ApiError(`POST /api/ingest falhou (HTTP ${res.status}): ${truncate(text)}`);
  }

  let payload: { changedChars?: number };
  try {
    payload = text ? (JSON.parse(text) as { changedChars?: number }) : {};
  } catch {
    throw new ApiError(`resposta inválida de /api/ingest: ${truncate(text)}`);
  }

  return { changedChars: payload.changedChars ?? 0 };
}

/**
 * Called when {@link postIngest} fails: saves the raw envelope to a local
 * file (so the extraction isn't lost — re-running the extraction just to
 * retry the upload is expensive and re-hits HoYoLAB) and returns the path
 * so the caller can tell the user how to find it.
 */
export function saveFailedPayload(env: IngestEnvelope): string {
  const path = join(tmpdir(), `buer-failed-sync-${Date.now()}.json`);
  writeFileSync(path, JSON.stringify(env, null, 2), 'utf8');
  return path;
}
