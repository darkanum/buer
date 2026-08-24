import { describe, it, expect } from 'vitest';
import {
  loadProperty,
  loadWeaponTypeMap,
  loadCharacters,
  loadWeapons,
  loadArtifactSets,
  loadSlotMain,
} from '../src/index.js';

describe('gi-data', () => {
  it('property map cobre os stats críticos e marca percentuais', () => {
    const p = loadProperty();
    expect(p[22]!.code).toContain('CRITICAL_HURT'); // CRIT DMG
    expect(p[22]!.isPercent).toBe(true);
  });

  it('weapon type map traduz os 5 encodings do HoYoLAB', () => {
    const { hoyolabToWt } = loadWeaponTypeMap();
    expect(Object.keys(hoyolabToWt).sort()).toEqual(['1', '10', '11', '12', '13']);
  });

  it('resolve o slug de um personagem conhecido (Kamisato Ayaka)', () => {
    const characters = loadCharacters();
    expect(characters[10000002]?.slug).toBe('kamisato-ayaka');
    expect(characters[10000002]?.rarity).toBe(5);
    expect(characters[10000002]?.element).toBe('cryo');
  });

  it('resolve o slug de uma arma conhecida (Dull Blade)', () => {
    const weapons = loadWeapons();
    expect(weapons[11101]?.slug).toBe('dull-blade');
    expect(weapons[11101]?.rarity).toBe(1);
  });

  it('slot-main da flor só permite HP flat', () => {
    const slotMain = loadSlotMain();
    const property = loadProperty();
    const flowerIds = slotMain[1] ?? [];
    expect(flowerIds).toEqual([2]);
    expect(property[2]!.goodKey).toBe('hp');
  });

  it('artifact set conhecido resolve slug e maxRarity', () => {
    const sets = loadArtifactSets();
    expect(sets[15006]?.slug).toBe('crimson-witch-of-flames');
    expect(sets[15006]?.maxRarity).toBe(5);
  });
});
