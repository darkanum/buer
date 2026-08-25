/**
 * Better Auth's own tables (user, session, account, verification, apikey).
 *
 * Hand-authored to match Better Auth 1.7.1's internal field contracts —
 * verified against the installed packages' type declarations:
 *   - `@better-auth/core/dist/db/schema/{user,session,account,verification}.d.mts`
 *     (the `userSchema`/`sessionSchema`/`accountSchema`/`verificationSchema`
 *     zod shapes better-auth's core builds on)
 *   - `@better-auth/api-key/dist/types-*.d.mts` (the `apikey` table's field
 *     list, incl. `configId` defaulting to `"default"` and `key`/`permissions`
 *     /`metadata` being stored as strings)
 *
 * These tables are intentionally separate from `@buer/db`'s `app`/`catalog`
 * Postgres schemas (see packages/db/src/schema) — they live in the default
 * `public` schema of the same database, own migration lineage
 * (apps/web/drizzle/*.sql, generated from this file via `drizzle-kit
 * generate`; see apps/web/drizzle.config.ts), and are never referenced by
 * `@buer/db`'s Drizzle schema. `lib/auth.ts` wires Better Auth's Drizzle
 * adapter directly to this schema, on the same Postgres connection as
 * `@buer/db`'s pooled client (see lib/db.ts).
 *
 * The npm package that carries the `apiKey` plugin as of better-auth 1.7 is
 * `@better-auth/api-key` (NOT bundled into the `better-auth` core package's
 * plugin export anymore — see task-8.1-report.md for details).
 */
import { boolean, integer, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  emailVerified: boolean('email_verified').notNull(),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (t) => [unique('user_email_unique').on(t.email)]);

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  token: text('token').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (t) => [unique('session_token_unique').on(t.token)]);

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  // Added in better-auth 1.7: the stable provider-side issuer, distinct from
  // `providerId` (see `createLocalAccountIssuer`/`createOAuthAccountIssuer`
  // in @better-auth/core/dist/db/schema/account.d.mts).
  issuer: text('issuer').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

/**
 * The `apiKey` plugin's table (from `@better-auth/api-key`). `referenceId`
 * is the owning user's id (this app only enables `references: "user"`, no
 * organization plugin) — `verifyApiKey` in lib/auth.ts reads it as the
 * ingest request's `userId`. `key` holds the SHA-256 hash of the token
 * (better-auth's `defaultKeyHasher`), never the plaintext key.
 */
export const apikey = pgTable('apikey', {
  id: text('id').primaryKey(),
  configId: text('config_id').notNull().default('default'),
  name: text('name'),
  start: text('start'),
  prefix: text('prefix'),
  key: text('key').notNull(),
  referenceId: text('reference_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  refillInterval: integer('refill_interval'),
  refillAmount: integer('refill_amount'),
  lastRefillAt: timestamp('last_refill_at', { withTimezone: true }),
  enabled: boolean('enabled').notNull().default(true),
  rateLimitEnabled: boolean('rate_limit_enabled').notNull().default(true),
  rateLimitTimeWindow: integer('rate_limit_time_window'),
  rateLimitMax: integer('rate_limit_max'),
  requestCount: integer('request_count').notNull().default(0),
  remaining: integer('remaining'),
  lastRequest: timestamp('last_request', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  // Stored as strings (JSON-encoded) — matches @better-auth/api-key's field
  // types (`type: "string"` for both; see types-y22rgFHR.d.mts).
  permissions: text('permissions'),
  metadata: text('metadata'),
}, (t) => [unique('apikey_key_unique').on(t.key)]);

/** Bundled for `drizzleAdapter(db, { schema: authSchema, ... })` in lib/auth.ts. */
export const authSchema = { user, session, account, verification, apikey };
