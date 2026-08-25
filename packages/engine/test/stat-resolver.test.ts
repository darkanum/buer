import { describe, it, expect } from 'vitest';
import type { Build } from '../src/interfaces.js';
import { ObservedStatResolver } from '../src/stat-resolver.js';

const withStats = { observedStats: { atk: 2000, critRate_: 70 } } as unknown as Build;
const hypothetical = { conditionals: {} } as unknown as Build;

describe('ObservedStatResolver', () => {
  it('devolve os stats da build capturada', async () => {
    const resolver = new ObservedStatResolver();
    await expect(resolver.resolve(withStats)).resolves.toEqual({ atk: 2000, critRate_: 70 });
  });

  it('devolve null para build hipotética — não inventa número', async () => {
    const resolver = new ObservedStatResolver();
    await expect(resolver.resolve(hypothetical)).resolves.toBeNull();
  });

  it('tem id estável, que vai para a proveniência', () => {
    expect(new ObservedStatResolver().id).toBe('observed');
  });
});
