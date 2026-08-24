#!/usr/bin/env node
import { runLogin } from './commands/login.js';
import { runLogout } from './commands/logout.js';
import { runWhoami } from './commands/whoami.js';

export interface ParsedArgs {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

/**
 * Tiny hand-rolled arg parser — this CLI has a handful of subcommands and a
 * handful of `--flag [value]` options, not enough surface to justify a
 * dependency. `argv[0]` is the subcommand; everything after is either a
 * `--name value` pair (value consumed only when the next token isn't
 * itself a flag), a bare `--name` boolean flag, or a positional argument.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === undefined) continue;
    if (arg.startsWith('--')) {
      const name = arg.slice(2);
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[name] = next;
        i++;
      } else {
        flags[name] = true;
      }
    } else {
      positional.push(arg);
    }
  }

  return { command: command ?? '', positional, flags };
}

function flagString(flags: Record<string, string | boolean>, name: string): string | undefined {
  const v = flags[name];
  return typeof v === 'string' ? v : undefined;
}

function flagBoolean(flags: Record<string, string | boolean>, name: string): boolean {
  return Boolean(flags[name]);
}

const USAGE = 'uso: onewash <login|logout|whoami|sync|doctor> [opções]';

export async function main(argv: string[]): Promise<void> {
  const { command, positional, flags } = parseArgs(argv);

  switch (command) {
    case 'login': {
      const token = positional[0];
      if (!token) throw new Error('uso: onewash login <token>');
      const cfg = runLogin(token, { apiBaseUrl: flagString(flags, 'api-base-url') });
      console.log(`Token salvo. API base URL: ${cfg.apiBaseUrl}`);
      return;
    }
    case 'logout': {
      runLogout();
      console.log('Sessão local removida.');
      return;
    }
    case 'whoami': {
      console.log(JSON.stringify(runWhoami(), null, 2));
      return;
    }
    default:
      throw new Error(command ? `comando desconhecido: ${command}. ${USAGE}` : USAGE);
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exitCode = 1;
  });
}
