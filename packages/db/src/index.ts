export { db, migrationClient } from './client.js';
export type { Database } from './client.js';
export * as schema from './schema/index.js';

// Task 3.2's transactional writer, missing from this barrel until now — 8.2's
// /api/ingest route (and any future caller) needs it as a package import,
// not a deep relative one (@buer/db's package.json only maps "." and
// "./schema").
export { writeSnapshot } from './ingest.js';
export type { IngestDb, WriteSnapshotArgs, WriteSnapshotResult } from './ingest.js';
