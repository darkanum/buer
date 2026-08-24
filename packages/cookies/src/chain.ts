import type { SessionProvider, HoyolabSession } from './provider.js';

/**
 * Thrown by {@link getSession} when every provider in the chain returned
 * `null`. The message names each provider that was tried (in order) and
 * tells the user how to unblock themselves, so it's safe to surface
 * directly on stderr/CLI output rather than needing to be caught and
 * rewritten by the caller.
 */
export class NoSessionError extends Error {}

/**
 * Tries each provider in {@link opts.providers}, in order, and returns the
 * first {@link HoyolabSession} produced. If every provider resolves to
 * `null`, throws {@link NoSessionError} listing which provider ids were
 * tried and how to supply a session manually.
 */
export async function getSession(opts: {
  providers: SessionProvider[];
}): Promise<HoyolabSession> {
  const tried: string[] = [];
  for (const provider of opts.providers) {
    tried.push(provider.id);
    const session = await provider.tryGet();
    if (session) return session;
  }

  throw new NoSessionError(
    `Sessão do HoYoLAB não encontrada. Tentei: ${tried.join(', ')}. ` +
      `Faça login com --login, ou cole o cookie com --cookie "ltoken_v2=...; ltuid_v2=...".`,
  );
}
