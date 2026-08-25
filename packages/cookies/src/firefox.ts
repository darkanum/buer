import Database from 'better-sqlite3';
import { copyFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { SessionProvider, HoyolabSession } from './provider.js';

interface CookieRow {
  name: string;
  value: string;
}

/**
 * Reads a HoYoLAB session out of a Firefox profile's `cookies.sqlite`.
 *
 * Firefox keeps `cookies.sqlite` locked (and often in WAL mode) while it is
 * running, so this never opens the profile's file directly: it copies it to
 * a throwaway temp file first and opens that copy read-only. The copy is
 * removed again once the read is done (success or failure).
 *
 * Uses `better-sqlite3` rather than the built-in `node:sqlite` — see
 * task-5.1-report.md for why (short version: `node:sqlite` works fine under
 * plain Node, but vitest's module loader in this repo's toolchain fails to
 * resolve prefix-only builtins like `node:sqlite`, so it can't be used from
 * a test that must produce pristine output).
 */
export class FirefoxProvider implements SessionProvider {
  readonly id = 'firefox';

  constructor(private readonly opts: { profilePath: string }) {}

  async tryGet(): Promise<HoyolabSession | null> {
    const src = join(this.opts.profilePath, 'cookies.sqlite');
    if (!existsSync(src)) return null;

    const tmp = join(tmpdir(), `ow-${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2)}.sqlite`);
    try {
      copyFileSync(src, tmp);
    } catch {
      // Source exists but couldn't be copied (permissions, race with a
      // concurrent delete, etc.) — treat as "no session available".
      return null;
    }

    try {
      const db = new Database(tmp, { readonly: true });
      try {
        const rows = db
          .prepare(
            `SELECT name, value FROM moz_cookies
             WHERE host LIKE '%hoyolab.com' AND name IN ('ltoken_v2', 'ltuid_v2')`,
          )
          .all() as CookieRow[];

        const byName = new Map(rows.map((r) => [r.name, r.value]));
        const ltoken_v2 = byName.get('ltoken_v2');
        const ltuid_v2 = byName.get('ltuid_v2');
        if (!ltoken_v2 || !ltuid_v2) return null;
        return { ltoken_v2, ltuid_v2 };
      } finally {
        db.close();
      }
    } catch {
      // Copy exists but isn't a readable/valid sqlite db (corrupt file,
      // unexpected schema, etc.) — same contract as "not found": null.
      return null;
    } finally {
      try {
        unlinkSync(tmp);
      } catch {
        // Best-effort cleanup of the temp copy; a leftover temp file is not
        // worth failing the whole call over.
      }
    }
  }
}
