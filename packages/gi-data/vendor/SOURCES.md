# Provenance

These files are static Genshin Impact game-data JSONs, vendored (copied) rather than
fetched at build/sync time.

- **Origin**: Enka Network's public game-data store (`store/gi/*` on `enka.network`),
  which republishes decrypted-and-cleaned excerpts of miHoYo's own game-config data
  (avatar/weapon/relic excel tables + localization).
- **How they got here**: copied on 2026-08-24 from a research scratchpad
  (`C:\Users\darka\AppData\Local\Temp\claude\...\scratchpad\`) produced by an earlier
  research pass in this session that had already fetched them from Enka. Per this
  task's ruling, no network fetch was performed for Task 6.1 — the files below are a
  byte-for-byte copy of what that research pass already downloaded.
- **License / usage note**: this is game data used for stat/identity lookups only (ids →
  names/rarities/types), not game assets or code; no secrets or credentials are present.

## Files copied

| File | Source (Enka store/gi) | Purpose here |
|---|---|---|
| `avatars.json` | `store/gi/avatars.json` | avatar_id → element, weapon type, quality, name-hash, base/promote props |
| `weapons.json` | `store/gi/weapons.json` | weapon_id → rarity, weapon type, name-hash, base/promote props |
| `relics.json` | `store/gi/relics.json` | relic item_id → rarity/slot/set, plus `Sets` (set_id → name-hash + 1pc/2pc AddProps) |
| `relic_levels.json` | `store/gi/relic_levels.json` | per-rarity substat roll-value tables (not currently consumed by sync.ts in Fase 1; kept for the scaling-table cycle) |
| `locs.json` | `store/gi/locs.json` | text-hash → localized string, all languages (only `en` used by `sync.ts`) |

## Deliberately NOT vendored

- `allStat_gen.json` (~2.2MB, Genshin-Optimizer scaling/curve data) — out of scope for
  Fase 1 (identity/catalog only, no scaling tables). Deferred to the second cycle per
  the task ruling.

## Regenerating `data/*.json`

Run `pnpm --filter @buer/gi-data sync` — see `scripts/sync.ts`. It reads only the
files listed above (plus the hand-authored `data/property.json` and
`data/weapon-type.json`) and fails loudly (throws) if an expected field is missing, to
guard against source drift.
