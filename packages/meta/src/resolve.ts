import { loadArtifactSets, loadCharacters, loadWeapons } from '@buer/gi-data';
import type { ArtifactSetKey, CharacterKey, WeaponKey } from '@buer/core';

function invert(catalog: Record<number | string, { slug: string }>): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const [id, entry] of Object.entries(catalog)) out.set(entry.slug, id);
  return out;
}

const CHARACTER_BY_SLUG = invert(loadCharacters());
const WEAPON_BY_SLUG = invert(loadWeapons());
const SET_BY_SLUG = invert(loadArtifactSets());

/**
 * Slug autorado -> CharacterKey (o mesmo formato que `charKey()` de
 * @buer/core produz: id numérico como string, ou `id:elemento` no caso do
 * Traveler). Devolve `null` para slug desconhecido — quem chama decide se
 * isso é erro de validação ou lacuna tolerável.
 *
 * Traveler é autorado como `aether:anemo` / `lumine:electro`: o slug antes
 * do `:`, o elemento depois. É a única forma composta.
 */
export function resolveCharacter(slug: string): CharacterKey | null {
  const [base, element] = slug.split(':');
  if (!base) return null;
  const id = CHARACTER_BY_SLUG.get(base);
  if (!id) return null;
  return (element ? `${id}:${element}` : id) as CharacterKey;
}

export function resolveWeapon(slug: string): WeaponKey | null {
  const id = WEAPON_BY_SLUG.get(slug);
  return id ? (id as WeaponKey) : null;
}

export function resolveSet(slug: string): ArtifactSetKey | null {
  const id = SET_BY_SLUG.get(slug);
  return id ? (id as ArtifactSetKey) : null;
}

const SLUG_BY_CHARACTER_ID: ReadonlyMap<string, string> = new Map(
  [...CHARACTER_BY_SLUG].map(([slug, id]) => [id, slug]),
);

/**
 * O caminho inverso: CharacterKey -> slug legível, para a saída de CLI e
 * qualquer tela. Traveler volta composto (`aether:anemo`). Devolve `null`
 * para personagem que o catálogo ainda não conhece — de patch novo, por
 * exemplo — e quem chama mostra a chave crua.
 */
export function slugForCharacter(key: CharacterKey): string | null {
  const [id, element] = String(key).split(':');
  if (!id) return null;
  const slug = SLUG_BY_CHARACTER_ID.get(id);
  if (!slug) return null;
  return element ? `${slug}:${element}` : slug;
}
