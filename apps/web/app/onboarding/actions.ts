'use server';

// Server Action: generates a fresh CLI API token for the logged-in user.
//
// No secret is ever a literal in this source file — the only value that
// exists is whatever `auth.api.createApiKey` returns AT REQUEST TIME. It is
// relayed to the browser through a short-lived, httpOnly, path-scoped cookie
// (never a URL/query string — see the safety rule against putting sensitive
// data in URLs) set on the redirect response; `app/onboarding/page.tsx`
// reads it once on the next render. Better Auth stores only the SHA-256 hash
// of the key (see lib/auth.ts) — the plaintext is retrievable ONLY from this
// createApiKey() response, never again afterwards, so this cookie relay is
// the one chance to show it.

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '../../lib/auth.js';

export const ONBOARDING_TOKEN_COOKIE = 'ow_onboarding_token';

export async function generateOnboardingToken(): Promise<void> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/');

  const created = await auth.api.createApiKey({
    body: {
      userId: session.user.id,
      name: 'genshin sync (onboarding)',
      permissions: { snapshots: ['write'] },
    },
  });

  const cookieStore = await cookies();
  cookieStore.set(ONBOARDING_TOKEN_COOKIE, created.key, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/onboarding',
    maxAge: 30, // one render's worth of time — plenty to display it once, short enough to not linger
  });

  redirect('/onboarding');
}
