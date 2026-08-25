import type { CharacterKey } from '@buer/core';
import type { MetaBank } from '@buer/meta';
import type {
  Build, BuildEvaluator, CapabilityVerdict, ConstraintViolation, EvaluationContext,
  EvaluatorCapabilities, Explanation, PreparedEvaluator, Provenance, Score,
} from '../interfaces.js';
import type { StatResolver } from '../stat-resolver.js';
import { assess, type CuratedAssessment } from './scoring.js';
import { selectVariant, type VariantChoice } from './variant.js';

const CAPS: EvaluatorCapabilities = {
  kind: 'curated',
  output: 'ordinal',
  supportsTermKinds: ['stat'],
  supportsAggregates: ['sum'],
  supportsConstraintKinds: ['stat', 'artifactSet', 'mainStat'],
  supportsHitModes: ['avgHit'],
  modelsSnapshot: false,
  modelsAuraAndIcd: false,
  providesBounds: false,
  deterministic: true,
  estimatedCostPerBuildMs: 0.01,
  maxBatchSize: 10000,
  runtime: 'node',
};

export interface CuratedBuildEvaluatorOptions {
  readonly bank: MetaBank;
  readonly resolver: StatResolver;
  /**
   * Completude do roster de onde a build veio — vira `Provenance.rosterCompleteness`.
   * Obrigatório e sem padrão: um padrão aqui esconderia de novo uma afirmação
   * fabricada sobre o dado do usuário (mesmo defeito do Achado 1). Quem
   * constrói o avaliador passa `roster.provenance.completeness`.
   */
  readonly rosterCompleteness: Provenance['rosterCompleteness'];
  /** Variante exigida pelo slot do arquétipo, por personagem — regra 2 de `selectVariant` (spec §6.4). */
  readonly archetypeVariants?: ReadonlyMap<CharacterKey, string>;
}

/** Acha, dentro do contexto, a build do personagem que está sendo avaliado. */
function subjectBuild(ctx: EvaluationContext): Build | null {
  for (const slot of ctx.team?.slots ?? []) {
    if (slot?.build?.character?.key === ctx.subject) return slot.build;
  }
  return null;
}

export class CuratedBuildEvaluator implements BuildEvaluator {
  readonly id = 'curated';
  readonly capabilities = CAPS;

  constructor(private readonly opts: CuratedBuildEvaluatorOptions) {}

  /**
   * Negociação ANTES de rodar (spec F1§6.4). Duas razões de recusa, ambas
   * honestas: não há ficha para este personagem, ou a build não tem stats
   * observados. A segunda é o seam da Fase 3 — quando o ComputedStatResolver
   * existir, ela deixa de acontecer sem mudar mais nada aqui.
   */
  canHandle(ctx: EvaluationContext): CapabilityVerdict {
    const reasons: string[] = [];

    const subject = ctx.subject;
    if (subject !== undefined && !this.opts.bank.profiles.has(subject)) {
      reasons.push(`ainda não há ficha curada para o personagem ${String(subject)}`);
    }

    const build = subjectBuild(ctx);
    if (build && build.observedStats === undefined) {
      reasons.push(
        'a build não tem stats observados (observedStats) — o avaliador curado só julga a build capturada; ' +
          'comparar build hipotética exige o avaliador analítico da Fase 3',
      );
    }

    return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
  }

  async prepare(ctx: EvaluationContext): Promise<PreparedEvaluator> {
    const { bank, resolver, archetypeVariants, rosterCompleteness } = this.opts;
    const subject = ctx.subject;
    const profile = subject === undefined ? undefined : bank.profiles.get(subject);
    const gameVersion = ctx.gameVersion ?? ('7.0' as const);

    const evaluateOne = async (
      build: Build,
    ): Promise<{ assessment: CuratedAssessment; choice: VariantChoice } | null> => {
      if (!profile) return null;
      const stats = await resolver.resolve(build);
      const choice = selectVariant(profile, build, stats, bank.scoring, {
        ...(archetypeVariants?.get(profile.character) === undefined
          ? {}
          : { fromArchetype: archetypeVariants.get(profile.character)! }),
      });
      return { assessment: assess(build, choice.variant, stats, bank.scoring), choice };
    };

    const provenanceFor = (choice: VariantChoice | null): Provenance => ({
      evaluatorId: this.id,
      kind: 'curated',
      gameVersion,
      datasetSha: bank.datasetSha,
      confidence: profile?.provenance.confidence ?? 'low',
      assumptions: [
        `pesos de pontuação: scoring v${bank.scoring.version}`,
        `resolver de stats: ${resolver.id}`,
        choice ? `variante julgada: ${choice.variant.id} (${choice.reason})` : 'sem ficha curada',
        'saída ORDINAL: serve para comparar, não para prever dano',
      ],
      rosterCompleteness,
      cacheKey: `${this.id}:${bank.datasetSha}:${String(subject)}`,
    });

    const emptyScore = (): Score => ({
      value: 0,
      unit: 'score',
      violations: [],
      provenance: provenanceFor(null),
    });

    return {
      async evaluate(builds: readonly Build[]): Promise<readonly Score[]> {
        const out: Score[] = [];
        for (const build of builds) {
          const result = await evaluateOne(build);
          if (!result) {
            out.push(emptyScore());
            continue;
          }
          const violations: ConstraintViolation[] = result.assessment.violated.map((v) => ({
            constraint: {
              kind: 'stat',
              of: profile!.character,
              stat: v.target.kind === 'ratio' ? v.target.numerator : v.target.stat,
              ...(v.target.kind === 'min' ? { min: v.target.value } : {}),
              hard: true,
            },
            // Números MEDIDOS de verdade, propagados de checkTargets — nunca
            // um literal aqui (Achado 1 da revisão: `actual: 0` fabricado
            // feria o contrato "nenhum número sem origem rastreável").
            actual: v.actual,
            required: v.required,
            hard: true,
          })) as ConstraintViolation[];

          out.push({
            value: result.assessment.value,
            unit: 'score',
            violations,
            breakdown: result.assessment.breakdown,
            provenance: provenanceFor(result.choice),
          });
        }
        return out;
      },

      async explain(build: Build): Promise<Explanation> {
        const result = await evaluateOne(build);
        if (!result) {
          return {
            summary: 'Ainda não há ficha curada para este personagem — nenhum veredito de build foi dado.',
            reasons: [],
          };
        }
        return {
          summary: result.choice.explanation,
          reasons: result.assessment.findings.map((f) => ({
            claim: f.summary,
            ...(f.why ?? f.caveat ? { evidence: [f.why, f.caveat].filter(Boolean).join(' ') } : {}),
          })),
        };
      },

      async [Symbol.asyncDispose]() {
        // sem recurso a liberar
      },
    };
  }
}
