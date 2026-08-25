import type { CharacterKey, Element, RoleTag } from '@buer/core';
import type { MetaBank, TeamArchetypeData } from '@buer/meta';
import type {
  ConstraintViolation, Explanation, Provenance, Roster, Score, TeamAssessment,
} from '../interfaces.js';
import type { StatResolver } from '../stat-resolver.js';
import { equippedBuild } from '../roster/from-hoyolab.js';
import { assess } from '../curated/scoring.js';
import { selectVariant } from '../curated/variant.js';
import { matchArchetype, rolesOf, type ArchetypeMatch } from './matching.js';
import { reactionsFor, resonanceFor } from './rules.js';

export interface TeamOption {
  readonly match: ArchetypeMatch;
  readonly assessment: TeamAssessment;
  /** Qual critério decidiu a posição deste time na lista (spec §7.1). */
  readonly rankedBy: 'strength' | 'targets' | 'declared';
}

export interface TeamsForResult {
  readonly playable: readonly TeamOption[];
  readonly blocked: readonly TeamOption[];
}

export interface CuratedTeamEvaluatorOptions {
  readonly bank: MetaBank;
  readonly resolver: StatResolver;
}

const STRENGTH_ORDER: Readonly<Record<TeamArchetypeData['strength'], number>> = {
  meta: 0,
  strong: 1,
  niche: 2,
};

interface SlotOutcome {
  readonly slotIndex: number;
  readonly character: CharacterKey | null;
  readonly variantLabel: string | null;
  readonly variantId: string | null;
  readonly meetsHardTargets: boolean;
  readonly requiredEr: number | null;
  readonly actualEr: number | null;
  readonly line: string;
}

export class CuratedTeamEvaluator {
  constructor(private readonly opts: CuratedTeamEvaluatorOptions) {}

  /**
   * A visão centrada no personagem: para X, quais times o roster do jogador
   * consegue formar hoje, e quais ficam a um slot de distância.
   *
   * Só arquétipos curados (decisão D4). Personagem fora do banco devolve as
   * duas listas vazias — não se inventa time (spec §14.2).
   */
  async teamsFor(subject: CharacterKey, roster: Roster): Promise<TeamsForResult> {
    const { bank } = this.opts;
    const playable: TeamOption[] = [];
    const blocked: TeamOption[] = [];

    for (const archetype of bank.archetypes) {
      if (archetype.gameVersionRetired !== undefined) continue;

      // Espelha `candidatesFor` (matching.ts): slot de personagem FLEX casa
      // também por papel declarado na ficha, não só pelo `anyOf` nomeado —
      // senão um arquétipo só alcançável por um slot desses é descartado
      // aqui, antes de `matchArchetype` sequer rodar (achado de revisão).
      const canHost = archetype.slots.some((slot) => {
        if (slot.requires.kind === 'character') {
          if (slot.requires.anyOf.includes(subject)) return true;
          if (!slot.substitutable) return false;
          const wanted = new Set<string>(slot.role);
          return [...rolesOf(bank, subject)].some((r) => wanted.has(r));
        }
        return roster.characters.get(subject)?.element === slot.requires.element;
      });
      if (!canHost) continue;

      const match = matchArchetype(archetype, roster, bank, { require: subject });
      if (match.status === 'too-far') continue;

      const option = { match, assessment: await this.assessTeam(match, roster) };
      if (match.status === 'playable') playable.push({ ...option, rankedBy: 'strength' });
      else blocked.push({ ...option, rankedBy: 'strength' });
    }

    return { playable: this.rank(playable), blocked: this.rank(blocked) };
  }

