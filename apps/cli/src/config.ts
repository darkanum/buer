import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Local CLI config. `apiToken` is the OneWash API token (never the HoYoLAB
 * cookie — that one is obtained in-memory per `sync` run and never
 * persisted). Optional because a freshly-installed CLI (or one that just
 * ran `logout`) has no token yet.
 */
export interface Config {
  apiToken?: string;
  apiBaseUrl: string;
}

/** Safe-to-print projection of {@link Config} — never carries the token. */
export interface RedactedConfig {
  paired: boolean;
  apiBaseUrl: string;
}

/** Default OneWash API base URL, used until `login` (or `--api-base-url`) overrides it. */
export const DEFAULT_API_BASE_URL = 'http://localhost:3000';

const CONFIG_DIR_NAME = '.genshin';
const CONFIG_FILE_NAME = 'config.json';

/**
 * Resolves the directory the config file lives in. `dir` is a test seam —
 * production callers always omit it and get `~/.genshin`.
 */
function resolveConfigDir(dir?: string): string {
  return dir ?? join(homedir(), CONFIG_DIR_NAME);
}

function resolveConfigPath(dir?: string): string {
  return join(resolveConfigDir(dir), CONFIG_FILE_NAME);
}

/**
 * Reads the local config. Returns `{ apiBaseUrl: DEFAULT_API_BASE_URL }`
 * (no `apiToken`) when the file doesn't exist yet — never throws for
 * "not configured yet".
 */
export function readConfig(dir?: string): Config {
  const path = resolveConfigPath(dir);
  if (!existsSync(path)) {
    return { apiBaseUrl: DEFAULT_API_BASE_URL };
  }
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<Config>;
  return {
    apiToken: parsed.apiToken,
    apiBaseUrl: parsed.apiBaseUrl ?? DEFAULT_API_BASE_URL,
  };
}

/**
 * Writes the local config with permission `0600` (owner read/write only —
 * this file may contain the OneWash API token). `writeFileSync`'s `mode`
 * only applies when the file is *created*; `chmodSync` afterwards makes
 * sure a pre-existing file (e.g. left over with looser permissions) ends
 * up `0600` too. Both are no-ops on win32 (no POSIX permission bits), but
 * harmless to call there.
 */
export function writeConfig(cfg: Config, dir?: string): void {
  const configDir = resolveConfigDir(dir);
  mkdirSync(configDir, { recursive: true });
  const path = resolveConfigPath(dir);
  writeFileSync(path, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Best-effort — e.g. unsupported/no-op on this platform.
  }
}

/** Removes the persisted OneWash API token; keeps `apiBaseUrl`. */
export function clearApiToken(dir?: string): Config {
  const cfg: Config = { apiBaseUrl: readConfig(dir).apiBaseUrl };
  writeConfig(cfg, dir);
  return cfg;
}

/**
 * Projects a {@link Config} down to what's safe to print: whether a token
 * is set, and the base URL. The token itself never appears here, in any
 * form — `whoami` prints exactly this.
 */
export function redactConfig(cfg: Config): RedactedConfig {
  return { paired: Boolean(cfg.apiToken), apiBaseUrl: cfg.apiBaseUrl };
}
