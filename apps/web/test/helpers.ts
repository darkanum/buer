import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { createAuth } from '../lib/auth.js';
import { authSchema, user } from '../lib/auth-schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const drizzleDir = join(here, '..', 'drizzle');

/** Concatenates every migration file under drizzle/*.sql, in filename order
 * (same pattern as packages/db/test/helpers.ts). */
async function loadMigrationSql(): Promise<string> {
  const files = (await readdir(drizzleDir)).filter((f) => f.endsWith('.sql')).sort();
  const parts = await Promise.all(files.map((f) => readFile(join(drizzleDir, f), 'utf8')));
  return parts.join('\n');
}

export interface TestAuth {
  /** A real Better Auth instance wired to the in-memory PGlite db below. */
  auth: ReturnType<typeof createAuth>;
  /** Inserts a minimal `user` row and returns its id, for tests that need
   * an API key's owner to exist (Better Auth's `apikey.reference_id` FK). */
  insertTestUser(email: string): Promise<string>;
}

/**
 * Spins up an in-memory PGlite instance, runs Better Auth's own migration
 * (drizzle/*.sql, generated from lib/auth-schema.ts via `drizzle-kit
 * generate` — see drizzle.config.ts), and wires a real Better Auth instance
 * to it via `createAuth`.
 *
 * This is what backs `verifyApiKey`'s "invalid token" test: with no rows
 * (or none matching), the key genuinely isn't found — no live Postgres, no
 * network, no stubbing of Better Auth's own verification logic.
 */
export async function makeTestAuth(): Promise<TestAuth> {
  const pglite = new PGlite();
  await pglite.exec(await loadMigrationSql());
  const db = drizzle(pglite, { schema: authSchema });

  async function insertTestUser(email: string): Promise<string> {
    const id = randomUUID();
    const now = new Date();
    await db.insert(user).values({
      id,
      name: email,
      email,
      emailVerified: false,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  }

  return { auth: createAuth(db), insertTestUser };
}
