import {
  artifactFingerprint, charKey, extractObservedStats, propKey, reconstructTiers,
  type ArtifactSetKey, type CharacterKey, type Element, type ObservedStats, type StatKey,
} from '@buer/core';
import { loadArtifactSets } from '@buer/gi-data';
import type {
  ArtifactPiece, ArtifactSlot, Build, CharacterInstance, Roster, Substat, WeaponInstance,
} from '../interfaces.js';

const ARTIFACT_SETS = loadArtifactSets();

/**
 * `set.id` do HoYoLAB -> chave do catálogo do gi-data.
 *
 * São numerações DIFERENTES e a diferença é silenciosa: o payload traz
 * `2150031` onde o catálogo tem `15003`. Sem traduzir, `setKey` nunca casa
 * com nada que uma ficha declare, e a verificação de conjunto dá crédito
 * zero para toda build — errado, e sem sintoma.
 *
 * A relação, verificada nos 29 sets distintos da conta real de calibração
 * (29/29, todos de 7 dígitos, prefixo `2` e sufixo `1`):
 *   hoyolabId = 2_000_000 + giDataId * 10 + 1
 * de onde `giDataId = Math.floor((hoyolabId - 2_000_000) / 10)`.
 *
 * LANÇA para id que não resolve no catálogo, em vez de propagar uma chave
 * inventada: é a mesma disciplina de fail-loud do `sync.ts` do gi-data, e é
 * o que faz um set de patch novo aparecer como erro em vez de virar
 * "conjunto fora da ficha" para todos os usuários.
 */
export function artifactSetKeyFromHoyolab(hoyolabSetId: number): ArtifactSetKey {
  const candidate = Math.floor((hoyolabSetId - 2_000_000) / 10);
  if (ARTIFACT_SETS[candidate]) return String(candidate) as ArtifactSetKey;
  throw new Error(
    `set de artefato ${hoyolabSetId} não resolve no catálogo do gi-data ` +
      `(tentou ${candidate}); rode 'pnpm --filter @buer/gi-data sync' se for set de patch novo`,
  );
}

const SLOT_BY_POS: Readonly<Record<number, ArtifactSlot>> = {
  1: 'flower', 2: 'plume', 3: 'sands', 4: 'goblet', 5: 'circlet',
};

const ELEMENTS: ReadonlySet<string> = new Set([
  'pyro', 'hydro', 'cryo', 'electro', 'anemo', 'geo', 'dendro',
]);

/**
 * Talento -> componente, pelo ÚLTIMO dígito do skill_id: 1 = ataque normal,
 * 2 = habilidade elemental, 5 = explosão elemental. Verificado nos 63
 * personagens da conta real: 62 têm exatamente 3 talentos `skill_type === 1`
 * nesse padrão, e o único fora da curva (Mona, que tem um 4º com final 3 —
 * o sprint alternativo) é absorvido porque só mapeamos 1/2/5 e ignoramos o
 * resto. Ordem do array NÃO é usada: ela não é garantida por contrato.
 */
function talentsOf(entry: Record<string, unknown>): CharacterInstance['talents'] {
  const talents = { auto: 0, skill: 0, burst: 0 };
  const skills = Array.isArray(entry['skills']) ? (entry['skills'] as Record<string, unknown>[]) : [];
  for (const skill of skills) {
    if (skill['skill_type'] !== 1) continue;
    const id = typeof skill['skill_id'] === 'number' ? skill['skill_id'] : null;
    const level = typeof skill['level'] === 'number' ? skill['level'] : 0;
    if (id === null) continue;
    const last = id % 10;
    if (last === 1) talents.auto = level;
    else if (last === 2) talents.skill = level;
    else if (last === 5) talents.burst = level;
  }
  return talents;
}

/**
 * Tiers de um substat. HoYoLAB manda `times` = rolls DEPOIS do inicial, então
 * a contagem real é `times + 1` (descoberta da Fase 1, verificada em ~494
 * substats). Quando não há tabela de tier verificada para a raridade — hoje
 * tudo que não é 5★ — devolvemos um tier placeholder POR ROLL em vez de um
 * só: a contagem de rolls é exata em qualquer raridade e é o que a
 * verificação de substats realmente consome; a qualidade do tier é o que
 * degrada, e quem consome sinaliza isso por `piece.rarity !== 5`.
 */
function tiersOf(rarity: 3 | 4 | 5, key: StatKey, value: number, rolls: number): (1 | 2 | 3 | 4)[] {
  try {
    return [...reconstructTiers(rarity, key, value, rolls)];
  } catch {
    return Array.from({ length: Math.max(1, rolls) }, () => 1 as const);
  }
}

/**
 * `ArtifactPiece.rarity` é `3 | 4 | 5` por contrato (`interfaces.ts`: "GOOD
 * aceita 3-5; 1/2 rejeitados na borda"). A conta real tem 3 peças 1★/2★
 * (fodder de nível 0, sem uso analítico) — rejeitadas aqui, na borda, em vez
 * de alargar o tipo para acomodá-las.
 */
function isRankedRarity(rarity: number): rarity is 3 | 4 | 5 {
  return rarity === 3 || rarity === 4 || rarity === 5;
}

