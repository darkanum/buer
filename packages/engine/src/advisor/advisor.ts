import { parseCharKey, type CharacterKey, type Element, type RoleTag } from '@buer/core';
import { loadCharacters } from '@buer/gi-data';
import type { MetaBank, TeamArchetypeData } from '@buer/meta';
import type {
  AcquisitionAdvice, AcquisitionCandidate, AdvisorPreferences, CoverageGap,
  InvestmentAxis, Provenance, Roster, RosterAdvisor,
} from '../interfaces.js';
import { matchArchetype } from '../team/matching.js';

// Catálogo de TODO personagem do jogo (possuído ou não), ao contrário de
// `roster.characters` que só conhece quem o jogador tem. Carregado uma vez
// no módulo — mesmo padrão de `roster/from-hoyolab.ts` com `loadArtifactSets`.
const CHARACTERS = loadCharacters();

/**
 * Elemento de um personagem QUALQUER, possuído ou não. `roster.characters`
 * não serve para isso: `axis.character`, em `redundancyFor`, é por
 * definição alguém que o jogador NÃO tem (achado Critical da revisão da
 * Task 10) — o lookup ali precisa do catálogo do gi-data, não do roster.
 */
function elementOf(key: CharacterKey): Element | undefined {
  const parsed = parseCharKey(key);
  if (parsed.element) return parsed.element; // Traveler: o elemento está na própria chave
  return CHARACTERS[parsed.avatarId]?.element as Element | undefined;
}

export interface CuratedRosterAdvisorOptions {
  readonly bank: MetaBank;
}

const SEVERITY: Readonly<Record<TeamArchetypeData['strength'], CoverageGap['severity']>> = {
  meta: 'critical',
  strong: 'notable',
  niche: 'minor',
};

const STRENGTH_ORDER: Readonly<Record<TeamArchetypeData['strength'], number>> = {
  meta: 0, strong: 1, niche: 2,
};

interface Blockage {
  readonly archetype: TeamArchetypeData;
  readonly slotIndex: number;
}

// Cada chave carrega o DONO (`of`/`weapon`) — não só o salto. Sem isso, dois
// personagens pedindo o mesmo salto (ex.: C0->C2) para arquétipos diferentes
// colapsam num candidato só, e o `axis` resultante não diz de quem é a
// constelação a subir (achado Important da revisão da Task 10).
function axisKey(axis: InvestmentAxis): string {
  switch (axis.kind) {
    case 'newCharacter': return `char:${String(axis.character)}`;
    case 'newWeapon': return `weapon:${String(axis.weapon)}`;
    case 'constellation': return `cons:${String(axis.of)}:${axis.from}->${axis.to}`;
    case 'refinement': return `refine:${String(axis.weapon)}:${axis.from}->${axis.to}`;
    case 'talent': return `talent:${String(axis.of)}:${axis.which}:${axis.from}->${axis.to}`;
    default: return 'artifact';
  }
}

export class CuratedRosterAdvisor implements RosterAdvisor {
  constructor(private readonly opts: CuratedRosterAdvisorOptions) {}

  /** Conta inteira: todo arquétipo do banco. */
  async advise(roster: Roster, _prefs: AdvisorPreferences): Promise<AcquisitionAdvice> {
    return this.build(roster, this.opts.bank.archetypes, undefined);
  }

  /** Escopo de um personagem: só os arquétipos que o incluem. */
  async adviseFor(subject: CharacterKey, roster: Roster): Promise<AcquisitionAdvice> {
    const element = roster.characters.get(subject)?.element;
    const relevant = this.opts.bank.archetypes.filter((archetype) =>
      archetype.slots.some((slot) =>
        slot.requires.kind === 'character'
          ? slot.requires.anyOf.includes(subject)
          : element !== undefined && slot.requires.element === element,
      ),
    );
    return this.build(roster, relevant, subject);
  }

