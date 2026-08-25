import { writeFileSync } from 'node:fs';
import {
  getSession,
  FirefoxProvider,
  PasteProvider,
  EmbeddedProvider,
  type SessionProvider,
  type HoyolabSession,
} from '@buer/cookies';
import { HoyolabClient, DEFAULT_LANG, type FetchAllResult, type GameRole, type GameRoleSelector } from '@buer/hoyolab';
import { IngestEnvelope, PROTOCOL_VERSION, normalize, type NormalizedSnapshot } from '@buer/core';
import { readConfig as readConfigReal, type Config } from '../config.js';
import { postIngest as postIngestReal, saveFailedPayload, type PostIngestResult } from '../api.js';
import { CLI_VERSION } from '../version.js';
import { defaultFirefoxProfileDir } from '../firefox-profile.js';
import { redact } from '../redact.js';

export interface SyncFlags {
  /** Path to also write the locally-normalized snapshot to (convenience only — the server is the authority). */
  out?: string;
  /**
   * Path to dump the RAW HoYoLAB payload (`list`/`detail`/`account`, exactly
   * what `client.fetchAll()` returned) to — independent of `normalize()`,
   * written immediately after the fetch and before normalization runs.
   * `normalize()` now handles real-account payloads (FightProp property map,
   * flat HP/ATK/DEF/EM substats, times+1 roll reconstruction — see
   * @buer/core's normalize-hardening report), so this is now mainly a safety
   * net for a genuinely unmapped `property_type` (a future game update
   * adding a new one) rather than a known gap: see `SyncResult.normalized`.
   * Never contains the session cookie — the cookie only ever lives in the
   * request headers, never in `fetchAll()`'s result.
   */
  rawOut?: string;
  /** Do everything except send to the Buer API. */
  dryRun?: boolean;
  /** Which browser's cookie store to read. Only `'firefox'` is supported so far. */
  browser?: string;
  /** Use the embedded-browser login flow (`EmbeddedProvider`) as a session source. */
  login?: boolean;
  /** A raw `"ltoken_v2=...; ltuid_v2=..."` cookie string, pasted by hand. */
  cookie?: string;
  /** Print machine-readable JSON instead of a human-readable summary. */
  json?: boolean;
  /**
   * Select a game account by `game_uid` when the HoYoLAB cookie has more
   * than one hk4e_global account. Takes priority over `region` when both
   * are given.
   */
  uid?: string;
  /**
   * Select a game account by region (`os_usa`|`os_euro`|`os_asia`|`os_cht`)
   * when the cookie has more than one hk4e_global account. Ignored when
   * `uid` is also given.
   */
  region?: string;
  /**
   * List every Genshin (hk4e_global) account bound to this HoYoLAB cookie
   * — uid/region/nickname — and exit WITHOUT fetching characters. Lets the
   * user discover the `--uid`/`--region` to pass on a real sync.
   */
  listAccounts?: boolean;
}

/** The four HoYoLAB server regions Genshin supports. */
export const VALID_REGIONS = ['os_usa', 'os_euro', 'os_asia', 'os_cht'] as const;

/** Minimal shape of a HoYoLAB client, as far as `runSync` needs it — matches `HoyolabClient`. */
export interface SyncClient {
  fetchAll(selector?: GameRoleSelector): Promise<FetchAllResult>;
  listGameRoles(): Promise<GameRole[]>;
}

/**
 * Everything `runSync` needs, as injectable functions — this is what lets
 * the orchestration logic be unit-tested without a real browser, real
 * network, or real filesystem config.
 */
export interface SyncDeps {
  getSession: (opts: { providers: SessionProvider[] }) => Promise<HoyolabSession>;
  makeClient: (session: HoyolabSession) => SyncClient;
  postIngest: (env: IngestEnvelope, token: string, baseUrl: string) => Promise<PostIngestResult>;
  readConfig: () => Config;
}

export interface SyncResult {
  characters: number;
  changed: number;
  sent: boolean;
  /** Path the raw payload was written to, if `--raw-out` was given. */
  rawSaved?: string;
  /**
   * Whether `normalize()` succeeded. `false` means the extraction itself
   * still succeeded (raw payload saved when `--raw-out` was given) but
   * normalization — and therefore upload — was skipped, because
   * `normalize()` can't yet handle this payload. Only ever `false` when
   * `rawOut` was set; without it, a `normalize()` failure still propagates
   * as an error (old behavior, unchanged).
   */
  normalized?: boolean;
  /**
   * Present only when `--list-accounts` was given: every hk4e_global
   * account bound to the HoYoLAB cookie, in `listGameRoles()` order. When
   * this is set, `characters`/`changed`/`sent` are meaningless zeros/false
   * — no extraction was attempted.
   */
  accounts?: GameRole[];
}

export interface BuildProvidersOptions {
  /**
   * Test seam: overrides how the default Firefox profile directory is
   * resolved. Defaults to the real `defaultFirefoxProfileDir` (host
   * filesystem lookup) — tests inject a stub here so `buildProviders` is
   * fully hermetic (no real Firefox install required, and both "a profile
   * was found" and "none was found" branches are directly assertable).
   */
  resolveFirefoxProfileDir?: () => string | null;
}

/**
 * Builds the session-provider chain from CLI flags, in the order the brief
 * specifies: `--cookie` (pasted cookie) first, then `--login` (embedded
 * browser), then `FirefoxProvider` last — but only when a default profile
 * directory actually resolves (see `resolveFirefoxProfileDir`); when it
 * doesn't, Firefox is simply omitted from the chain rather than added with
 * a bogus path.
 */
