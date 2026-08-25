// Task 8.2 — POST /api/ingest: token -> envelope validation -> raw storage ->
// normalize -> writeSnapshot. Spec: docs/superpowers/specs/2026-08-24-onewash-design.md.
//
// The actual handler (handleIngest/IngestDeps/productionDeps) lives in
// ./handler.ts, not here: a Next.js `route.ts` may only export the
// whitelisted route-handler names (GET/POST/config/runtime/...) — any other
// named export fails `next build`'s generated route-type check (TS2344 in
// `.next/types/app/**/route.ts`). test/ingest.test.ts imports
// handleIngest/inlinePutRaw/IngestDeps straight from ./handler.js.

import { handleIngest, productionDeps } from './handler.js';

/**
 * Production route handler. Rate limiting per token is delegated to Better
 * Auth's `apiKey` plugin (see lib/auth.ts) — it already exposes a
 * `rateLimit: { enabled, window, max, storage }` option (and per-key
 * `rateLimitMax`/`rateLimitTimeWindow`/`rateLimitEnabled` overrides), just
 * not turned on yet (see task-8.2-report.md "Concerns"). WAF-per-IP is
 * infra config, out of code entirely.
 */
export async function POST(req: Request): Promise<Response> {
  return handleIngest(productionDeps, req);
}
