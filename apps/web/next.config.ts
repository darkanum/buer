import type { NextConfig } from 'next';

// --- Why this file isn't empty ------------------------------------------
//
// `apps/web` depends on workspace packages (`@buer/core`, `@buer/db`,
// `@buer/gi-data`) that ship TypeScript SOURCE ONLY — their
// `main`/`exports` point straight at `./src/index.ts`, there's no compiled
// `dist`. Two separate things then break `next build`:
//
// 1. Next does not run its TS/JS transform over code resolved from
//    `node_modules` by default (these workspace packages land there via
//    pnpm's symlinks) — hence `transpilePackages` below, so their `.ts`
//    sources get compiled like first-party app code instead of being
//    treated as pre-built, opaque dependencies.
//
// 2. Every package under `packages/*` (and this app's own `lib/*`) is
//    written against `tsconfig.base.json`'s `moduleResolution: "NodeNext"`,
//    which *requires* relative imports to use the emitted-`.js` extension
//    even though the actual file on disk is `.ts` (e.g. `./scrub.js` ->
//    `./scrub.ts`). `tsc` understands this convention natively. Turbopack
//    — Next 16's *default* build bundler — does not: it resolves `.js`
//    literally and has no equivalent of webpack's `resolve.extensionAlias`
//    to bridge the gap (open upstream issue, no workaround exists:
//    https://github.com/vercel/next.js/issues/82945). That's why the
//    `build` script in package.json passes `--webpack` — it opts back into
//    webpack, which we *do* configure with `extensionAlias` below.

const nextConfig: NextConfig = {
  // TS-source-only workspace packages: run them through Next's build
  // pipeline instead of treating them as pre-compiled node_modules code.
  transpilePackages: ['@buer/core', '@buer/db', '@buer/gi-data'],

  webpack(config) {
    // Let webpack follow NodeNext-style relative imports (`./scrub.js`)
    // through to their real `.ts`/`.tsx` source files — mirrors what `tsc`
    // already does under `moduleResolution: "NodeNext"`/`"bundler"`.
    config.resolve.extensionAlias = {
      '.js': ['.js', '.ts', '.tsx'],
      '.mjs': ['.mjs', '.mts'],
      '.cjs': ['.cjs', '.cts'],
    };
    return config;
  },
};

export default nextConfig;
