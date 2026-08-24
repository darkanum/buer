// Task 8.3 — minimal session-to-account wiring shared by every screen.
//
// Deliberately NOT part of lib/render.ts: render.ts's functions are the
// pure/DB-only, PGlite-testable surface (see test/render.test.ts); this file
// is the thin, Next.js-coupled glue (Better Auth's server session +
// next/navigation's redirect()) that isn't meaningfully unit-testable
// without a running Next.js request context, so it stays out of the
// tested module and gets exercised by the screens themselves (reviewed by
// inspection, per the brief).

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from './auth.js';
import { db } from './db.js';
import { getAccountByOwner, type AccountSummary } from './render.js';

export interface CurrentUser {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
}

/** The logged-in Better Auth user, or `null` if there is no session. Never
 * throws — callers decide what "no session" means for their screen. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  return { userId: session.user.id, email: session.user.email, name: session.user.name };
}

/**
 * Requires a session AND an account (i.e. at least one prior sync). Redirects
 * (never returns) to `/` when there's no session, or to `/onboarding` when
 * the user has no `app.account` row yet — "a user only sees their OWN
 * account" per the brief: `getAccountByOwner` filters by `owner_id`, so
 * there is no code path here that can resolve a DIFFERENT user's account.
 */
export async function requireAccount(): Promise<{ user: CurrentUser; account: AccountSummary }> {
  const user = await getCurrentUser();
  if (!user) redirect('/');
  const account = await getAccountByOwner(db, user.userId);
  if (!account) redirect('/onboarding');
  return { user, account };
}
