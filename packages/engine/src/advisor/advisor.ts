import type { CharacterKey, Element, RoleTag } from '@buer/core';
import type { MetaBank, TeamArchetypeData } from '@buer/meta';
import type {
  AcquisitionAdvice, AcquisitionCandidate, AdvisorPreferences, CoverageGap,
  InvestmentAxis, Provenance, Roster, RosterAdvisor,
} from '../interfaces.js';
import { matchArchetype } from '../team/matching.js';

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

function axisKey(axis: InvestmentAxis): string {
  switch (axis.kind) {
    case 'newCharacter': return `char:${String(axis.character)}`;
    case 'newWeapon': return `weapon:${String(axis.weapon)}`;
    case 'constellation': return `cons:${axis.from}->${axis.to}`;
    case 'refinement': return `refine:${axis.from}->${axis.to}`;
    case 'talent': return `talent:${axis.which}:${axis.from}->${axis.to}`;
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
        const candidates = [...bank.profiles.values()]
          .filter((p) => p.variants.some((v) => v.roles.some((r) => roles.includes(r))))
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

        if (owned && slot.minConstellation !== undefined && owned.constellation < slot.minConstellation) {
          axis = { kind: 'constellation', from: owned.constellation, to: slot.minConstellation };
        } else if (owned && slot.minRefinement !== undefined) {
          const weapon = roster.weapons.find((w) => w.equippedBy === named);
          axis = {
            kind: 'refinement',
            from: (weapon?.refinement ?? 1) as 1 | 2 | 3 | 4 | 5,
            to: slot.minRefinement as 1 | 2 | 3 | 4 | 5,
          };
        } else if (owned) {
          continue; // tem o personagem e ele atende: não é este que bloqueia
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
    // LIMITAÇÃO CONHECIDA: `axis.character` é, por definição, um personagem
    // que o jogador NÃO TEM (é por isso que virou eixo `newCharacter`). Este
    // lookup em `roster.characters` portanto nunca encontra nada e
    // `wantedElement` fica sempre `undefined` — o filtro por elemento abaixo
    // nunca liga de fato. Para consertar seria preciso o ELEMENTO do
    // personagem-alvo vindo de outro lugar que não o roster do jogador (ex.:
    // um catálogo de personagens em @buer/core ou @buer/meta que descreva
    // personagens não possuídos). Mantido como está por decisão do brief —
    // não corrigido aqui, fica para a revisão decidir.
    const wantedElement = bank.profiles.has(axis.character)
      ? roster.characters.get(axis.character)?.element
      : undefined;

    return [...roster.characters.keys()].filter((key) => {
      if (key === axis.character) return false;
      const profile = bank.profiles.get(key);
      if (!profile) return false;
      if (wantedElement !== undefined && roster.characters.get(key)?.element !== wantedElement) return false;
      return profile.variants.some((v) => v.roles.some((r) => wantedRoles.has(r)));
    });
  }
}
