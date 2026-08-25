import { slugForCharacter, slugForSet, slugForWeapon } from '@buer/meta';
import type { ArtifactSetKey, CharacterKey, WeaponKey } from '@buer/core';

/**
 * Tradutor de chave para nome legível, INJETADO em quem escreve prosa.
 *
 * O entregável é texto para humano ler (spec §11, §7.3), e chave é id
 * numérico: "Arma 13509 não está na ficha" não diz nada a ninguém. As cinco
 * verificações são funções PURAS de `Build` + `BuildVariant` e continuam
 * sendo — receber o tradutor como parâmetro não muda isso; o que mudaria
 * seria elas próprias abrirem o catálogo, e é justamente o que este tipo
 * existe para evitar.
 *
 * O fallback é a chave crua, nunca um nome inventado: personagem/arma/set de
 * patch novo que o catálogo ainda não conhece aparece pelo id, que é
 * verdade, em vez de por um rótulo que afirma origem falsa.
 */
export interface KeyNames {
  character(key: CharacterKey): string;
  weapon(key: WeaponKey): string;
  set(key: ArtifactSetKey): string;
}

export const defaultKeyNames: KeyNames = {
  character: (key) => slugForCharacter(key) ?? String(key),
  weapon: (key) => slugForWeapon(key) ?? String(key),
  set: (key) => slugForSet(key) ?? String(key),
};
