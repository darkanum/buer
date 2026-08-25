import { getSession, NoSessionError, type HoyolabSession } from '@buer/cookies';
import { HoyolabClient, HoyolabError, ACCOUNT_BASE } from '@buer/hoyolab';
import { readConfig as readConfigReal, type Config } from '../config.js';
import { buildProviders } from './sync.js';

export interface HoyolabCheckResult {
  /** Did we get any real response from HoYoLAB at all (even an error one)? */
  reachable: boolean;
  /** Was the session itself accepted (i.e. bound to a game account)? */
  valid: boolean;
}

/**
 * Everything `runDoctor` needs, as injectable functions — same rationale
 * as `SyncDeps`: lets the four checks below be driven by fakes in tests,
 * with no real browser, network, or filesystem involved.
 */
export interface DoctorDeps {
  /** Looks for a HoYoLAB session via the default provider chain. Never throws — `null` means "not found". */
  findSession: () => Promise<HoyolabSession | null>;
  checkHoyolab: (session: HoyolabSession | null) => Promise<HoyolabCheckResult>;
  checkApi: (baseUrl: string) => Promise<boolean>;
  readConfig: () => Config;
}

export interface DoctorReport {
  /** Was a HoYoLAB session found (any provider — browser cookie, pasted, or embedded login)? */
  cookieFound: boolean;
  /** Was that session accepted by HoYoLAB? Always `false` when `cookieFound` is `false`. */
  cookieValid: boolean;
  /** Did HoYoLAB's API respond at all? */
  hoyolabReachable: boolean;
  /** Did the configured Buer API respond? */
  apiReachable: boolean;
  /** Is a Buer API token configured (`login` already run)? */
  paired: boolean;
}

/** Runs the four diagnostic checks the brief calls for and reports them together. */
export async function runDoctor(deps: DoctorDeps): Promise<DoctorReport> {
  const cfg = deps.readConfig();
  const session = await deps.findSession();
  const { reachable: hoyolabReachable, valid: cookieValid } = await deps.checkHoyolab(session);
  const apiReachable = await deps.checkApi(cfg.apiBaseUrl);

  return {
    cookieFound: session !== null,
    cookieValid: session !== null && cookieValid,
    hoyolabReachable,
    apiReachable,
    paired: Boolean(cfg.apiToken),
  };
}

/** Wires up the real (non-test) dependencies used by the `doctor` command in `index.ts`. */
export function createDoctorDeps(): DoctorDeps {
  return {
    findSession: async () => {
      try {
        return await getSession({ providers: buildProviders({}) });
      } catch (err) {
        if (err instanceof NoSessionError) return null;
        throw err;
      }
    },
    checkHoyolab: async (session) => {
      if (!session) {
        try {
          await fetch(ACCOUNT_BASE);
          return { reachable: true, valid: false };
        } catch {
          return { reachable: false, valid: false };
        }
      }
      try {
        await new HoyolabClient({ cookies: session }).getGameRole();
        return { reachable: true, valid: true };
      } catch (err) {
        // A `HoyolabError` means HoYoLAB *did* answer (just with a
        // retcode we don't like) — that's still "reachable", just not
        // "valid". Anything else (network failure, etc.) is neither.
        if (err instanceof HoyolabError) return { reachable: true, valid: false };
        return { reachable: false, valid: false };
      }
    },
    checkApi: async (baseUrl) => {
      try {
        const res = await fetch(baseUrl);
        return res.status < 500;
      } catch {
        return false;
      }
    },
    readConfig: () => readConfigReal(),
  };
}
