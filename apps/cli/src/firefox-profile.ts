import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Where Firefox keeps its profiles, per platform. */
function firefoxRootDir(platform: NodeJS.Platform = process.platform): string | null {
  switch (platform) {
    case 'win32':
      return process.env.APPDATA ? join(process.env.APPDATA, 'Mozilla', 'Firefox') : null;
    case 'darwin':
      return join(homedir(), 'Library', 'Application Support', 'Firefox');
    default:
      return join(homedir(), '.mozilla', 'firefox');
  }
}

/**
 * Pure parser for Firefox's `profiles.ini` — picks the profile marked
 * `Default=1` under an `[InstallXXXX]` section (modern Firefox), falling
 * back to the first `[ProfileN]` section with `Default=1`, then to the
 * first `[ProfileN]` section at all. Returns the profile's `Path` value
 * plus whether it's relative (`IsRelative=1`) so the caller can resolve it
 * against `rootDir`.
 */
export function parseProfilesIni(ini: string): { path: string; isRelative: boolean } | null {
  const sections: { name: string; lines: string[] }[] = [];
  let current: { name: string; lines: string[] } | null = null;
  for (const rawLine of ini.split(/\r?\n/)) {
    const line = rawLine.trim();
    const header = /^\[(.+)]$/.exec(line);
    if (header?.[1]) {
      current = { name: header[1], lines: [] };
      sections.push(current);
    } else if (current && line) {
      current.lines.push(line);
    }
  }

  const get = (lines: string[], key: string): string | undefined => {
    for (const line of lines) {
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      if (line.slice(0, eq).trim() === key) return line.slice(eq + 1).trim();
    }
    return undefined;
  };

  // Modern Firefox: [InstallXXXX] sections point at the actually-used
  // default profile via `Default=<path>` (a path, not a boolean here).
  for (const s of sections) {
    if (s.name.startsWith('Install')) {
      const def = get(s.lines, 'Default');
      if (def) return { path: def, isRelative: true };
    }
  }

  // Older layout: [ProfileN] sections, `Default=1` marks the default one.
  const profiles = sections.filter((s) => /^Profile\d+$/.test(s.name));
  const defaultProfile = profiles.find((s) => get(s.lines, 'Default') === '1') ?? profiles[0];
  if (!defaultProfile) return null;
  const path = get(defaultProfile.lines, 'Path');
  if (!path) return null;
  const isRelative = get(defaultProfile.lines, 'IsRelative') !== '0';
  return { path, isRelative };
}

/**
 * Best-effort resolution of the default Firefox profile directory on this
 * machine. Never throws — returns `null` for "couldn't figure it out"
 * (Firefox not installed, `profiles.ini` missing/unreadable/unrecognized,
 * unknown platform layout, etc.) so callers can just skip the
 * `FirefoxProvider` in that case.
 */
export function defaultFirefoxProfileDir(): string | null {
  try {
    const root = firefoxRootDir();
    if (!root) return null;
    const iniPath = join(root, 'profiles.ini');
    if (!existsSync(iniPath)) return null;
    const parsed = parseProfilesIni(readFileSync(iniPath, 'utf8'));
    if (!parsed) return null;
    return parsed.isRelative ? join(root, parsed.path) : parsed.path;
  } catch {
    return null;
  }
}
