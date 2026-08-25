// @spike — this provider's end-to-end behaviour (real Chromium launch,
// real HoYoLAB login, real cookie capture) is only verified manually,
// per spike 2's checklist. Automated coverage here is limited to the
// pure `sessionFromStorageState` helper below (plus the launch-failure
// fallback, exercised via the `loadChromium` test seam); launching a
// real browser in CI is out of scope.

import type { HoyolabSession, SessionProvider } from './provider.js';

/**
 * Minimal shape of a single cookie as returned by Playwright's
 * `BrowserContext.storageState()` (and `.cookies()`). Declared locally —
 * rather than imported from the `playwright` package — so this module has
 * no *type-level* dependency on `playwright`: `sessionFromStorageState`
 * type-checks and runs whether or not `playwright` is installed.
 */
export interface StorageStateCookie {
  readonly name: string;
  readonly value: string;
  readonly domain?: string;
}

/** Minimal shape of a Playwright `storageState()` result. */
export interface StorageStateLike {
  readonly cookies: readonly StorageStateCookie[];
}

/**
 * Pure helper: extracts a {@link HoyolabSession} from a Playwright
 * `storageState()`-shaped object. Returns `null` if either `ltoken_v2` or
 * `ltuid_v2` is missing from `state.cookies`. Cookies with any other name
 * (or belonging to unrelated domains) are ignored.
 */
export function sessionFromStorageState(state: StorageStateLike): HoyolabSession | null {
  const byName = new Map(state.cookies.map((c) => [c.name, c.value]));
  const ltoken_v2 = byName.get('ltoken_v2');
  const ltuid_v2 = byName.get('ltuid_v2');
  if (!ltoken_v2 || !ltuid_v2) return null;
  return { ltoken_v2, ltuid_v2 };
}

// Deliberately *not* a string literal in the `import()` call inside
// `loadChromium()` below. With a literal specifier, `tsc` tries to
// resolve `playwright`'s module/type declarations at type-check time and
// fails outright (TS2307) whenever the optional package isn't installed.
// Reading the specifier out of a plain (non-const-literal) variable makes
// TypeScript treat the whole `import()` expression as untyped (`any`) and
// skip module resolution for it entirely — verified directly against this
// package's tsconfig; see task-5.3 report for the before/after. That's
// what lets `playwright` live in `optionalDependencies` (package.json)
// without ever becoming a *type* dependency: installing this package
// never requires `playwright` (or its ~150MB Chromium download) to be
// present just to typecheck or build.
let playwrightModuleSpecifier = 'playwright';

const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const HOYOLAB_URL = 'https://www.hoyolab.com';

interface PageLike {
  goto(url: string): Promise<unknown>;
}

interface BrowserContextLike {
  newPage(): Promise<PageLike>;
  storageState(): Promise<StorageStateLike>;
  close(): Promise<void>;
}

interface BrowserLike {
  newContext(): Promise<BrowserContextLike>;
  close(): Promise<void>;
}

interface ChromiumLike {
  launch(options: { headless: boolean }): Promise<BrowserLike>;
}

export interface EmbeddedProviderOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
  /**
   * Test seam: overrides how the `chromium` launcher namespace is
   * obtained, bypassing the dynamic `import('playwright')` entirely.
   * Defaults to importing `playwright` for real and returning its
   * `chromium` export. Inject a fake here (e.g. one whose `launch()`
   * rejects) to unit-test `tryGet()`'s "browser could not be launched
   * (Chromium binary not downloaded, etc.) → resolve null, never throw"
   * behavior without installing `playwright` or spawning a real browser.
   */
  loadChromium?: () => Promise<ChromiumLike>;
}

/** Best-effort close: a failed `close()` must never mask `tryGet()`'s real result (or the fallback already chosen by the catch that's cleaning up). */
async function safeClose(closable: { close(): Promise<void> } | undefined): Promise<void> {
  if (!closable) return;
  try {
    await closable.close();
  } catch {
    // Cleanup failure is not worth surfacing — see comment above.
  }
}

/** Real (non-test) implementation of the `loadChromium` seam: dynamically imports `playwright` and returns its `chromium` launcher. Rejects if `playwright` isn't installed. */
async function loadChromiumFromPlaywright(): Promise<ChromiumLike> {
  const playwright = (await import(playwrightModuleSpecifier)) as { chromium: ChromiumLike };
  return playwright.chromium;
}

/**
 * Opens an embedded Chromium window on hoyolab.com via Playwright and
 * waits for the user to log in by hand, polling the browser context's
 * cookies until both `ltoken_v2` and `ltuid_v2` show up (or the timeout
 * elapses).
 *
 * `playwright` is an *optional* dependency (see package.json
 * `optionalDependencies`) so installing this package — or the CLI that
 * depends on it — never forces a Chromium download. `tryGet()` never
 * throws, in either of two distinct failure modes:
 *
 * 1. `playwright` isn't installed at all (the dynamic import rejects).
 * 2. `playwright` *is* installed but `chromium.launch()` (or any
 *    automation step after it — new context/page, navigation, polling)
 *    fails — the common real-world case, since the Chromium binary is
 *    only ever fetched by a separate, manual `playwright install` step
 *    that nothing runs automatically.
 *
 * Either way it logs a note on stderr and resolves to `null` — the same
 * "not found" contract every other {@link SessionProvider} in this
 * package follows — so `getSession()`'s fallback chain can move on to
 * the next provider (or its own `NoSessionError`) instead of the whole
 * chain dying with a raw Playwright stack trace.
 */
export class EmbeddedProvider implements SessionProvider {
  readonly id = 'embedded';

  constructor(private readonly opts: EmbeddedProviderOptions = {}) {}

  async tryGet(): Promise<HoyolabSession | null> {
    let chromium: ChromiumLike;
    try {
      chromium = await (this.opts.loadChromium ?? loadChromiumFromPlaywright)();
    } catch {
      console.warn(
        '[cookies] playwright não está instalado; provider "embedded" indisponível. ' +
          'Rode `pnpm add playwright` (ele é uma optionalDependency deste pacote) e ' +
          '`npx playwright install chromium` para habilitá-lo.',
      );
      return null;
    }

    let browser: BrowserLike | undefined;
    try {
      browser = await chromium.launch({ headless: false });
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        await page.goto(HOYOLAB_URL);

        const pollIntervalMs = this.opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
        const deadline = Date.now() + (this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

        while (Date.now() < deadline) {
          const session = sessionFromStorageState(await context.storageState());
          if (session) return session;
          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        }
        return null;
      } finally {
        await safeClose(context);
      }
    } catch {
      // Covers `chromium.launch()` itself failing — most commonly because
      // `playwright` the npm package is present (it's an
      // optionalDependency) but its Chromium binary was never downloaded
      // — plus any automation failure after a successful launch
      // (newContext/newPage/goto/storageState throwing, browser crashing
      // mid-session, etc.). Same contract either way: resolve null, never
      // throw, so the fallback chain keeps moving.
      console.warn(
        '[cookies] falha ao abrir/usar o navegador embutido (o Chromium do Playwright está ' +
          'instalado? rode `npx playwright install chromium`). Provider "embedded" indisponível.',
      );
      return null;
    } finally {
      await safeClose(browser);
    }
  }
}
