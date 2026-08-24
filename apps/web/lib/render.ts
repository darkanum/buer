// Task 8.3 — read/diff layer for the web screens (grid, character detail,
// history, onboarding). Spec: docs/superpowers/specs/2026-08-24-onewash-design.md
// §4 (screens) + §5.11 (read views / 3-level diff).
//
// This module is the ENTIRE testable surface for 8.3 — Server Components
// (app/{onboarding,characters,history}/**) are thin callers reviewed by
// inspection (see task-8.3-report.md). Every function here either touches
// the DB via plain `db.execute(sql\`...\`)` (same pattern as
// packages/db/src/ingest.ts and apps/web/app/api/ingest/route.ts — `IngestDb`
// is deliberately driver-agnostic so PGlite-in-tests and pooled-Postgres-in-
// production both satisfy it) or is a pure function over already-parsed
// `CharacterDoc` data (diffSnapshots), so it never needs an HTTP round trip
// to this app's own API.
//
// §5.11's "diff em 3 níveis" — (0) account_hash, (1) SQL FULL JOIN over
// as-of state_ids, (2) app-level semantic diff of the few docs that changed
// — collapses to level (2) here: Fase 1's account sizes (~50-70 characters)
// make "diff every doc that changed since the two as-of queries already
// only return open/valid-at-that-instant rows" cheap enough that levels 0/1
// are an optimization for larger accounts, not a Fase-1 requirement. Never
// expands jsonb in SQL either way — `doc_canon` is selected as opaque bytes
// and parsed in JS, exactly as §5.11 says.

import { sql } from 'drizzle-orm';
import type { IngestDb } from '@onewash/db';
import type { CharacterDoc, CharacterKey } from '@onewash/core';
import { parseCharKey } from '@onewash/core';
import {
  loadArtifactSets,
  loadAssetManifest,
  loadCharacters,
  loadProperty,
  loadWeapons,
  type ArtifactSetMap,
  type CharacterMap,
  type PropertyMap,
  type WeaponMap,
} from '@onewash/gi-data';

// ---------------------------------------------------------------------------
// gi-data lookups — loaded once (local JSON reads, no network), same pattern
// as app/api/ingest/route.ts's CHARACTERS/WEAPONS/ARTIFACT_SETS constants.
// ---------------------------------------------------------------------------

const CHARACTERS: CharacterMap = loadCharacters();
const WEAPONS: WeaponMap = loadWeapons();
const ARTIFACT_SETS: ArtifactSetMap = loadArtifactSets();
const PROPERTIES: PropertyMap = loadProperty();
const ASSET_MANIFEST = loadAssetManifest();

// ---------------------------------------------------------------------------
// Display helpers — gi-data only carries slugs (no locale bundle exists yet;
// §5.1 reserves that for a FUTURE i18n bundle "indexado por slug"). Fase 1's
// "display name" is therefore the humanized slug, not a real localized
// string — documented here so it isn't mistaken for i18n.
// ---------------------------------------------------------------------------

function humanizeSlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export interface CharacterCatalogInfo {
  readonly charKey: string;
  readonly slug: string;
  readonly displayName: string;
  readonly rarity: number | null;
  readonly element: string | null;
  readonly weaponType: string | null;
  readonly provisional: boolean;
}

/** Resolves display info for a char_key from @onewash/gi-data. For the
 * Traveler (composite key `10000005:anemo`), the element comes from the KEY
 * itself, not from the catalog entry (gi-data's characters.json has no
 * `element` for either Traveler avatar id — see packages/gi-data/scripts/sync.ts's
 * TRAVELER_OVERRIDE). */
export function describeCharacter(charKey: string): CharacterCatalogInfo {
  const { avatarId, element: keyElement } = parseCharKey(charKey as CharacterKey);
  const entry = CHARACTERS[avatarId];
  const slug = entry?.slug ?? `unknown-character-${avatarId}`;
  return {
    charKey,
    slug,
    displayName: humanizeSlug(slug),
    rarity: entry?.rarity ?? null,
    element: keyElement ?? entry?.element ?? null,
    weaponType: entry?.weaponType ?? null,
    provisional: !entry,
  };
}

