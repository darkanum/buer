/**
 * A HoYoLAB session extracted from a browser's cookie store: the two
 * cookies the Battle Chronicle API needs to authenticate a request.
 */
export interface HoyolabSession {
  ltoken_v2: string;
  ltuid_v2: string;
}

/**
 * A source that may be able to produce a {@link HoyolabSession} — e.g. by
 * reading a specific browser's cookie store. Implementations must never
 * throw for the "no session available" case (missing profile, missing
 * cookies, locked/corrupt store, etc.) — they return `null` instead, so
 * callers can try the next provider in a chain.
 */
export interface SessionProvider {
  /** Stable identifier for this provider, e.g. `'firefox'`. */
  readonly id: string;
  /**
   * Attempts to extract a session. Resolves to `null` (never rejects for
   * "not found") when no complete session is available.
   */
  tryGet(): Promise<HoyolabSession | null>;
}