function piecesOf(entry: Record<string, unknown>, owner: CharacterKey): ArtifactPiece[] {
  const relics = Array.isArray(entry['relics']) ? (entry['relics'] as Record<string, any>[]) : [];
  return relics
    .filter((relic) => isRankedRarity(relic['rarity'] as number))
    .map((relic): ArtifactPiece => {
      const rarity = relic['rarity'] as 3 | 4 | 5;
      const subs: [number, number, 1 | 2 | 3 | 4][] = [];
      const substats: Substat[] = [];

      for (const sub of (relic['sub_property_list'] ?? []) as Record<string, any>[]) {
        const key = propKey(sub['property_type'] as number);
        const value = Number.parseFloat(String(sub['value']).replace('%', ''));
        const rolls = (sub['times'] as number) + 1;
        const tiers = tiersOf(rarity, key, value, rolls);
        subs.push([sub['property_type'] as number, value, tiers[tiers.length - 1]!]);
        substats.push({ key, tiers, value, source: 'reconstructed' });
      }

      const mainValue = Number.parseFloat(String(relic['main_property']['value']));
      const base = {
        slot: relic['pos'] as 1 | 2 | 3 | 4 | 5,
        set: relic['set']['id'] as number,
        lvl: relic['level'] as number,
        rarity,
        main: [relic['main_property']['property_type'] as number, mainValue] as [number, number],
        subs,
      };

      return {
        fingerprint: artifactFingerprint(base),
        setKey: artifactSetKeyFromHoyolab(base.set),
        slot: SLOT_BY_POS[base.slot]!,
        rarity,
        level: base.lvl,
        mainStatKey: propKey(base.main[0]),
        substats,
        locked: false,
        equippedBy: owner,
      };
    });
}

/**
 * Payload cru do HoYoLAB (`{ list, detail }`, o mesmo que `--raw-out` grava)
 * -> `Roster` do motor.
 *
 * `capturedAt` e `lang` são parâmetros e não valores derivados do relógio de
 * propósito: o roster alimenta um golden file, e um timestamp implícito o
 * tornaria não-determinístico.
 */
export function rosterFromHoyolab(
  raw: unknown,
  opts: { capturedAt: string; lang: string },
): Roster {
  const detail = (raw as { detail?: { list?: unknown } })?.detail;
  const list = Array.isArray(detail?.list) ? (detail.list as Record<string, any>[]) : [];

  const characters = new Map<CharacterKey, CharacterInstance>();
  const observedStats = new Map<CharacterKey, ObservedStats>();
  const artifacts: ArtifactPiece[] = [];
  const weapons: WeaponInstance[] = [];

  for (const entry of list) {
    const base = entry['base'] as Record<string, any>;
    const rawElement = String(base['element'] ?? '').toLowerCase();
    const element = ELEMENTS.has(rawElement) ? (rawElement as Element) : undefined;
    const key = charKey(base['id'] as number, element);

    characters.set(key, {
      key,
      ...(element === undefined ? {} : { element }),
      level: (base['level'] as number) ?? 1,
      // O payload não expõe `base.promote_level` do PERSONAGEM (só o da arma)
      // — lacuna de disponibilidade herdada da Fase 1, registrada na §14.5 da
      // spec. Fica 0; a Fase 2 não usa ascensão, a Fase 3 vai precisar.
      ascension: 0,
      constellation: ((base['actived_constellation_num'] as number) ?? 0) as CharacterInstance['constellation'],
      talents: talentsOf(entry),
    });

    observedStats.set(key, extractObservedStats(entry));
    artifacts.push(...piecesOf(entry, key));

    const weapon = entry['weapon'] as Record<string, any> | undefined;
    if (weapon) {
      weapons.push({
        key: String(weapon['id']) as WeaponInstance['key'],
        level: (weapon['level'] as number) ?? 1,
        ascension: Math.min(6, Math.max(0, (weapon['promote_level'] as number) ?? 0)),
        refinement: (((weapon['affix_level'] as number) ?? 1) as 1 | 2 | 3 | 4 | 5),
        equippedBy: key,
      });
    }
  }

  return {
    schemaVersion: 1,
    characters,
    artifacts,
    weapons,
    observedStats,
    provenance: {
      source: 'hoyolab',
      completeness: 'full',
      capturedAt: opts.capturedAt,
      lang: opts.lang,
    },
  };
}

const EMPTY_SLOTS: Readonly<Record<ArtifactSlot, ArtifactPiece | null>> = {
  flower: null, plume: null, sands: null, goblet: null, circlet: null,
};

/** A build COMO ESTÁ EQUIPADA. É a única build que pode ter observedStats. */
export function equippedBuild(roster: Roster, key: CharacterKey): Build | null {
  const character = roster.characters.get(key);
  if (!character) return null;

  const weapon = roster.weapons.find((w) => w.equippedBy === key);
  if (!weapon) return null;

  const slots: Record<ArtifactSlot, ArtifactPiece | null> = { ...EMPTY_SLOTS };
  for (const piece of roster.artifacts) {
    if (piece.equippedBy === key) slots[piece.slot] = piece;
  }

  const observed = roster.observedStats.get(key);
  return {
    schemaVersion: 1,
    character,
    weapon,
    artifacts: slots,
    conditionals: {},
    ...(observed === undefined ? {} : { observedStats: observed }),
  };
}