export interface WeaponCatalogInfo {
  readonly weaponId: number;
  readonly slug: string;
  readonly displayName: string;
  readonly rarity: number | null;
  readonly provisional: boolean;
}

export function describeWeapon(weaponId: number): WeaponCatalogInfo {
  const entry = WEAPONS[weaponId];
  const slug = entry?.slug ?? `unknown-weapon-${weaponId}`;
  return { weaponId, slug, displayName: humanizeSlug(slug), rarity: entry?.rarity ?? null, provisional: !entry };
}

export interface ArtifactSetCatalogInfo {
  readonly setId: number;
  readonly slug: string;
  readonly displayName: string;
  readonly maxRarity: number | null;
  readonly provisional: boolean;
}

export function describeArtifactSet(setId: number): ArtifactSetCatalogInfo {
  const entry = ARTIFACT_SETS[setId];
  const slug = entry?.slug ?? `unknown-set-${setId}`;
  return { setId, slug, displayName: humanizeSlug(slug), maxRarity: entry?.maxRarity ?? null, provisional: !entry };
}

/** Slot number -> the GOOD/engine name (see @onewash/engine's `ArtifactSlot`
 * union) — shared by the detail and history screens so both use the same
 * labels. */
export const ARTIFACT_SLOT_LABELS: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: 'Flor',
  2: 'Pluma',
  3: 'Areia',
  4: 'Copo',
  5: 'Tiara',
};

export interface PropertyDisplayInfo {
  readonly propId: number;
  readonly code: string;
  readonly label: string;
  readonly isPercent: boolean;
  readonly decimals: number;
}

/** Human-ish label for a FIGHT_PROP_* id: the GOOD-dialect key when known
 * (humanized, trailing `_` stripped — e.g. `critDMG_` -> "Crit DMG"),
 * otherwise the raw `code`. */
export function describeProperty(propId: number): PropertyDisplayInfo {
  const entry = PROPERTIES[propId];
  if (!entry) {
    return { propId, code: `UNKNOWN_${propId}`, label: `Prop ${propId}`, isPercent: false, decimals: 0 };
  }
  const key = entry.goodKey?.replace(/_$/, '') ?? entry.code;
  const label = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return { propId, code: entry.code, label, isPercent: entry.isPercent, decimals: entry.decimals };
}

export function formatStatValue(propId: number, value: number): string {
  const { isPercent, decimals } = describeProperty(propId);
  return isPercent ? `${value.toFixed(decimals)}%` : value.toFixed(decimals);
}

/**
 * Resolves a third-party (HoYoLAB/Enka CDN) image URL to its mirrored R2 URL
 * when the asset has already been synced (see packages/gi-data's
 * assets:sync script) AND a public base URL is configured; otherwise falls
 * back to the original URL untouched. Per the design spec §4.2/§9 (spike 5),
 * image hosting isn't finalized in Fase 1 — this keeps both paths honest
 * rather than guessing a URL shape.
 */
export function resolveAssetUrl(rawUrl: string): string {
  const key = ASSET_MANIFEST[rawUrl];
  const base = process.env.NEXT_PUBLIC_ASSETS_BASE_URL;
  if (key && base) {
    return `${base.replace(/\/+$/, '')}/${key}`;
  }
  return rawUrl;
}

// ---------------------------------------------------------------------------
// Account resolution (app.account) — used by every page to go from the
// Better Auth session's userId (owner_id) to this user's OWN account. Plain
// read, no Better Auth dependency, so it's testable with just a seeded
// PGlite db.
// ---------------------------------------------------------------------------

export interface AccountSummary {
  readonly accountId: bigint;
  readonly ownerId: string;
  readonly gameUid: string;
  readonly region: string;
  readonly nickname: string | null;
  readonly lang: string;
  readonly activeDocSchema: number;
  /** MAX(app.snapshot.taken_at) for this account, or `null` if it has never
   * been synced. Onboarding (`app/onboarding/page.tsx`) is shown precisely
   * when this is `null`. */
  readonly lastSyncAt: Date | null;
}

