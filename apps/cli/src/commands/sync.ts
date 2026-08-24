import { writeFileSync } from 'node:fs';
import {
  getSession,
  FirefoxProvider,
  PasteProvider,
  EmbeddedProvider,
  type SessionProvider,
  type HoyolabSession,
} from '@onewash/cookies';
import { HoyolabClient, DEFAULT_LANG, type FetchAllResult } from '@onewash/hoyolab';
import { IngestEnvelope, PROTOCOL_VERSION, normalize } from '@onewash/core';
import { readConfig as readConfigReal, type Config } from '../config.js';
import { postIngest as postIngestReal, saveFailedPayload, type PostIngestResult } from '../api.js';
import { CLI_VERSION } from '../version.js';
import { defaultFirefoxProfileDir } from '../firefox-profile.js';

export interface SyncFlags {
  /** Path to also write the locally-normalized snapshot to (convenience only — the server is the authority). */
  out?: string;
  /** Do everything except send to the OneWash API. */
  dryRun?: boolean;
  /** Which browser's cookie store to read. Only `'firefox'` is supported so far. */
  browser?: string;
  /** Use the embedded-browser login flow (`EmbeddedProvider`) as a session source. */
  login?: boolean;
  /** A raw `"ltoken_v2=...; ltuid_v2=..."` cookie string, pasted by hand. */
  cookie?: string;
  /** Print machine-readable JSON instead of a human-readable summary. */
  json?: boolean;
}

/** Minimal shape of a HoYoLAB client, as far as `runSync` needs it — matches `HoyolabClient`. */
export interface SyncClient {
  fetchAll(): Promise<FetchAllResult>;
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
}

/**
 * Builds the session-provider chain from CLI flags, in the order the brief
 * specifies: `--cookie` (pasted cookie) first, then `--login` (embedded
 * browser), then always `FirefoxProvider` as the final fallback.
 */
export function buildProviders(flags: SyncFlags): SessionProvider[] {
  if (flags.browser && flags.browser !== 'firefox') {
    throw new Error(`navegador não suportado: "${flags.browser}". Suportado hoje: firefox.`);
  }

  const providers: SessionProvider[] = [];
  if (flags.cookie) providers.push(new PasteProvider(flags.cookie));
  if (flags.login) providers.push(new EmbeddedProvider());

  const profilePath = defaultFirefoxProfileDir();
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
  const providers = buildProviders(flags);
  const session = await deps.getSession({ providers });
  const client = deps.makeClient(session);
  const raw = await client.fetchAll();

  const normalized = normalize({ list: raw.list, detail: raw.detail });
  const characters = normalized.characters.length;

  // `IngestEnvelope.parse` both validates the envelope (region enum,
  // non-pt-br lang, etc.) and gives back a properly-typed value — the
  // candidate below is untyped on purpose since `raw.account.region` is a
  // plain `string` from the HoYoLAB client, wider than the protocol's enum.
  const envelope = IngestEnvelope.parse({
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

  if (flags.dryRun) {
    return { characters, changed: 0, sent: false };
  }

  const cfg = deps.readConfig();
  if (!cfg.apiToken) {
    throw new Error('nenhum token da API OneWash configurado. Rode `onewash login <token>` antes de `sync`.');
  }

  try {
    const { changedChars } = await deps.postIngest(envelope, cfg.apiToken, cfg.apiBaseUrl);
    return { characters, changed: changedChars, sent: true };
  } catch (err) {
    const savedPath = saveFailedPayload(envelope);
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `falha ao enviar para a API OneWash: ${reason}. ` +
        `Os dados extraídos foram salvos em ${savedPath} — rode \`onewash sync\` novamente mais tarde para tentar reenviar.`,
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
