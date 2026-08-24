// Task 8.2 — POST /api/ingest: token -> envelope validation -> raw storage ->
// normalize -> writeSnapshot. Spec: docs/superpowers/specs/2026-08-24-onewash-design.md.
//
// `handleIngest` takes every effectful dependency as an explicit
// `IngestDeps` argument. That is what makes this testable against an
// in-memory PGlite db (test/ingest.test.ts) without touching production
// singletons (Better Auth, the pooled Postgres client, R2) — see apps/web's
// task-8.2-report.md for the full rationale.
//
// This logic lives in its own module (not route.ts) because a Next.js
// `route.ts` may only export the whitelisted route-handler names
// (GET/POST/config/runtime/...) — any other export fails `next build`'s
// generated route-type check (TS2344 in .next/types/app/**/route.ts).
// ./route.ts imports handleIngest + productionDeps and re-exports only POST.

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

export const productionDeps: IngestDeps = {
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

// --- Postgres error classification (review round 1, finding 1) -------------
//
// normalize() and writeSnapshot() both run against data derived from
// envelope.raw — untrusted CLI input that only IngestEnvelope validates at
// the top level (raw: { list: unknown, detail: unknown } deliberately says
// nothing about the HoYoLAB shape inside). A syntactically valid envelope
// can still carry a raw that normalize() chokes on (unmapped property_type,
// missing base/weapon/relics fields, a Traveler id with no element, an
// unreconstructable sub-stat roll) — all synchronous throws from
// @onewash/core, never something IngestEnvelope.safeParse catches. Left
// unhandled, any of those becomes an uncaught 500 instead of a
// client-actionable 400.

/** Node-postgres/pglite's DatabaseError shape (duck-typed — neither driver
 * exports a class we can instanceof-check across both prod and PGlite). */
interface PgErrorLike {
  code?: unknown;
  constraint?: unknown;
  message?: unknown;
}

function isPgError(err: unknown): err is PgErrorLike {
  return typeof err === 'object' && err !== null && 'code' in err;
}

/**
 * drizzle-orm wraps every driver error in its own `DrizzleQueryError` before
 * it reaches our `catch` — the real node-postgres/pglite `DatabaseError`
 * (with `.code`/`.constraint`) sits underneath as `.cause`, not on the
 * caught error itself (confirmed empirically: the caught object exposes
 * `query`/`params`/`cause`, no `code`). Walks the `.cause` chain (bounded,
 * in case something ever causes a cycle) to find it.
 */
function unwrapPgError(err: unknown): PgErrorLike | null {
  let current: unknown = err;
  for (let i = 0; i < 5 && current != null; i++) {
    if (isPgError(current)) return current;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/**
 * True for a unique-violation (23505) on app.snapshot's UNIQUE (account_id,
 * taken_at) constraint — hit when the SAME account reports a DIFFERENT raw
 * payload (different content hash, so a different idempotency_key) for a
 * taken_at already used by an earlier snapshot. writeSnapshot's own
 * ON CONFLICT (account_id, idempotency_key) arbiter only suppresses a
 * conflict on THAT index — a conflict on the OTHER unique index during the
 * same INSERT still raises a raw, uncaught Postgres error (confirmed
 * empirically against PGlite: INSERT ... ON CONFLICT (account_id,
 * idempotency_key) DO NOTHING with a fresh idempotency_key but a colliding
 * (account_id, taken_at) throws 23505 on snapshot_account_id_taken_at_key,
 * it does not silently no-op). Matched by constraint-name substring rather
 * than the exact auto-generated name alone, so this stays correct if the
 * hand-authored migration ever renames the constraint explicitly.
 */
function isTakenAtUniqueViolation(err: unknown): boolean {
  const pgErr = unwrapPgError(err);
  if (!pgErr || pgErr.code !== '23505') return false;
  const constraint = typeof pgErr.constraint === 'string' ? pgErr.constraint : '';
  const message = typeof pgErr.message === 'string' ? pgErr.message : '';
  return constraint.includes('taken_at') || message.includes('taken_at');
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
  //
  // Uses ON CONFLICT ... DO UPDATE (not DO NOTHING) so a later ingest's
  // nickname/lang refresh the stored row instead of freezing at whatever
  // the first-ever ingest happened to send (review round 1, finding 2).
  // Identity columns (game_uid, region, owner_id) are never in the `set`
  // list — only nickname/lang can change on conflict. The ownership check
  // below still runs unconditionally: `setWhere` restricts the UPDATE
  // itself to rows already owned by this userId, so a conflict against a
  // DIFFERENT owner's account updates nothing and falls through to the same
  // 403 path as before, rather than silently taking over their row (or
  // silently refreshing their nickname/lang with this request's data).
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
    .onConflictDoUpdate({
      target: [schema.account.gameUid, schema.account.region],
      set: {
        nickname: envelope.account.nickname ?? null,
        lang: envelope.account.lang,
      },
      setWhere: eq(schema.account.ownerId, userId),
    })
    .returning();

  let accountRow = insertedAccounts[0];
  if (!accountRow) {
    // Either the conflicting row belongs to a different user (setWhere
    // false, so the UPDATE — and thus RETURNING — produced nothing), or a
    // benign race with another insert. Either way, re-fetch to find out.
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
    // hijacking (or even just refreshing metadata on) their account.
    return Response.json({ error: 'account belongs to a different user' }, { status: 403 });
  }

  // 4. normalize() the raw payload into content-addressed character docs.
  // envelope.raw is untrusted beyond its top-level { list, detail } shape —
  // @onewash/core's normalize()/propKey/charKey/reconstructTiers all throw
  // synchronously on a shape or value they don't recognize. Isolated in its
  // own try/catch (review round 1, finding 1) so that throw becomes a 400
  // with a short, non-leaking reason, not an uncaught 500 — the message is
  // core's own short diagnostic string (e.g. "property_type desconhecido:
  // 9999"), never the raw payload, headers, or token.
  let normalized: NormalizedSnapshot;
  try {
    normalized = normalize(envelope.raw);
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'formato de raw inesperado';
    return Response.json({ error: `payload inválido: ${reason}` }, { status: 400 });
  }

  try {
    // 5. Provisional catalog upsert — must happen before writeSnapshot,
    // whose character_state INSERT has hard FKs into
    // catalog.character/catalog.weapon.
    await upsertProvisionalCatalog(db, normalized);

    // 6. Raw storage: content-addressed by sha256 of the canonical (JSON)
    // bytes of envelope.raw — NOT the whole envelope, so byte-identical raw
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

    // 7. writeSnapshot. idempotencyKey is derived from the raw content hash
    // (not carried by IngestEnvelope itself) so that reposting the exact
    // same raw payload for this account dedupes at the snapshot level — via
    // writeSnapshot's own ON CONFLICT (account_id, idempotency_key) DO
    // NOTHING path — instead of racing the (account_id, taken_at) UNIQUE
    // constraint when a client naively retries with the same takenAt. When
    // the SAME takenAt is reused with DIFFERENT content (a different
    // idempotency_key), that race is real — writeSnapshot then throws a raw
    // 23505 on snapshot_account_id_taken_at_key, caught below and reported
    // as 409 (review round 1, finding 1).
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

    // BigInt isn't JSON-serializable (JSON.stringify throws on it), hence
    // the explicit stringification here.
    return Response.json(
      {
        snapshotId: result.snapshotId.toString(),
        changedChars: result.changedChars,
        deduped: result.deduped,
      },
      { status: 200 },
    );
  } catch (err) {
    if (isTakenAtUniqueViolation(err)) {
      return Response.json({ error: 'snapshot já existe para este horário de captura' }, { status: 409 });
    }
    // Anything else unexpected (a DB outage, a bug in
    // upsertProvisionalCatalog, putRaw failing, ...) — logged server-side
    // for diagnosis, but the response stays generic: no error message,
    // stack, query, or payload detail leaks to the client.
    console.error('POST /api/ingest: erro inesperado após a validação do envelope', err);
    return Response.json({ error: 'erro interno ao processar o snapshot' }, { status: 500 });
  }
}
