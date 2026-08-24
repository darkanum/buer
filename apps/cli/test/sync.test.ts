import { describe, it, expect, vi } from 'vitest';
import { runSync } from '../src/commands/sync.js';

const deps = {
  getSession: async () => ({ ltoken_v2: 'x', ltuid_v2: '1' }),
  makeClient: () => ({ fetchAll: async () => ({
    list: { list: [] }, detail: { list: [] },
    account: { gameUid: '8', region: 'os_asia', nickname: 'T' } }) }),
  postIngest: vi.fn(async () => ({ changedChars: 3 })),
  readConfig: () => ({ apiToken: 'buer_live_x', apiBaseUrl: 'http://x' }),
};

describe('runSync', () => {
  it('envia o envelope e resume as mudanças', async () => {
    const r = await runSync(deps as any, {});
    expect(deps.postIngest).toHaveBeenCalledOnce();
    expect(r.changed).toBe(3);
    expect(r.sent).toBe(true);
  });
  it('--dry-run não envia', async () => {
    const p = vi.fn();
    await runSync({ ...deps, postIngest: p } as any, { dryRun: true });
    expect(p).not.toHaveBeenCalled();
  });
});
