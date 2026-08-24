const REPLACERS: Record<string, unknown> = {
  nickname: 'Traveler',
  game_uid: '800000000', gameUid: '800000000', uid: '800000000', role_id: '800000000',
  ltoken_v2: 'SCRUBBED', ltuid_v2: '0',
};
export function scrubRaw(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(scrubRaw);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      out[k] = k in REPLACERS ? REPLACERS[k] : scrubRaw(val);
    }
    return out;
  }
  return v;
}
