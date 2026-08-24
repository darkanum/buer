/**
 * Masking rules applied in order. Each pattern matches a secret token
 * *including* its `name=` prefix (for the cookie-style ones) so the
 * replacement can keep that prefix and only blank out the value — that
 * preserves context (e.g. "which cookie was it") without ever printing
 * the actual secret. Case-insensitive and global so every occurrence,
 * anywhere in the string (URL, header dump, stray log line, ...), is
 * caught, not just the first.
 */
const RULES: ReadonlyArray<{ re: RegExp; replacement: string }> = [
  { re: /ltoken_v2=[^;\s"'&]+/gi, replacement: 'ltoken_v2=[REDACTED]' },
  { re: /ltuid_v2=[^;\s"'&]+/gi, replacement: 'ltuid_v2=[REDACTED]' },
  { re: /cookie_token_v2=[^;\s"'&]+/gi, replacement: 'cookie_token_v2=[REDACTED]' },
  { re: /buer_live_[A-Za-z0-9_-]+/gi, replacement: 'buer_live_[REDACTED]' },
];

/**
 * Masks any HoYoLAB cookie (`ltoken_v2=`, `ltuid_v2=`, `cookie_token_v2=`)
 * or Buer API token (`buer_live_...`) found anywhere in `text` — cookie
 * header dumps, URLs with the cookie in a query string, plain error
 * messages, whatever. Everything else in the string is left untouched.
 *
 * This is the single choke point every error message must pass through
 * before it reaches stderr — see the global handler in `index.ts`.
 */
export function redact(text: string): string {
  return RULES.reduce((acc, { re, replacement }) => acc.replace(re, replacement), text);
}
