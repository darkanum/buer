import { defineConfig } from 'drizzle-kit';

// Migrations in this package are hand-authored (drizzle/0000_init.sql) because
// Drizzle cannot express PARTITION BY, concrete partitions, or a
// `GENERATED ALWAYS AS (...) STORED` column (see src/schema/app.ts). This
// config is declared for `drizzle-kit` tooling (e.g. future `drizzle-kit
// check`/introspection) and is not run in CI.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    // Direct (non-pooled) connection string — required for DDL/migrations.
    url: process.env.DATABASE_URL_DIRECT!,
  },
});
