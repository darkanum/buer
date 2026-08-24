import { db as makeDb, type Database } from '@onewash/db';

/**
 * Pooled Postgres connection for the web app (Next.js request-serving code),
 * built from @onewash/db's `db(url)` client factory — the same one
 * `apps/cli`'s server-side ingest route and future request handlers use.
 * Points at the pooled endpoint (e.g. Neon's pgbouncer proxy) via
 * `DATABASE_URL`.
 *
 * Constructing this does not open a network connection: the underlying
 * `pg.Pool` connects lazily on first query. So importing this module (e.g.
 * transitively through lib/auth.ts) is safe even when `DATABASE_URL` is
 * unset — as in `verifyApiKey`'s missing-token unit test, which never
 * touches the database.
 */
export const db: Database = makeDb(process.env.DATABASE_URL ?? '');
