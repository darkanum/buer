import { defineConfig } from 'drizzle-kit';

// Better Auth's own tables (user/session/account/verification/apikey — see
// lib/auth-schema.ts) live in this app, separate from @buer/db's app/
// catalog schemas. The SQL under ./drizzle is generated from that file via
// `pnpm --filter @buer/web exec drizzle-kit generate` and is what
// test/helpers.ts feeds into PGlite for verifyApiKey's tests. Not run
// against a live DB in CI — `db:migrate` (drizzle-kit migrate) is for
// deploying it against DATABASE_URL_DIRECT.
export default defineConfig({
  dialect: 'postgresql',
  schema: './lib/auth-schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL_DIRECT ?? 'postgres://placeholder/placeholder',
  },
});
