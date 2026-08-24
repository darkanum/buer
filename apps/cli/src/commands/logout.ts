import { clearApiToken, type Config } from '../config.js';

/** Removes the persisted Buer API token; keeps `apiBaseUrl` untouched. */
export function runLogout(): Config {
  return clearApiToken();
}
