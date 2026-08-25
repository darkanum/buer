import { customType } from 'drizzle-orm/pg-core';

/**
 * Postgres `bytea`. drizzle-orm's pg-core has no built-in bytea column type
 * (see node_modules/drizzle-orm/pg-core/columns — no bytea.ts), so it is
 * modeled here via `customType` mapping to/from Node `Buffer`.
 *
 * DDL source of truth: drizzle/0000_init.sql.
 */
export const bytea = customType<{ data: Buffer }>({
  dataType() {
    return 'bytea';
  },
});