interface AccountRow {
  account_id: string;
  owner_id: string;
  game_uid: string;
  region: string;
  nickname: string | null;
  lang: string;
  active_doc_schema: number;
  last_sync_at: string | Date | null;
}

function rowToAccountSummary(row: AccountRow): AccountSummary {
  return {
    accountId: BigInt(row.account_id),
    ownerId: row.owner_id,
    gameUid: row.game_uid,
    region: row.region,
    nickname: row.nickname,
    lang: row.lang,
    activeDocSchema: row.active_doc_schema,
    lastSyncAt: row.last_sync_at ? new Date(row.last_sync_at) : null,
  };
}

/**
 * Resolves the account owned by a Better Auth user (`owner_id`). A user can
 * in principle own more than one `app.account` (multi-account per §5.2); Fase
 * 1 picks the chosen one (`is_chosen`) first, then the oldest — same
 * tie-break the spec's `is_chosen` column exists for. Returns `null` when
 * this owner has never ingested a snapshot at all (no `app.account` row —
 * per Task 8.2, that row is only ever created by `POST /api/ingest`).
 */
export async function getAccountByOwner(db: IngestDb, ownerId: string): Promise<AccountSummary | null> {
  const res = await db.execute(sql`
    SELECT a.account_id, a.owner_id, a.game_uid, a.region, a.nickname, a.lang, a.active_doc_schema,
           (SELECT MAX(s.taken_at) FROM app.snapshot s WHERE s.account_id = a.account_id) AS last_sync_at
    FROM app.account a
    WHERE a.owner_id = ${ownerId}
    ORDER BY a.is_chosen DESC, a.created_at ASC
    LIMIT 1
  `);
  const rows = (res as { rows: AccountRow[] }).rows;
  return rows[0] ? rowToAccountSummary(rows[0]) : null;
}

// ---------------------------------------------------------------------------
// Roster reads — app.account_at (§5.11's view). Selected columns are exactly
// what the view exposes; `doc_canon` comes back as raw bytes (Buffer from
// node-postgres in production, Uint8Array from PGlite in tests — both
// covered by `Buffer.from(...)`) and is parsed in JS, never expanded in SQL.
// ---------------------------------------------------------------------------

export interface RosterCharacter {
  readonly charKey: string;
  readonly promoted: {
    readonly charLevel: number;
    readonly ascension: number;
    readonly constellation: number;
    readonly weaponId: number | null;
  };
  readonly doc: CharacterDoc;
  readonly validFrom: Date;
  readonly lastSeenAt: Date;
}

interface AccountAtRow {
  char_key: string;
  char_level: number;
  ascension: number;
  constellation: number;
  weapon_id: number | null;
  doc_canon: Uint8Array;
  valid_from: string | Date;
  last_seen_at: string | Date;
}

function parseDocCanon(bytes: Uint8Array): CharacterDoc {
  // canonBytes(doc) (packages/core/src/canon.ts) is compact, key-sorted JSON
  // with no nulls — JSON.parse round-trips it back into the same shape
  // CharacterDoc describes (numbers like "4780.0" just parse as 4780, which
  // doesn't matter: nothing here re-hashes this value, it's read-only).
  return JSON.parse(Buffer.from(bytes).toString('utf8')) as CharacterDoc;
}

function rowToRosterCharacter(row: AccountAtRow): RosterCharacter {
  return {
    charKey: row.char_key,
    promoted: {
      charLevel: row.char_level,
      ascension: row.ascension,
      constellation: row.constellation,
      weaponId: row.weapon_id,
    },
    doc: parseDocCanon(row.doc_canon),
    validFrom: new Date(row.valid_from),
    lastSeenAt: new Date(row.last_seen_at),
  };
}

const ACCOUNT_AT_COLUMNS = sql`char_key, char_level, ascension, constellation, weapon_id, doc_canon, valid_from, last_seen_at`;

/**
 * The account's CURRENT roster — one row per character with an open timeline
 * interval (`valid_to IS NULL`) at the account's `active_doc_schema` (the
 * view already restricts to that doc_schema — see §5.11's `JOIN app.account
 * a ON ... a.active_doc_schema = t.doc_schema`). This is the grid's data
 * source.
 */
