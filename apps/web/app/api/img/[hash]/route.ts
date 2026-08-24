// Task 8.4 — GET /api/img/[hash]: lazy mirror of third-party (HoYoLAB/Enka
// CDN) images into Cloudflare R2, served with an immutable Cache-Control.
// Spec: docs/superpowers/specs/2026-08-24-onewash-design.md §4.2.
//
// The actual branching logic (handleImg/ImgDeps/productionDeps) lives in
// ./handler.ts, not here: a Next.js `route.ts` may only export the
// whitelisted route-handler names (GET/POST/config/runtime/...) — any other
// named export fails `next build`'s generated route-type check (TS2344 in
// `.next/types/app/**/route.ts`). test/img.test.ts imports handleImg/ImgDeps
// straight from ./handler.js and only pulls this file's GET for one
// integration-style smoke test.

import { handleImg, productionDeps } from './handler.js';

// Next.js 16 App Router dynamic segments hand `params` in as a Promise (same
// convention as every other dynamic route since Next 15).
export async function GET(
  _req: Request,
  context: { params: Promise<{ hash: string }> },
): Promise<Response> {
  const { hash } = await context.params;
  return handleImg(productionDeps, hash);
}