  private build(
    roster: Roster,
    archetypes: readonly TeamArchetypeData[],
    subject: CharacterKey | undefined,
  ): AcquisitionAdvice {
    const { bank } = this.opts;
    const blockages: Blockage[] = [];

    for (const archetype of archetypes) {
      if (archetype.gameVersionRetired !== undefined) continue;
      const match = matchArchetype(archetype, roster, bank, subject === undefined ? {} : { require: subject });
      // Só "falta exatamente 1" vira conselho. Dois ou mais é longe demais
      // para ser acionável (spec §7.1).
      if (match.status !== 'blocked-by-one') continue;
      blockages.push({ archetype, slotIndex: match.missing[0]! });
    }

    const byAxis = new Map<string, { axis: InvestmentAxis; unlocks: Blockage[] }>();
    // Tipado com `blocked` (mutável, acumula IDs) em vez de `blockedArchetypes`
    // (readonly, da interface pública) porque este array é atualizado em
    // lugar (`existing.blocked.push`) enquanto os blockages são percorridos;
    // o formato público só nasce no `.map()` do `return` abaixo.
    const gaps: (CoverageGap & { blocked: string[] })[] = [];
    const gapIndex = new Map<string, CoverageGap & { blocked: string[] }>();

    for (const blockage of blockages) {
      const slot = blockage.archetype.slots[blockage.slotIndex]!;

      if (slot.requires.kind === 'element') {
        const element = slot.requires.element as Element;
        const roles = (slot.requires.withRole.length > 0 ? slot.requires.withRole : slot.role) as RoleTag[];
        const key = `${element}:${roles.join(',')}`;
        const existing = gapIndex.get(key);
        if (existing) {
          existing.blocked.push(blockage.archetype.id);
          continue;
        }
        // CORRIGIDO (achado da revisão da Task 12, ao ligar `coverageGaps` na
        // tela): faltava o filtro de ELEMENTO. Sem ele, um personagem com o
        // papel certo mas elemento errado (ex.: Noelle, geo, main-dps) entrava
        // na lista "com ficha no banco hoje" de uma lacuna de CRYO main-dps —
        // afirmando que alguém cobre um papel que ele, de fato, não cobre
        // (o mesmo tipo de rótulo com origem falsa que o contrato do produto
        // proíbe). `elementOf` (acima) resolve o elemento de QUALQUER
        // personagem do catálogo, possuído ou não — mesma função já usada em
        // `redundancyFor`.
        const candidates = [...bank.profiles.values()]
          .filter((p) => elementOf(p.character) === element && p.variants.some((v) => v.roles.some((r) => roles.includes(r))))
          .map((p) => String(p.character));
        const gap = {
          description:
            `Falta um personagem de ${element} que cumpra ${roles.join(' ou ')}. ` +
            (candidates.length > 0
              ? `Com ficha no banco hoje: ${candidates.join(', ')}.`
              : 'Nenhum personagem com ficha cobre esse papel ainda.'),
          missing: { element, roles },
          blockedArchetypes: [blockage.archetype.id],
          severity: SEVERITY[blockage.archetype.strength],
          blocked: [blockage.archetype.id],
        };
        gapIndex.set(key, gap);
        gaps.push(gap);
        continue;
      }

      for (const named of slot.requires.anyOf) {
        const owned = roster.characters.get(named);
        let axis: InvestmentAxis;

        const equippedWeapon = roster.weapons.find((w) => w.equippedBy === named);

        if (owned && slot.minConstellation !== undefined && owned.constellation < slot.minConstellation) {
          axis = { kind: 'constellation', of: named, from: owned.constellation, to: slot.minConstellation };
        } else if (owned && slot.minRefinement !== undefined && equippedWeapon !== undefined) {
          // `weapon` é obrigatório no eixo (identidade do INVESTIMENTO, não só
          // do salto — achado Important da revisão da Task 10): sem arma
          // equipada não há `WeaponKey` real para apontar, então não fabricamos
          // um refinamento de "arma nenhuma" (cai no `else if (owned) continue`).
          axis = {
            kind: 'refinement',
            weapon: equippedWeapon.key,
            from: equippedWeapon.refinement,
            to: slot.minRefinement as 1 | 2 | 3 | 4 | 5,
          };
        } else if (owned) {
          continue; // tem o personagem e ele atende (ou falta arma real p/ recomendar): não é este que bloqueia
        } else {
          axis = { kind: 'newCharacter', character: named };
        }

        const key = axisKey(axis);
        const entry = byAxis.get(key) ?? { axis, unlocks: [] };
        entry.unlocks.push(blockage);
        byAxis.set(key, entry);
      }
    }

    const candidates: AcquisitionCandidate[] = [...byAxis.values()]
      .map(({ axis, unlocks }): AcquisitionCandidate => {
        const provenance: Provenance = {
          evaluatorId: 'curated-advisor',
          kind: 'curated',
          gameVersion: unlocks[0]!.archetype.gameVersionAdded,
          datasetSha: bank.datasetSha,
          confidence: 'high',
          assumptions: [
            'destrava = contagem sobre o banco de arquétipos cruzado com o seu roster, não opinião',
            'NÃO estimamos quanto rende: isso exige o avaliador analítico da Fase 3',
            'não sabemos disponibilidade de gacha (limitado, padrão, evento, loja) — a viabilidade é sua',
          ],
          rosterCompleteness: roster.provenance.completeness,
          cacheKey: `curated-advisor:${bank.datasetSha}:${axisKey(axis)}`,
        };

        return {
          axis,
          unlocks: unlocks.map((b) => ({
            archetype: b.archetype as never,
            wasBlockedBy: [`slot ${b.slotIndex + 1} (${b.archetype.slots[b.slotIndex]!.role.join('/')})`],
          })),
          improves: [], // spec §8.4 — vazio por decisão, não por esquecimento
          redundancyWith: this.redundancyFor(axis, unlocks, roster),
          explanation: {
            summary:
              `Destrava ${unlocks.length} time(s): ` +
              unlocks.map((b) => b.archetype.label).join(', ') + '.',
            reasons: unlocks.map((b) => ({
              claim: `${b.archetype.label} (${b.archetype.strength}) está a um slot de distância.`,
              evidence: b.archetype.sources.join(' '),
            })),
            citations: [...new Set(unlocks.flatMap((b) => b.archetype.sources))],
          },
          provenance,
        } satisfies AcquisitionCandidate;
      })
      .sort((a, b) => {
        const byUnlocks = b.unlocks.length - a.unlocks.length;
        if (byUnlocks !== 0) return byUnlocks;
        const strengthA = Math.min(...a.unlocks.map((u) => STRENGTH_ORDER[u.archetype.strength]));
        const strengthB = Math.min(...b.unlocks.map((u) => STRENGTH_ORDER[u.archetype.strength]));
        return strengthA - strengthB;
      });

    return { candidates, coverageGaps: gaps.map(({ blocked, ...gap }) => ({ ...gap, blockedArchetypes: blocked })) };
  }