export async function getAccountView(db: IngestDb, accountId: bigint): Promise<RosterCharacter[]> {
  const res = await db.execute(sql`
    SELECT ${ACCOUNT_AT_COLUMNS}
    FROM app.account_at
    WHERE account_id = ${accountId.toString()}::bigint AND valid_to IS NULL
    ORDER BY char_key
  `);
  return (res as { rows: AccountAtRow[] }).rows.map(rowToRosterCharacter);
}

/**
 * The account's roster AS OF a past instant (any timeline interval that was
 * open at `asOf`) — what `app/history/page.tsx` diffs two of. Named
 * separately from `getAccountView` (rather than an optional `asOf` param on
 * it) because "current roster" and "roster at an arbitrary past instant" are
 * different enough queries (`valid_to IS NULL` vs a range check) that
 * conflating them behind one optional parameter seemed more likely to hide a
 * bug than to save a line.
 */
export async function getAccountViewAt(db: IngestDb, accountId: bigint, asOf: Date): Promise<RosterCharacter[]> {
  const res = await db.execute(sql`
    SELECT ${ACCOUNT_AT_COLUMNS}
    FROM app.account_at
    WHERE account_id = ${accountId.toString()}::bigint
      AND valid_from <= ${asOf}
      AND (valid_to IS NULL OR valid_to > ${asOf})
    ORDER BY char_key
  `);
  return (res as { rows: AccountAtRow[] }).rows.map(rowToRosterCharacter);
}

/** The account's CURRENT single character (or `null` if never observed) —
 * the detail screen's data source. */
export async function getCharacter(db: IngestDb, accountId: bigint, charKey: string): Promise<RosterCharacter | null> {
  const res = await db.execute(sql`
    SELECT ${ACCOUNT_AT_COLUMNS}
    FROM app.account_at
    WHERE account_id = ${accountId.toString()}::bigint AND char_key = ${charKey} AND valid_to IS NULL
    LIMIT 1
  `);
  const rows = (res as { rows: AccountAtRow[] }).rows;
  return rows[0] ? rowToRosterCharacter(rows[0]) : null;
}

// ---------------------------------------------------------------------------
// Snapshot listing — the history screen's date selector.
// ---------------------------------------------------------------------------

export interface SnapshotSummary {
  readonly snapshotId: bigint;
  readonly takenAt: Date;
  readonly changedChars: number;
  readonly observedChars: number;
}

interface SnapshotRow {
  snapshot_id: string;
  taken_at: string | Date;
  changed_chars: number;
  observed_chars: number;
}

export async function listSnapshots(db: IngestDb, accountId: bigint): Promise<SnapshotSummary[]> {
  const res = await db.execute(sql`
    SELECT snapshot_id, taken_at, changed_chars, observed_chars
    FROM app.snapshot
    WHERE account_id = ${accountId.toString()}::bigint
    ORDER BY taken_at DESC
  `);
  const rows = (res as { rows: SnapshotRow[] }).rows;
  return rows.map((r) => ({
    snapshotId: BigInt(r.snapshot_id),
    takenAt: new Date(r.taken_at),
    changedChars: r.changed_chars,
    observedChars: r.observed_chars,
  }));
}

// ---------------------------------------------------------------------------
// diffSnapshots — §5.11 level (2): app-level semantic diff of two rosters'
// character docs. PURE — no DB, no I/O. Takes anything shaped like
// `{ charKey, doc }` (RosterCharacter satisfies this structurally), so
// getAccountView/getAccountViewAt results can be passed straight in.
// ---------------------------------------------------------------------------

export interface DiffableCharacter {
  readonly charKey: string;
  readonly doc: CharacterDoc;
}

/** Mirrors app.change_event.kind (§5.7) minus `talent_up`'s absence there
 * (it IS in the DDL comment's kind list) — kept as the same vocabulary so a
 * future "backfill change_event from two as-of diffs" job can reuse this
 * function's output almost verbatim. */
export type ChangeKind =
  | 'character_new'
  | 'level_up'
  | 'ascension'
  | 'constellation'
  | 'talent_up'
  | 'weapon_change'
  | 'weapon_refine'
  | 'artifact_equip'
  | 'artifact_upgrade'
  | 'artifact_swap';