  /**
   * `strength` curado primeiro; empate desfeito por quantos slots cumprem os
   * alvos duros; empate persistente pela ordem declarada no banco. Cada time
   * carrega qual critério o posicionou — nunca um número sem origem.
   */
  private rank(options: TeamOption[]): TeamOption[] {
    // `score.value` JÁ É "quantos slots cumprem os alvos duros" — computado
    // uma vez em `assessTeam` como `outcomes.filter(o => o.meetsHardTargets)`.
    // Uma métrica separada aqui (ex.: só ER) rotularia `rankedBy: 'targets'`
    // com uma origem que não é a que decidiu de fato (achado de revisão).
    const scoreOf = (o: TeamOption): number => o.assessment.score.value;

    return [...options]
      .map((option, declaredIndex) => ({ option, declaredIndex }))
      .sort((a, b) => {
        const strength =
          STRENGTH_ORDER[a.option.match.archetype.strength] - STRENGTH_ORDER[b.option.match.archetype.strength];
        if (strength !== 0) return strength;
        const targets = scoreOf(b.option) - scoreOf(a.option);
        if (targets !== 0) return targets;
        return a.declaredIndex - b.declaredIndex;
      })
      .map(({ option }, index, all) => {
        const previous = all[index - 1]?.option;
        const rankedBy: TeamOption['rankedBy'] =
          previous === undefined || previous.match.archetype.strength !== option.match.archetype.strength
            ? 'strength'
            : scoreOf(previous) !== scoreOf(option)
              ? 'targets'
              : 'declared';
        return { ...option, rankedBy };
      });
  }

