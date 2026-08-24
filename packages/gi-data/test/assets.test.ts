import { describe, it, expect } from 'vitest';
import { assetKey } from '../src/assets.js';

describe('assetKey', () => {
  it('é determinístico e preserva a extensão', () => {
    const u = 'https://act-webstatic.hoyoverse.com/x/UI_AvatarIcon_Furina.png';
    expect(assetKey(u)).toBe(assetKey(u));
    expect(assetKey(u)).toMatch(/\.png$/);
  });

  it('produz chaves diferentes para URLs diferentes', () => {
    const a = 'https://act-webstatic.hoyoverse.com/x/UI_AvatarIcon_Furina.png';
    const b = 'https://act-webstatic.hoyoverse.com/x/UI_AvatarIcon_Neuvillette.png';
    expect(assetKey(a)).not.toBe(assetKey(b));
  });

  it('preserva a extensão para outros formatos de imagem', () => {
    expect(assetKey('https://example.com/icon.webp')).toMatch(/\.webp$/);
    expect(assetKey('https://example.com/icon.jpg?v=2')).toMatch(/\.jpg$/);
  });
});
