import type { CharacterKey, Element } from '@buer/core';
import type { ArchetypeSlotData, MetaBank, TeamArchetypeData } from '@buer/meta';
import type { Roster } from '../interfaces.js';

export interface ArchetypeMatch {
  readonly archetype: TeamArchetypeData;
  /** Um item por slot, na ordem do arquétipo. `null` = não preenchido. */
  readonly fills: readonly (CharacterKey | null)[];
  /** Índices dos slots que ficaram vazios. */
  readonly missing: readonly number[];
  readonly status: 'playable' | 'blocked-by-one' | 'too-far';
}

export interface MatchOptions {
  /** Personagem que TEM que estar no time (a visão centrada no personagem). */
  readonly require?: CharacterKey;
}

/** Todos os papéis que qualquer variante da ficha deste personagem declara. */
function rolesOf(bank: MetaBank, key: CharacterKey): ReadonlySet<string> {
  const profile = bank.profiles.get(key);
  const roles = new Set<string>();
  for (const variant of profile?.variants ?? []) for (const role of variant.roles) roles.add(role);
  return roles;
}

function meetsInvestment(slot: ArchetypeSlotData, roster: Roster, key: CharacterKey): boolean {
  if (slot.minConstellation !== undefined) {
    const character = roster.characters.get(key);
    if (!character || character.constellation < slot.minConstellation) return false;
  }
  if (slot.minRefinement !== undefined) {
    const weapon = roster.weapons.find((w) => w.equippedBy === key);
    if (!weapon || weapon.refinement < slot.minRefinement) return false;
  }
  return true;
}

/**
 * Quem, do roster, pode ocupar este slot.
 *
 * Slot FIXO casa por `requires`. Slot FLEX (`substitutable`) casa também por
 * PAPEL declarado na ficha — é o que faz um arquétipo autorado com o núcleo
 * ("Nilou + um dendro off-field") produzir times diferentes para jogadores
 * diferentes, sem o banco precisar enumerar toda composição possível.
 *
 * Personagem sem ficha nunca ocupa slot flex: não há como saber que papel
 * ele cumpre. É o custo aceito da decisão D4 (spec §14.2).
 */
function candidatesFor(slot: ArchetypeSlotData, roster: Roster, bank: MetaBank): CharacterKey[] {
  const owned = [...roster.characters.keys()].filter((key) => meetsInvestment(slot, roster, key));

  if (slot.requires.kind === 'character') {
    const named = new Set(slot.requires.anyOf);
    const exact = owned.filter((key) => named.has(key));
    if (!slot.substitutable) return exact;
    const wanted = new Set<string>(slot.role);
    const byRole = owned.filter((key) => [...rolesOf(bank, key)].some((r) => wanted.has(r)));
    return [...new Set([...exact, ...byRole])];
  }

  const element = slot.requires.element as Element;
  const wanted = new Set<string>(slot.requires.withRole.length > 0 ? slot.requires.withRole : slot.role);
  return owned.filter((key) => {
    if (roster.characters.get(key)?.element !== element) return false;
    return [...rolesOf(bank, key)].some((r) => wanted.has(r));
  });
}

/**
 * Atribuição EXATA por backtracking, maximizando slots preenchidos.
 *
 * Não é guloso de propósito: com escolha slot-a-slot, um personagem que serve
 * a dois slots pode ser consumido pelo primeiro e deixar o segundo vazio,
 * relatando um time como bloqueado quando ele é jogável. Com no máximo 4
 * slots e um roster de ~100, o exato é barato — a §6.5 da spec de Fase 1 já
 * marcou isso como `TeamSearcher.strategy: 'assignment'`.
 */
export function matchArchetype(
  archetype: TeamArchetypeData,
  roster: Roster,
  bank: MetaBank,
  opts: MatchOptions = {},
): ArchetypeMatch {
  const candidates = archetype.slots.map((slot) => candidatesFor(slot, roster, bank));

  // Slots com menos candidatos primeiro: poda muito mais cedo.
  const order = archetype.slots
    .map((_, index) => index)
    .sort((a, b) => (candidates[a]!.length || Infinity) - (candidates[b]!.length || Infinity));

  let bestFills: (CharacterKey | null)[] = archetype.slots.map(() => null);
  let bestCount = -1;

  const current: (CharacterKey | null)[] = archetype.slots.map(() => null);
  const used = new Set<CharacterKey>();

  const search = (position: number, filled: number): void => {
    if (bestCount === archetype.slots.length) return; // já achou perfeito
    if (position === order.length) {
      const hasRequired = opts.require === undefined || current.includes(opts.require);
      if (hasRequired && filled > bestCount) {
        bestCount = filled;
        bestFills = [...current];
      }
      return;
    }

    const slotIndex = order[position]!;
    for (const candidate of candidates[slotIndex]!) {
      if (used.has(candidate)) continue;
      current[slotIndex] = candidate;
      used.add(candidate);
      search(position + 1, filled + 1);
      used.delete(candidate);
      current[slotIndex] = null;
    }

    // Deixar o slot vazio também é um ramo válido: queremos saber QUANTOS
    // faltam, não só se dá para preencher todos.
    search(position + 1, filled);
  };

  search(0, 0);

  const missing = bestFills.map((fill, index) => (fill === null ? index : -1)).filter((i) => i >= 0);
  const status: ArchetypeMatch['status'] =
    missing.length === 0 ? 'playable' : missing.length === 1 ? 'blocked-by-one' : 'too-far';

  return { archetype, fills: bestFills, missing, status };
}
