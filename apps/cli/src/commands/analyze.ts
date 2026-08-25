import { readFileSync } from 'node:fs';
import { loadMeta, resolveCharacter, slugForCharacter } from '@buer/meta';
import type { CharacterKey } from '@buer/core';
import {
  CuratedRosterAdvisor, CuratedTeamEvaluator, ObservedStatResolver,
  equippedBuild, rosterFromHoyolab, assess, selectVariant,
  type Finding,
} from '@buer/engine';
import type { InvestmentAxis } from '@buer/engine';

export interface AnalyzeFlags {
  /** Caminho do arquivo de extração crua (o que `sync --raw-out` grava). */
  readonly from: string;
  readonly character?: string;
  readonly account?: boolean;
  readonly variant?: string;
  readonly json?: boolean;
}

export interface TeamReport {
  readonly archetypeId: string;
  readonly archetypeLabel: string;
  readonly strength: string;
  readonly rankedBy: string;
  readonly members: readonly (string | null)[];
  readonly variantId: string | null;
  readonly explanation: string;
  readonly findings: readonly Finding[];
  readonly energy: readonly { readonly of: string; readonly required: number; readonly actual: number }[];
}

/**
 * `advice.coverageGaps` (spec §8.2/§8.4) é a MESMA pergunta que
 * `acquisitions` — "o que adquirir" — só que sem um personagem nomeado
 * para responder: o slot que falta é por ELEMENTO/papel, não por alguém
 * específico que o jogador não tem. Antes desta correção (achado Important
 * da revisão da Task 12), `CuratedRosterAdvisor` já computava a descrição
 * pronta e ela era descartada antes de chegar à tela — silêncio onde a
 * resposta existia.
 */
export interface CoverageGapReport {
  readonly description: string;
  readonly severity: string;
  readonly blockedArchetypes: readonly string[];
}

export interface CharacterReport {
  readonly key: string;
  readonly slug: string;
  readonly level: number;
  readonly constellation: number;
  readonly observed: Readonly<Record<string, number>>;
  readonly playableTeams: readonly TeamReport[];
  readonly blockedTeams: readonly TeamReport[];
  readonly acquisitions: readonly { readonly axis: string; readonly unlocks: readonly string[]; readonly summary: string }[];
  readonly coverageGaps: readonly CoverageGapReport[];
  readonly note?: string;
}

export interface AnalyzeResult {
  readonly scope: 'character' | 'account';
  readonly datasetSha: string;
  readonly characters: readonly CharacterReport[];
}

/**
 * `capturedAt` fixo e não o relógio: o resultado alimenta um golden file, e
 * um timestamp real tornaria todo diff ruidoso. A data real da captura vive
 * no snapshot do banco, não aqui.
 */
const CAPTURED_AT = '1970-01-01T00:00:00.000Z';

/** slug do gi-data -> chave numérica; erro legível quando não existe. */
function keyForSlug(slug: string): CharacterKey {
  const key = resolveCharacter(slug);
  if (!key) throw new Error(`personagem "${slug}" não existe no catálogo do gi-data`);
  return key;
}

/**
 * Serializa um eixo de investimento com o DONO incluído — não só o `kind`.
 * `constellation`/`talent`/`refinement` sempre carregam `of`/`weapon` (Task
 * 10): omitir isso aqui apagaria de quem é o salto que o relatório afirma
 * (achado desta task — contrato de produto: nenhum rótulo sem origem).
 */
function axisLabel(axis: InvestmentAxis): string {
  switch (axis.kind) {
    case 'newCharacter': return `newCharacter:${String(axis.character)}`;
    case 'newWeapon': return `newWeapon:${String(axis.weapon)}`;
    case 'constellation': return `constellation:${String(axis.of)}`;
    case 'talent': return `talent:${String(axis.of)}`;
    case 'refinement': return `refinement:${String(axis.weapon)}`;
    case 'artifact': return 'artifact';
  }
}