export interface RosterChange {
  readonly charKey: string;
  readonly kind: ChangeKind;
  /** Artifact slot (1-5) for `artifact_*` kinds, talent (skill) id for
   * `talent_up` — `undefined` for every other kind. */
  readonly key?: number;
  readonly before?: number;
  readonly after?: number;
}

/**
 * Compares two rosters' `CharacterDoc`s and returns the list of semantic
 * changes between them (§5.11 level 2). Characters present in `after` but
 * not `before` are reported as `character_new` (e.g. first sync after
 * onboarding, or a character shown for the first time) with no further
 * per-field diffing — there is no "before" to compare against.
 *
 * The artifact-fingerprint rule (the crux of this function): for a given
 * slot, if `before`'s and `after`'s artifact have the SAME `fp` (identical
 * set+slot+main-stat+substat-tiers — see `artifactFingerprint` in
 * @onewash/core), the piece itself didn't change, so a higher `lvl` means it
 * was fed EXP -> `artifact_upgrade`. A DIFFERENT `fp` means a physically
 * different piece is now in that slot (whatever its level) -> `artifact_swap`.
 * `fp` is compared as-is (never recomputed here) — it's already part of the
 * stored/parsed doc, and §5.1 established it specifically so callers never
 * need to re-derive artifact identity from raw stats.
 */
export function diffSnapshots(before: readonly DiffableCharacter[], after: readonly DiffableCharacter[]): RosterChange[] {
  const beforeByKey = new Map(before.map((c) => [c.charKey, c.doc]));
  const changes: RosterChange[] = [];

  for (const { charKey, doc: afterDoc } of after) {
    const beforeDoc = beforeByKey.get(charKey);
    if (!beforeDoc) {
      changes.push({ charKey, kind: 'character_new' });
      continue;
    }

    if (afterDoc.lvl > beforeDoc.lvl) {
      changes.push({ charKey, kind: 'level_up', before: beforeDoc.lvl, after: afterDoc.lvl });
    }
    if (afterDoc.asc > beforeDoc.asc) {
      changes.push({ charKey, kind: 'ascension', before: beforeDoc.asc, after: afterDoc.asc });
    }
    if (afterDoc.cons > beforeDoc.cons) {
      changes.push({ charKey, kind: 'constellation', before: beforeDoc.cons, after: afterDoc.cons });
    }

    if (afterDoc.weapon.id !== beforeDoc.weapon.id) {
      changes.push({ charKey, kind: 'weapon_change', before: beforeDoc.weapon.id, after: afterDoc.weapon.id });
    } else if (afterDoc.weapon.refine > beforeDoc.weapon.refine) {
      changes.push({ charKey, kind: 'weapon_refine', before: beforeDoc.weapon.refine, after: afterDoc.weapon.refine });
    }

    const beforeTalents = new Map(beforeDoc.talents);
    for (const [talentId, afterLvl] of afterDoc.talents) {
      const beforeLvl = beforeTalents.get(talentId);
      if (beforeLvl !== undefined && afterLvl > beforeLvl) {
        changes.push({ charKey, kind: 'talent_up', key: talentId, before: beforeLvl, after: afterLvl });
      }
    }

    const beforeArtifacts = new Map(beforeDoc.artifacts.map((a) => [a.slot, a]));
    for (const afterArt of afterDoc.artifacts) {
      const beforeArt = beforeArtifacts.get(afterArt.slot);
      if (!beforeArt) {
        changes.push({ charKey, kind: 'artifact_equip', key: afterArt.slot });
        continue;
      }
      if (beforeArt.fp === afterArt.fp) {
        if (afterArt.lvl > beforeArt.lvl) {
          changes.push({ charKey, kind: 'artifact_upgrade', key: afterArt.slot, before: beforeArt.lvl, after: afterArt.lvl });
        }
      } else {
        changes.push({ charKey, kind: 'artifact_swap', key: afterArt.slot, before: beforeArt.lvl, after: afterArt.lvl });
      }
    }
  }

  return changes;
}
