import { loadSlotMain, loadProperty } from '@buer/gi-data';
import { isRoleTag } from '@buer/core';
import type { RawMeta } from './types.js';
import { resolveCharacter, resolveSet, resolveWeapon } from './resolve.js';

const SCALES_ON = new Set(['atk', 'hp', 'def', 'eleMas']);
const AUTHORED_BY = new Set(['human', 'researched', 'researched-reviewed']);
const CONFIDENCE = new Set(['high', 'medium', 'low']);
const STRENGTH = new Set(['meta', 'strong', 'niche']);
const SLOT_ID = { sands: 3, goblet: 4, circlet: 5 } as const;

/** StatKeys legais por slot, derivados de gi-data (slot-main × property). */
function legalMainStats(): Readonly<Record<'sands' | 'goblet' | 'circlet', ReadonlySet<string>>> {
  const property = loadProperty();
  const slotMain = loadSlotMain();
  const build = (slot: 3 | 4 | 5): ReadonlySet<string> => {
    const ids = slotMain[slot] ?? [];
    const keys = new Set<string>();
    for (const id of ids) {
      const goodKey = property[id]?.goodKey;
      if (goodKey) keys.add(goodKey);
    }
    return keys;
  };
  return { sands: build(3), goblet: build(4), circlet: build(5) };
}

/**
 * Todo StatKey que o jogo conhece, derivado do mesmo `property.json` que
 * `legalMainStats` já usa (o `goodKey` não-nulo de cada property_type). É o
 * vocabulário fechado contra o qual `substats`, `targets` e
 * `targetOverrides` são validados — um nome inventado aqui não pode virar
 * "alvo não verificado" em silêncio (spec §5.5).
 */
function legalStatKeys(): ReadonlySet<string> {
  const property = loadProperty();
  const keys = new Set<string>();
  for (const entry of Object.values(property)) {
    if (entry.goodKey) keys.add(entry.goodKey);
  }
  return keys;
}

/** Confere um StatTarget (targets[] ou targetOverrides[]) contra o vocabulário de StatKey. */
function checkTargetStatKeys(
  target: { kind: string; stat?: string; numerator?: string; denominator?: string },
  legalStats: ReadonlySet<string>,
  where: string,
  problems: string[],
): void {
  if (target.stat !== undefined && !legalStats.has(target.stat)) {
    problems.push(`${where}: "${target.stat}" não é uma StatKey conhecida`);
  }
  if (target.numerator !== undefined && !legalStats.has(target.numerator)) {
    problems.push(`${where}: numerator "${target.numerator}" não é uma StatKey conhecida`);
  }
  if (target.denominator !== undefined && !legalStats.has(target.denominator)) {
    problems.push(`${where}: denominator "${target.denominator}" não é uma StatKey conhecida`);
  }
}

/**
 * Todas as regras da spec §5.5, num só lugar. Devolve a lista de problemas
 * em português — vazia significa íntegro. Coleta TUDO em vez de lançar no
 * primeiro erro: quem está autorando 120 fichas quer a lista inteira.
 */