export async function runAnalyze(flags: AnalyzeFlags): Promise<AnalyzeResult> {
  const raw = JSON.parse(readFileSync(flags.from, 'utf8')) as unknown;
  const roster = rosterFromHoyolab(raw, { capturedAt: CAPTURED_AT, lang: 'pt-br' });
  const bank = loadMeta();
  const resolver = new ObservedStatResolver();
  const teams = new CuratedTeamEvaluator({ bank, resolver });
  const advisor = new CuratedRosterAdvisor({ bank });

  const subjects: CharacterKey[] = flags.account
    ? [...roster.characters.keys()].sort()
    : [keyForSlug(flags.character ?? '')];

  const characters: CharacterReport[] = [];

  for (const key of subjects) {
    const character = roster.characters.get(key);
    if (!character) continue;

    const build = equippedBuild(roster, key);
    const stats = build ? ((await resolver.resolve(build)) ?? {}) : {};
    const profile = bank.profiles.get(key);
    const { playable, blocked } = await teams.teamsFor(key, roster);
    const advice = await advisor.adviseFor(key, roster);

    const toReport = (option: (typeof playable)[number]): TeamReport => {
      const slotIndex = option.match.fills.findIndex((f) => f === key);
      const slot = slotIndex >= 0 ? option.match.archetype.slots[slotIndex] : undefined;

      // Slot de ER não medido some da lista `energy` (Task 9: ausência nunca
      // vira zero fabricado) — a única explicação de POR QUE ele não está
      // ali vive em `explanation.reasons`, não em `.summary`. Sem isto, a
      // linha "não pôde ser verificada" nunca chegava à tela: o número
      // desaparecia, mas o motivo do desaparecimento desaparecia com ele.
      const unverifiedEnergyNotes = option.assessment.explanation.reasons
        .map((r) => r.claim)
        .filter((claim) => claim.includes('não pôde ser verificada'));

      let findings: readonly Finding[] = [];
      let variantId: string | null = null;
      let explanation = [option.assessment.explanation.summary, ...unverifiedEnergyNotes].join(' ');

      if (profile && build) {
        const choice = selectVariant(profile, build, stats, bank.scoring, {
          ...(slot === undefined ? {} : { slotRoles: slot.role }),
          ...(flags.variant === undefined ? {} : { pinned: flags.variant }),
          ...(slot?.variant === undefined ? {} : { fromArchetype: slot.variant }),
        });
        variantId = choice.variant.id;
        explanation = [option.assessment.explanation.summary, choice.explanation, ...unverifiedEnergyNotes].join(' ');
        findings = assess(build, choice.variant, stats, bank.scoring).findings;
      }

      return {
        archetypeId: option.match.archetype.id,
        archetypeLabel: option.match.archetype.label,
        strength: option.match.archetype.strength,
        rankedBy: option.rankedBy,
        members: option.match.fills.map((f) => (f === null ? null : String(f))),
        variantId,
        explanation,
        findings,
        energy: option.assessment.energyFeasibility.map((e) => ({
          of: String(e.of), required: e.required, actual: e.actual,
        })),
      };
    };

    const note = !profile
      ? 'Ainda sem ficha curada para este personagem — só os fatos abaixo.'
      : playable.length + blocked.length === 0
        ? 'Ainda sem time curado que inclua este personagem.'
        : undefined;

    // Sem ficha, não há variante para nomear (`toReport` deixaria
    // `variantId: null` — um veredito que afirmaria uma origem que não
    // existe). "Só os fatos abaixo", no `note`, significa isso literalmente:
    // nenhuma linha de veredito quando não há ficha para julgar contra,
    // mesmo que o roster complete o time por outro papel/flex slot que não
    // exige ficha própria (ex.: `kaeya` no slot flex de `freeze`).
    const canJudge = profile !== undefined;

    characters.push({
      key: String(key),
      slug: slugForCharacter(key) ?? String(key),
      level: character.level,
      constellation: character.constellation,
      observed: stats as Record<string, number>,
      playableTeams: canJudge ? playable.map(toReport) : [],
      blockedTeams: canJudge ? blocked.map(toReport) : [],
      acquisitions: advice.candidates.map((c) => ({
        axis: axisLabel(c.axis),
        unlocks: c.unlocks.map((u) => u.archetype.id),
        summary: c.explanation.summary,
      })),
      coverageGaps: advice.coverageGaps.map((g) => ({
        description: g.description,
        severity: g.severity,
        blockedArchetypes: g.blockedArchetypes,
      })),
      ...(note === undefined ? {} : { note }),
    });
  }

  return {
    scope: flags.account ? 'account' : 'character',
    datasetSha: bank.datasetSha,
    characters,
  };
}
