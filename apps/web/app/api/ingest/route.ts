// Task 8.2 — POST /api/ingest: token -> envelope validation -> raw storage ->
// normalize -> writeSnapshot. Spec: docs/superpowers/specs/2026-08-24-onewash-design.md.
//
// The route body below is a thin wrapper (`POST`) around `handleIngest`, which
// takes every effectful dependency as an explicit `IngestDeps` argument. That
// is what makes this testable against an in-memory PGlite db (test/ingest.test.ts)
// without touching production singletons (Better Auth, the pooled Postgres
// client, R2) — see apps/web's task-8.2-report.md for the full rationale.

import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import {
  schema,
  writeSnapshot as productionWriteSnapshot,
  type IngestDb,
  type WriteSnapshotArgs,
  type WriteSnapshotResult,
} from '@onewash/db';
import {
  IngestEnvelope,
  normalize,
  parseCharKey,
  type CharacterKey,
  type NormalizedSnapshot,
} from '@onewash/core';
import { loadArtifactSets, loadCharacters, loadWeapons } from '@onewash/gi-data';
import { verifyApiKey as productionVerifyApiKey } from '../../../lib/auth.js';
import { db as productionDb } from '../../../lib/db.js';

// --- Versioning (hardcoded for v1; see app.doc_schema / spec §5.1) ---------

/** Matches the single seeded row in `app.doc_schema` (migration 0000_init.sql). */
const DOC_SCHEMA_VERSION = 1;
/** Version of THIS route's server-side parsing (normalize()) logic — distinct
 * from `IngestEnvelope`'s wire-format `PROTOCOL_VERSION`. Bump when
 * `@onewash/core`'s normalize() changes what it extracts from `raw`, so
 * `app.snapshot.parser_version` can drive a future reparse-on-upgrade job
 * (see the `snapshot_reparse` index). */
const PARSER_VERSION = 1;

// --- gi-data lookups, loaded once (local JSON reads; no network) ----------

const CHARACTERS = loadCharacters();
const WEAPONS = loadWeapons();
const ARTIFACT_SETS = loadArtifactSets();

// --- Raw storage seam (testable without R2) --------------------------------

export interface PutRawResult {
  /** Non-null always — see the CHECK on `app.raw_object`
   * (`object_key IS NOT NULL OR purged_at IS NOT NULL`). Inline storage uses
   * a synthesized `inline:<sha256hex>` key rather than a real R2 URI, which
   * satisfies that CHECK without pretending bytes were purged. */
  objectKey: string;
  /** Bytes to store in `app.raw_observation.inline_bytes`, or `null` when
   * they were uploaded elsewhere (R2) and only the object key is kept. */
  inlineBytes: Buffer | null;
  codec: 'none' | 'gzip' | 'zstd';
}
export type PutRaw = (bytes: Buffer, sha256Hex: string) => Promise<PutRawResult>;

/**
 * Default `putRaw`: stores the bytes inline in Postgres instead of R2.
 *
 * No R2 client exists anywhere in this repo yet (grepped — only gi-data's
 * unrelated asset-sync script touches `@aws-sdk/client-s3`), and the task
 * brief for 8.2 explicitly allows this as the alternative to a real R2
 * upload ("put the bytes in inline_bytes ... Do NOT require R2 credentials
 * to run the tests"). `PutRaw` is the seam: swapping this default for a real
 * R2 upload (returning `{ objectKey: 'r2://...', inlineBytes: null, codec }`)
 * is a one-function change, isolated from the rest of the route.
 */
export const inlinePutRaw: PutRaw = async (bytes, sha256Hex) => ({
  objectKey: `inline:${sha256Hex}`,
  inlineBytes: bytes,
  codec: 'none',
});

// --- Injectable dependencies -------------------------------------------

export interface IngestDeps {
  verifyApiKey: (req: Request) => Promise<{ userId: string } | null>;
  db: IngestDb;
  writeSnapshot: (db: IngestDb, args: WriteSnapshotArgs) => Promise<WriteSnapshotResult>;
  putRaw: PutRaw;
  parserVersion?: number;
}

const productionDeps: IngestDeps = {
  verifyApiKey: productionVerifyApiKey,
  db: productionDb,
  writeSnapshot: productionWriteSnapshot,
  putRaw: inlinePutRaw,
  parserVersion: PARSER_VERSION,
};