export function validateMeta(raw: RawMeta): string[] {
  const problems: string[] = [];
  const legal = legalMainStats();
  const legalStats = legalStatKeys();
  const variantsByCharacter = new Map<string, Set<string>>();
  // Chave de dedupe é a CharacterKey resolvida, não o slug cru — é a chave
  // que `loadMeta()` de fato usa no Map, então é ali que uma colisão vira
  // uma ficha sobrescrevendo outra em silêncio.
  const seenCharacterKeys = new Map<string, string>();

  for (const profile of raw.profiles ?? []) {
    const where = `ficha "${profile.character}"`;

    if (profile.schemaVersion !== 1) problems.push(`${where}: schemaVersion deve ser 1`);
    const resolvedCharKey = resolveCharacter(profile.character);
    if (!resolvedCharKey) {
      problems.push(`${where}: slug de personagem não existe no catálogo do gi-data`);
    } else {
      const firstSeenAs = seenCharacterKeys.get(resolvedCharKey);
      if (firstSeenAs !== undefined) {
        problems.push(
          `${where}: personagem já tem ficha declarada em outro arquivo (também autorado como ` +
            `"${firstSeenAs}") — chave resolvida "${resolvedCharKey}" duplicada`,
        );
      } else {
        seenCharacterKeys.set(resolvedCharKey, profile.character);
      }
    }

    const prov = profile.provenance;
    if (!prov || !AUTHORED_BY.has(prov.authoredBy)) {
      problems.push(`${where}: authoredBy inválido`);
    }
    if (!prov || !CONFIDENCE.has(prov.confidence)) {
      problems.push(`${where}: confidence inválido`);
    }
    if (prov?.authoredBy === 'researched' && prov.confidence === 'high') {
      problems.push(
        `${where}: confidence "high" é proibido com authoredBy "researched" — ` +
          `promova para "researched-reviewed" só depois de revisar (spec §5.5)`,
      );
    }

    const seenVariants = new Set<string>();
    for (const variant of profile.variants ?? []) {
      const vwhere = `${where}, variante "${variant.id}"`;
      if (seenVariants.has(variant.id)) problems.push(`${vwhere}: id de variante duplicado`);
      seenVariants.add(variant.id);

      if (!SCALES_ON.has(variant.scalesOn)) problems.push(`${vwhere}: scalesOn inválido`);
      for (const role of variant.roles ?? []) {
        if (!isRoleTag(role)) problems.push(`${vwhere}: papel "${role}" fora do vocabulário fechado`);
      }

      for (const slot of ['sands', 'goblet', 'circlet'] as const) {
        for (const stat of variant.mainStats?.[slot] ?? []) {
          if (!legal[slot].has(stat)) {
            problems.push(`${vwhere}: "${stat}" não é main-stat legal para ${slot} (slot ${SLOT_ID[slot]})`);
          }
        }
      }

      const setRanks = new Set<number>();
      for (const option of variant.sets ?? []) {
        const expected = option.kind === '4pc' ? 1 : 2;
        if (option.sets.length !== expected) {
          problems.push(`${vwhere}: opção ${option.kind} deve listar ${expected} set(s)`);
        }
        for (const slug of option.sets) {
          if (!resolveSet(slug)) problems.push(`${vwhere}: set "${slug}" não existe no catálogo`);
        }
        if (setRanks.has(option.rank)) problems.push(`${vwhere}: rank de set duplicado (${option.rank})`);
        setRanks.add(option.rank);
      }

      const weaponRanks = new Set<number>();
      for (const option of variant.weapons ?? []) {
        if (!resolveWeapon(option.weapon)) {
          problems.push(`${vwhere}: arma "${option.weapon}" não existe no catálogo`);
        }
        if (weaponRanks.has(option.rank)) problems.push(`${vwhere}: rank de arma duplicado (${option.rank})`);
        weaponRanks.add(option.rank);
      }

      for (const stat of variant.substats ?? []) {
        if (!legalStats.has(stat)) {
          problems.push(`${vwhere}: substat "${stat}" não é uma StatKey conhecida`);
        }
      }

      for (const target of variant.targets ?? []) {
        if (!target.why || target.why.trim() === '') {
          problems.push(`${vwhere}: alvo ${target.kind} sem "why" — a explicação precisa dizer por quê`);
        }
        checkTargetStatKeys(target, legalStats, `${vwhere}, alvo ${target.kind}`, problems);
      }
    }
    variantsByCharacter.set(profile.character, seenVariants);
  }

  const seenArchetypes = new Set<string>();
  for (const archetype of raw.archetypes ?? []) {
    const where = `arquétipo "${archetype.id}"`;
    if (seenArchetypes.has(archetype.id)) problems.push(`${where}: id duplicado`);
    seenArchetypes.add(archetype.id);
    if (!STRENGTH.has(archetype.strength)) problems.push(`${where}: strength inválido`);
    if (archetype.slots.length < 2 || archetype.slots.length > 4) {
      problems.push(`${where}: um time tem de 2 a 4 slots, veio com ${archetype.slots.length}`);
    }

    for (const slot of archetype.slots) {
      for (const role of slot.role ?? []) {
        if (!isRoleTag(role)) problems.push(`${where}: papel "${role}" fora do vocabulário fechado`);
      }
      if (slot.requires.kind === 'character') {
        for (const slug of slot.requires.anyOf) {
          if (!resolveCharacter(slug)) problems.push(`${where}: personagem "${slug}" não existe no catálogo`);
          if (slot.variant && !variantsByCharacter.get(slug)?.has(slot.variant)) {
            problems.push(
              `${where}: slot exige variante "${slot.variant}" que a ficha de "${slug}" não declara`,
            );
          }
        }
      } else {
        for (const role of slot.requires.withRole ?? []) {
          if (!isRoleTag(role)) problems.push(`${where}: papel "${role}" fora do vocabulário fechado`);
        }
      }

      for (const override of slot.targetOverrides ?? []) {
        checkTargetStatKeys(override, legalStats, `${where}, targetOverrides ${override.kind}`, problems);
      }
    }
  }

  return problems;
}