  private async assessTeam(match: ArchetypeMatch, roster: Roster): Promise<TeamAssessment> {
    const { bank, resolver } = this.opts;
    const outcomes: SlotOutcome[] = [];
    // Violações de alvo hard, com os números REALMENTE medidos — nunca um
    // array vazio por omissão quando `assess()` já devolveu o dado (spec:
    // nenhum número sem origem rastreável).
    const violations: ConstraintViolation[] = [];

    for (const [slotIndex, key] of match.fills.entries()) {
      const slot = match.archetype.slots[slotIndex]!;
      if (key === null) {
        outcomes.push({
          slotIndex, character: null, variantLabel: null, variantId: null,
          meetsHardTargets: false, requiredEr: null, actualEr: null,
          line: `Slot ${slotIndex + 1} (${slot.role.join('/')}): vazio — nenhum personagem seu ocupa este papel.`,
        });
        continue;
      }

      const build = equippedBuild(roster, key);
      const profile = bank.profiles.get(key);
      if (!build || !profile) {
        outcomes.push({
          slotIndex, character: key, variantLabel: null, variantId: null,
          meetsHardTargets: false, requiredEr: null, actualEr: null,
          line: `Slot ${slotIndex + 1}: ${String(key)} — sem ficha curada, build não julgada.`,
        });
        continue;
      }

      const stats = await resolver.resolve(build);
      const choice = selectVariant(profile, build, stats, bank.scoring, {
        ...(slot.variant === undefined ? {} : { fromArchetype: slot.variant }),
      });

      // Alvos da ficha, sobrescritos pelos do arquétipo quando houver (spec §4.2).
      const overridden = new Map(choice.variant.targets.map((t) => [targetId(t), t] as const));
      for (const override of slot.targetOverrides ?? []) overridden.set(targetId(override), override);
      const targets = [...overridden.values()];

      const result = assess(build, { ...choice.variant, targets }, stats, bank.scoring);
      const erTarget = targets.find((t) => t.kind === 'min' && t.stat === 'enerRech_');

      // Todo `violated` chega com `kind: 'min'` (só alvo `min` é `hard` em
      // `checkTargets`) — o `Constraint` sintético não inventa nenhum campo,
      // só reembala o que `assess()` já mediu.
      for (const v of result.violated) {
        if (v.target.kind !== 'min') continue;
        violations.push({
          constraint: { kind: 'stat', of: key, stat: v.target.stat, min: v.target.value, hard: true },
          actual: v.actual,
          required: v.required,
          hard: true,
        });
      }

      outcomes.push({
        slotIndex,
        character: key,
        variantLabel: choice.variant.label,
        variantId: choice.variant.id,
        meetsHardTargets: !result.blocked,
        requiredEr: erTarget && erTarget.kind === 'min' ? erTarget.value : null,
        actualEr: stats?.enerRech_ ?? null,
        line:
          `Slot ${slotIndex + 1} (${slot.role.join('/')}): ${String(key)} — ` +
          `${choice.explanation} ${result.blocked ? 'Há alvo obrigatório fora do lugar.' : 'Alvos obrigatórios cumpridos.'}`,
      });
    }

    const elements = match.fills
      .filter((k): k is CharacterKey => k !== null)
      .map((k) => roster.characters.get(k)?.element)
      .filter((e): e is Element => e !== undefined);

    const roleCoverage: Partial<Record<RoleTag, 'missing' | 'weak' | 'covered'>> = {};
    for (const [slotIndex, slot] of match.archetype.slots.entries()) {
      const outcome = outcomes[slotIndex]!;
      const state = outcome.character === null ? 'missing' : outcome.meetsHardTargets ? 'covered' : 'weak';
      for (const role of slot.role) {
        // Não rebaixa: um papel coberto por um slot não vira "missing" por outro.
        if (roleCoverage[role] === 'covered') continue;
        if (roleCoverage[role] === 'weak' && state === 'missing') continue;
        roleCoverage[role] = state;
      }
    }

    const provenance: Provenance = {
      evaluatorId: 'curated-team',
      kind: 'curated',
      gameVersion: match.archetype.gameVersionAdded,
      datasetSha: bank.datasetSha,
      confidence: match.status === 'playable' ? 'high' : 'medium',
      assumptions: [
        'arquétipo CURADO: a força relativa é dado autoral, não fórmula',
        'saída ORDINAL: serve para comparar times, não para prever dano',
        `resolver de stats: ${resolver.id}`,
      ],
      rosterCompleteness: roster.provenance.completeness,
      cacheKey: `curated-team:${bank.datasetSha}:${match.archetype.id}:${match.fills.join(',')}`,
    };

    const score: Score = {
      value: outcomes.filter((o) => o.meetsHardTargets).length,
      unit: 'score',
      violations,
      provenance,
    };

    // Slot com alvo de ER que a captura não conseguiu medir: não fabricar
    // "0% de ER" (Achado 1) — a ausência vira uma linha explícita, não um
    // silêncio (que trocaria um defeito por outro).
    const unverifiedEr = outcomes.filter((o) => o.character !== null && o.requiredEr !== null && o.actualEr === null);

    const explanation: Explanation = {
      summary:
        `${match.archetype.label} (${match.archetype.strength}) — ` +
        (match.status === 'playable'
          ? 'você tem todos os personagens deste time.'
          : `falta 1 slot para você jogar este time.`),
      reasons: [
        ...outcomes.map((o) => ({ claim: o.line })),
        ...unverifiedEr.map((o) => ({
          claim:
            `Recarga de Energia de ${String(o.character)} não pôde ser verificada — ` +
            'a captura não trouxe esse dado para esta build.',
        })),
      ],
      citations: [...match.archetype.sources],
    };

    return {
      archetype: {
        id: match.archetype.id,
        label: match.archetype.label,
        matchConfidence: match.fills.filter(Boolean).length / match.archetype.slots.length,
      },
      reactions: reactionsFor(elements),
      resonance: resonanceFor(elements),
      roleCoverage,
      // `actualEr === null` significa "não medido", nunca "mediu zero" — um
      // slot assim não afirma nada em vez de fabricar 0% de ER (Achado 1).
      energyFeasibility: outcomes
        .filter((o) => o.character !== null && o.requiredEr !== null && o.actualEr !== null)
        .map((o) => ({ of: o.character!, required: o.requiredEr!, actual: o.actualEr! })),
      score,
      explanation,
    };
  }
}

/** Identidade de um alvo, para o override do arquétipo substituir o certo. */
function targetId(target: { kind: string; stat?: string; numerator?: string; denominator?: string }): string {
  return target.kind === 'ratio'
    ? `ratio:${target.numerator}/${target.denominator}`
    : `${target.kind}:${target.stat}`;
}
