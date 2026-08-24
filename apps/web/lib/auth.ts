import { apiKey } from '@better-auth/api-key';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { authSchema } from './auth-schema.js';
import { db } from './db.js';

/** Loose on purpose — matches `drizzleAdapter`'s own `db: DB` parameter type
 * ({@link https://github.com/better-auth/better-auth `@better-auth/drizzle-adapter`}),
 * so both the Postgres-backed `Database` from `@buer/db` (production) and
 * a `drizzle-orm/pglite` instance (tests, see test/helpers.ts) satisfy it. */
type DrizzleDb = Parameters<typeof drizzleAdapter>[0];

/**
 * Builds a Better Auth instance over the given Drizzle db handle.
 *
 * Exposed as a factory — not just the `auth` singleton below — so tests can
 * wire it to an in-memory PGlite db that carries Better Auth's own tables
 * (see test/helpers.ts and the "Testability" section of
 * .superpowers/sdd/2026-08-24-buer-fase-1/task-8.1-report.md): real
 * Better Auth logic, real (if ephemeral) storage, no live network.
 */
export function createAuth(database: DrizzleDb) {
  return betterAuth({
    database: drizzleAdapter(database, {
      provider: 'pg',
      schema: authSchema,
    }),
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL,
    // Vitest always sets VITEST=true for the test process (never in dev/
    // build/prod) — quiets Better Auth's own logger there so expected
    // outcomes (missing baseURL/social config in tests, "invalid API key"
    // in verifyApiKey's own negative test) don't print WARN/ERROR lines.
    logger: { disabled: Boolean(process.env.VITEST) },
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID ?? '',
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      },
      discord: {
        clientId: process.env.DISCORD_CLIENT_ID ?? '',
        clientSecret: process.env.DISCORD_CLIENT_SECRET,
      },
    },
    plugins: [
      apiKey({
        defaultPrefix: 'buer_live_',
        // disableKeyHashing stays false (the default): keys are hashed with
        // @better-auth/api-key's defaultKeyHasher, which is SHA-256.
        permissions: {
          defaultPermissions: { snapshots: ['write'] },
        },
        // Deliberately NOT enableSessionForAPIKeys: verifyApiKey below
        // resolves the key's owner directly via auth.api.verifyApiKey
        // instead of letting the plugin mock a session from the header.
      }),
      // Must be last in the plugins array (better-auth/next-js convention):
      // it wraps every other plugin's endpoints to set cookies via
      // next/headers' cookies() on the way out.
      nextCookies(),
    ],
  });
}

/** Production Better Auth instance, wired to the pooled Postgres db (lib/db.ts).
 * Consumed by the Next.js route handler (app/api/auth/[...all]/route.ts). */
export const auth = createAuth(db);

/**
 * Extracts the API-key token from a request: `Authorization: Bearer <token>`
 * first, `x-api-key` as a fallback. apps/cli's `postIngest` sends both
 * headers with the same token (see apps/cli/src/api.ts) so either order of
 * rollout on the client side keeps working.
 */
export function extractApiKeyToken(req: Request): string | null {
  const authHeader = req.headers.get('authorization');
  if (authHeader) {
    const match = /^Bearer\s+(.+)$/i.exec(authHeader);
    if (match?.[1]) return match[1];
  }
  return req.headers.get('x-api-key');
}

/**
 * Resolves the API token from `req` and returns its owning user, or `null`
 * when the token is absent or invalid. The user comes ONLY from the
 * verified key's `referenceId` — never from the request body.
 *
 * `authInstance` defaults to the production `auth` singleton; tests pass a
 * `createAuth(testDb)` instance (PGlite-backed, Better Auth's tables
 * migrated in, no rows) so the invalid-token path is exercised against real
 * Better Auth without a live Postgres/network dependency.
 */
export async function verifyApiKey(
  req: Request,
  authInstance: typeof auth = auth,
): Promise<{ userId: string } | null> {
  const token = extractApiKeyToken(req);
  if (!token) return null;

  try {
    const result = await authInstance.api.verifyApiKey({ body: { key: token } });
    if (!result.valid || !result.key) return null;
    return { userId: result.key.referenceId };
  } catch {
    return null;
  }
}
