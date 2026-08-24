// Split out of actions.ts: a `'use server'` file may only export async
// functions (Next.js Server Actions rule — see
// https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations#with-client-components,
// "Only async functions are allowed to be exported in a 'use server' file").
// `ONBOARDING_TOKEN_COOKIE` is a plain string constant shared by
// `actions.ts` (sets the cookie) and `page.tsx` (reads it back), so it lives
// in its own ordinary module instead.

export const ONBOARDING_TOKEN_COOKIE = 'ow_onboarding_token';
