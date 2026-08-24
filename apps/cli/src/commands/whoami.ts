import { readConfig, redactConfig, type RedactedConfig } from '../config.js';

/** Returns whether the CLI is paired and which API base URL it uses — never the token. */
export function runWhoami(): RedactedConfig {
  return redactConfig(readConfig());
}