export function buildProviders(flags: SyncFlags, opts: BuildProvidersOptions = {}): SessionProvider[] {
  if (flags.browser && flags.browser !== 'firefox') {
    throw new Error(`navegador não suportado: "${flags.browser}". Suportado hoje: firefox.`);
  }

  const providers: SessionProvider[] = [];
  if (flags.cookie) providers.push(new PasteProvider(flags.cookie));
  if (flags.login) providers.push(new EmbeddedProvider());

  const resolveFirefoxProfileDir = opts.resolveFirefoxProfileDir ?? defaultFirefoxProfileDir;
  const profilePath = resolveFirefoxProfileDir();
  if (profilePath) providers.push(new FirefoxProvider({ profilePath }));

  return providers;
}

/**
 * Orchestrates a full sync: session (in-memory only — the HoYoLAB cookie
 * is never written to disk) → HoYoLAB extraction → `IngestEnvelope` →
 * upload. `deps` is fully injected so this never touches a real browser,
 * network, or filesystem in tests.
 *
 * `NoSessionError` (thrown by `deps.getSession` when no provider found a
 * session) is deliberately left to propagate as-is: its message already
 * names every provider tried and how to unblock (`--login`/`--cookie`),
 * so it's already the actionable message the caller should see.
 */
export async function runSync(deps: SyncDeps, flags: SyncFlags = {}): Promise<SyncResult> {
  if (flags.region && !(VALID_REGIONS as readonly string[]).includes(flags.region)) {
    throw new Error(`região inválida: "${flags.region}". Suportadas: ${VALID_REGIONS.join(', ')}.`);
  }

  const providers = buildProviders(flags);
  const session = await deps.getSession({ providers });
  const client = deps.makeClient(session);

  // `--list-accounts`: discover every hk4e_global account bound to this
  // cookie (uid/region/nickname) and stop — no character extraction, no
  // upload. This is how a multi-account user finds the `--uid`/`--region`
  // to pass on the real `sync`.
  if (flags.listAccounts) {
    const accounts = await client.listGameRoles();
    if (accounts.length === 0) {
      console.log('Nenhuma conta Genshin (hk4e_global) vinculada a este cookie.');
    } else {
      console.log('Contas Genshin encontradas:');
      for (const a of accounts) {
        console.log(`  uid=${a.gameUid} region=${a.region} nickname=${a.nickname ?? ''}`);
      }
    }
    return { characters: 0, changed: 0, sent: false, accounts };
  }

  const raw = await client.fetchAll({ uid: flags.uid, region: flags.region });

  // Dump the raw payload FIRST, independent of normalize() — this is what
  // lets a real extraction survive even a normalize() failure (now expected
  // to be rare — see SyncFlags.rawOut). `raw` is exactly `fetchAll()`'s
  // result (list / detail / account) — it never contains the session
  // cookie, which only ever lives in the request headers the client already
  // sent.
  if (flags.rawOut) {
    writeFileSync(flags.rawOut, JSON.stringify(raw, null, 2), 'utf8');
    console.log(`Payload cru da extração salvo em ${flags.rawOut}.`);
  }

  let normalized: NormalizedSnapshot;
  let envelope: IngestEnvelope;
  try {
    normalized = normalize({ list: raw.list, detail: raw.detail });

    // `IngestEnvelope.parse` both validates the envelope (region enum,
    // non-pt-br lang, etc.) and gives back a properly-typed value — the
    // candidate below is untyped on purpose since `raw.account.region` is a
    // plain `string` from the HoYoLAB client, wider than the protocol's enum.
    envelope = IngestEnvelope.parse({
      protocolVersion: PROTOCOL_VERSION,
      cliVersion: CLI_VERSION,
      takenAt: new Date().toISOString(),
      account: {
        gameUid: raw.account.gameUid,
        region: raw.account.region,
        nickname: raw.account.nickname ?? null,
        lang: DEFAULT_LANG,
      },
      raw: { list: raw.list, detail: raw.detail },
    });

    if (flags.out) {
      writeFileSync(flags.out, JSON.stringify(normalized, null, 2), 'utf8');
    }
  } catch (err) {
    // Without `--raw-out` there's nothing to fall back to — preserve the
    // old behavior (propagate) so existing callers/tests aren't surprised.
    if (!flags.rawOut) throw err;

    const reason = redact(err instanceof Error ? err.message : String(err));
    console.error(
      `extração OK (raw salvo em ${flags.rawOut}); normalização falhou ` +
        `(esperado nesta fase com dados reais): ${reason}`,
    );
    // Never uploads when normalization was skipped — there's no valid
    // envelope to send.
    return { characters: 0, changed: 0, sent: false, rawSaved: flags.rawOut, normalized: false };
  }

  const characters = normalized.characters.length;

  if (flags.dryRun) {
    return { characters, changed: 0, sent: false, rawSaved: flags.rawOut, normalized: true };
  }

  const cfg = deps.readConfig();
  if (!cfg.apiToken) {
    throw new Error('nenhum token da API Buer configurado. Rode `buer login <token>` antes de `sync`.');
  }

  try {
    const { changedChars } = await deps.postIngest(envelope, cfg.apiToken, cfg.apiBaseUrl);
    return { characters, changed: changedChars, sent: true, rawSaved: flags.rawOut, normalized: true };
  } catch (err) {
    const savedPath = saveFailedPayload(envelope);
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `falha ao enviar para a API Buer: ${reason}. ` +
        `Os dados extraídos foram salvos em ${savedPath} — rode \`buer sync\` novamente mais tarde para tentar reenviar.`,
    );
  }
}

/** Wires up the real (non-test) dependencies used by the `sync` command in `index.ts`. */
export function createSyncDeps(): SyncDeps {
  return {
    getSession,
    makeClient: (session) => new HoyolabClient({ cookies: session }),
    postIngest: postIngestReal,
    readConfig: () => readConfigReal(),
  };
}