  /**
   * Quem você JÁ TEM que faz o mesmo trabalho. É a única parte do sistema
   * que ativamente desaconselha gastar — e por isso é a que constrói
   * confiança (spec §8.3).
   */
  private redundancyFor(
    axis: InvestmentAxis,
    unlocks: readonly Blockage[],
    roster: Roster,
  ): readonly CharacterKey[] {
    if (axis.kind !== 'newCharacter') return [];
    const { bank } = this.opts;

    const wantedRoles = new Set<string>();
    for (const blockage of unlocks) {
      for (const role of blockage.archetype.slots[blockage.slotIndex]!.role) wantedRoles.add(role);
    }
    // CORRIGIDO (achado Critical da revisão da Task 10): `axis.character` é,
    // por definição, um personagem que o jogador NÃO TEM — um lookup em
    // `roster.characters` nunca resolve. `elementOf` consulta o catálogo do
    // gi-data (todo personagem do jogo, possuído ou não), não o roster.
    // Sem isso, `redundancyWith` podia apontar alguém de OUTRO elemento como
    // "já faz esse trabalho", quando na prática essa pessoa não ocupa o slot
    // bloqueado — o pior tipo de falso-negativo na única parte do sistema
    // que ativamente desaconselha gastar.
    const wantedElement = elementOf(axis.character);

    return [...roster.characters.keys()].filter((key) => {
      if (key === axis.character) return false;
      const profile = bank.profiles.get(key);
      if (!profile) return false;
      if (wantedElement !== undefined && roster.characters.get(key)?.element !== wantedElement) return false;
      return profile.variants.some((v) => v.roles.some((r) => wantedRoles.has(r)));
    });
  }
}
