export type Element = 'pyro'|'hydro'|'cryo'|'electro'|'anemo'|'geo'|'dendro';
export type CharacterKey = string & { readonly __brand: 'CharacterKey' };
export type WeaponKey = string & { readonly __brand: 'WeaponKey' };
export type ArtifactSetKey = string & { readonly __brand: 'ArtifactSetKey' };

const TRAVELER_IDS = new Set([10000005, 10000007]);

export function charKey(avatarId: number, element?: Element): CharacterKey {
  if (TRAVELER_IDS.has(avatarId)) {
    if (!element) throw new Error(`Traveler ${avatarId} exige elemento`);
    return `${avatarId}:${element}` as CharacterKey;
  }
  return String(avatarId) as CharacterKey;
}

export function parseCharKey(k: CharacterKey): { avatarId: number; element?: Element } {
  const [id, el] = k.split(':');
  return el ? { avatarId: Number(id), element: el as Element } : { avatarId: Number(id) };
}
