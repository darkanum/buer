/**
 * CLI version reported in every `IngestEnvelope.cliVersion`. Kept as a
 * plain constant (rather than read from `package.json` at runtime) to
 * avoid a JSON import — bump alongside `package.json`'s `version` field.
 */
export const CLI_VERSION = '0.0.0';