// --- Provisional catalog upsert ------------------------------------------
//
// writeSnapshot's `app.character_state` INSERT has hard FKs to
// `catalog.character(char_key)` and `catalog.weapon(weapon_id)` — on a fresh
// DB (or the first time this account reports a never-before-seen
// character/weapon/artifact set), those rows don't exist yet, and
// writeSnapshot would fail outright. This fills them in first, best-effort:
// known ids (per @onewash/gi-data) get real slug/rarity/etc and
// `provisional=false`; unknown ids get a minimal, synthesized-slug row with
// `provisional=true` so a later catalog sync can backfill the real data
// without an app-level migration.
//
// Deliberately left null/default here (see task-8.2-report.md "Concerns"):
// `catalog.character.weapon_type`, `catalog.weapon.wt_id/main_prop/sub_prop`
// — populating them would reference `catalog.weapon_type`/`catalog.property`,
// neither of which the migration seeds (no INSERT for either in
// packages/db/drizzle/0000_init.sql), so a non-null value there would be an
// FK violation waiting to happen. `catalog.weapon.promote_len` is NOT NULL
// with no gi-data equivalent; defaulted to 5 (the common case).
async function upsertProvisionalCatalog(db: IngestDb, normalized: NormalizedSnapshot): Promise<void> {
  const charKeys = new Set(normalized.characters.map((c) => c.charKey));
  const weaponIds = new Set(normalized.characters.map((c) => c.doc.weapon.id));
  const setIds = new Set(normalized.characters.flatMap((c) => c.doc.artifacts.map((a) => a.set)));

  for (const key of charKeys) {
    const { avatarId, element } = parseCharKey(key as CharacterKey);
    const known = CHARACTERS[avatarId];
    await db
      .insert(schema.character)
      .values({
        charKey: key,
        avatarId,
        element: element ?? null,
        slug: known ? known.slug : `provisional-char-${avatarId}${element ? `-${element}` : ''}`,
        rarity: known ? known.rarity : null,
        provisional: !known,
      })
      .onConflictDoNothing({ target: schema.character.charKey });
  }

  for (const weaponId of weaponIds) {
    const known = WEAPONS[weaponId];
    await db
      .insert(schema.weapon)
      .values({
        weaponId,
        slug: known ? known.slug : `provisional-weapon-${weaponId}`,
        rarity: known ? known.rarity : null,
        promoteLen: 5,
      })
      .onConflictDoNothing({ target: schema.weapon.weaponId });
  }

  for (const setId of setIds) {
    const known = ARTIFACT_SETS[setId];
    await db
      .insert(schema.artifactSet)
      .values({
        setId,
        slug: known ? known.slug : `provisional-set-${setId}`,
        maxRarity: known ? known.maxRarity : null,
        twopcNumeric: known ? known.twopcNumeric : false,
      })
      .onConflictDoNothing({ target: schema.artifactSet.setId });
  }
}

// --- The handler ------------------------------------------------------------

