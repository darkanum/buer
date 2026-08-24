import { readConfig, writeConfig, type Config } from '../config.js';

export interface LoginOptions {
  /** Overrides the persisted `apiBaseUrl` (default: keep whatever was configured before). */
  apiBaseUrl?: string;
}

/**
 * Persists the Buer API token (never the HoYoLAB cookie — that one
 * never touches disk). Preserves the existing `apiBaseUrl` unless
 * `opts.apiBaseUrl` overrides it.
 */
export function runLogin(token: string, opts: LoginOptions = {}): Config {
  if (!token) {
    throw new Error('login precisa de um token: `buer login <token>`.');
  }
  const existing = readConfig();
  const cfg: Config = {
    apiToken: token,
    apiBaseUrl: opts.apiBaseUrl ?? existing.apiBaseUrl,
  };
  writeConfig(cfg);
  return cfg;
}
