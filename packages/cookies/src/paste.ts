import type { SessionProvider, HoyolabSession } from './provider.js';

/**
 * Builds a {@link HoyolabSession} from a raw cookie string the user pastes
 * by hand — e.g. copied out of the browser devtools' "Cookies" panel as
 * `"ltoken_v2=...; ltuid_v2=..."`.
 *
 * Splits on `;` for each `name=value` pair, then on the *first* `=` within
 * each pair (cookie values, in particular `ltoken_v2`, routinely contain
 * `=` themselves — e.g. base64-ish padding — so splitting on every `=`
 * would truncate the value).
 */
export class PasteProvider implements SessionProvider {
  readonly id = 'paste';

  constructor(private readonly raw: string) {}

  async tryGet(): Promise<HoyolabSession | null> {
    const byName = new Map<string, string>();
    for (const part of this.raw.split(';')) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const name = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      byName.set(name, value);
    }

    const ltoken_v2 = byName.get('ltoken_v2');
    const ltuid_v2 = byName.get('ltuid_v2');
    if (!ltoken_v2 || !ltuid_v2) return null;
    return { ltoken_v2, ltuid_v2 };
  }
}