export async function handleIngest(deps: IngestDeps, req: Request): Promise<Response> {
  // 1. Token first — a request with no/invalid key never gets its body read.
  const identity = await deps.verifyApiKey(req);
  if (!identity) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { userId } = identity;

  // 2. Envelope validation. `req.json()` throws on a non-JSON/empty body —
  // caught and reported as 400, same as a zod failure, instead of crashing
  // the route (an uncaught throw here would surface as an unhandled 500).
  let bodyJson: unknown;
  try {
    bodyJson = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const parsed = IngestEnvelope.safeParse(bodyJson);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues }, { status: 400 });
  }
  const envelope = parsed.data;
  const { db } = deps;

  // 3. Resolve/create app.account — UNIQUE (game_uid, region). `owner_id`
  // comes ONLY from `userId` (the verified key's referenceId), never from
  // `envelope.account` or any other part of the body: a spoofed owner field
  // in the request simply has no column to land in.
  const insertedAccounts = await db
    .insert(schema.account)
    .values({
      ownerId: userId,
      gameUid: envelope.account.gameUid,
      region: envelope.account.region,
      nickname: envelope.account.nickname ?? null,
      lang: envelope.account.lang,
      activeDocSchema: DOC_SCHEMA_VERSION,
    })
    .onConflictDoNothing({ target: [schema.account.gameUid, schema.account.region] })
    .returning();

  let accountRow = insertedAccounts[0];
  if (!accountRow) {
    const existing = await db
      .select()
      .from(schema.account)
      .where(and(eq(schema.account.gameUid, envelope.account.gameUid), eq(schema.account.region, envelope.account.region)))
      .limit(1);
    accountRow = existing[0];
  }
  if (!accountRow) {
    // Unreachable in practice (insert or select must find a row given the
    // UNIQUE constraint), but keeps this fully typed without a `!`.
    return Response.json({ error: 'failed to resolve account' }, { status: 500 });
  }
  if (accountRow.ownerId !== userId) {
    // This game_uid+region is already claimed by a different Better Auth
    // user — refuse rather than silently attributing writes to them or
    // hijacking their account.
    return Response.json({ error: 'account belongs to a different user' }, { status: 403 });
  }

  // 4. normalize() the raw payload into content-addressed character docs.
  const normalized = normalize(envelope.raw);

  // 5. Provisional catalog upsert — must happen before writeSnapshot, whose
  // character_state INSERT has hard FKs into catalog.character/catalog.weapon.
  await upsertProvisionalCatalog(db, normalized);

  // 6. Raw storage: content-addressed by sha256 of the canonical (JSON)
  // bytes of `envelope.raw` — NOT the whole envelope, so byte-identical raw
  // payloads dedupe regardless of takenAt/cliVersion/account metadata.
  const rawBytes = Buffer.from(JSON.stringify(envelope.raw), 'utf8');
  const rawSha256 = createHash('sha256').update(rawBytes).digest();
  const rawSha256Hex = rawSha256.toString('hex');
  const takenAt = new Date(envelope.takenAt);

  const { objectKey, inlineBytes, codec } = await deps.putRaw(rawBytes, rawSha256Hex);

  await db
    .insert(schema.rawObject)
    .values({ rawSha256, byteLen: rawBytes.byteLength, codec, objectKey })
    .onConflictDoNothing({ target: schema.rawObject.rawSha256 });

  await db
    .insert(schema.rawObservation)
    .values({
      rawSha256,
      accountId: accountRow.accountId,
      endpoint: 'genshin/api/character/list+detail',
      capturedAt: takenAt,
      inlineBytes,
    })
    .onConflictDoNothing({ target: [schema.rawObservation.rawSha256, schema.rawObservation.capturedAt] });

  // 7. writeSnapshot. `idempotencyKey` is derived from the raw content hash
  // (not carried by IngestEnvelope itself) so that reposting the exact same
  // raw payload for this account dedupes at the snapshot level — via
  // writeSnapshot's own `ON CONFLICT (account_id, idempotency_key) DO
  // NOTHING` path — instead of racing the `(account_id, taken_at)` UNIQUE
  // constraint when a client naively retries with the same `takenAt`.
  const result = await deps.writeSnapshot(db, {
    accountId: accountRow.accountId,
    takenAt,
    parserVersion: deps.parserVersion ?? PARSER_VERSION,
    docSchema: DOC_SCHEMA_VERSION,
    lang: envelope.account.lang,
    rawSha256,
    normalized,
    idempotencyKey: rawSha256Hex,
    cliVersion: envelope.cliVersion,
  });

  // BigInt isn't JSON-serializable (JSON.stringify throws on it), hence the
  // explicit stringification here.
  return Response.json(
    {
      snapshotId: result.snapshotId.toString(),
      changedChars: result.changedChars,
      deduped: result.deduped,
    },
    { status: 200 },
  );
}

/**
 * Production route handler. Rate limiting per token is delegated to Better
 * Auth's `apiKey` plugin (see lib/auth.ts) — it already exposes a
 * `rateLimit: { enabled, window, max, storage }` option (and per-key
 * `rateLimitMax`/`rateLimitTimeWindow`/`rateLimitEnabled` overrides), just
 * not turned on yet (see task-8.2-report.md "Concerns"). WAF-per-IP is
 * infra config, out of code entirely.
 */
export async function POST(req: Request): Promise<Response> {
  return handleIngest(productionDeps, req);
}
