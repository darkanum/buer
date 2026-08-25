import { describe, it, expect } from 'vitest';
import { ROLE_TAGS, isRoleTag } from '../src/domain.js';

describe('vocabulário de papéis', () => {
  it('é fechado e tem exatamente os 9 papéis da spec §5.3', () => {
    expect([...ROLE_TAGS]).toEqual([
      'main-dps', 'sub-dps', 'buffer', 'debuffer',
      'healer', 'shielder', 'battery', 'driver', 'enabler',
    ]);
  });

  it('isRoleTag aceita papel do vocabulário e recusa qualquer outro', () => {
    expect(isRoleTag('battery')).toBe(true);
    expect(isRoleTag('main-dps')).toBe(true);
    expect(isRoleTag('carry')).toBe(false);
    expect(isRoleTag('')).toBe(false);
    expect(isRoleTag('Battery')).toBe(false);
  });
});
