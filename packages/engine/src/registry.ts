import type {
  BuildEvaluator, CapabilityVerdict, EvaluationContext, EvaluatorCapabilities,
  EvaluatorKind, EvaluatorRegistry,
} from './interfaces.js';

/**
 * Resolve QUAL avaliador atende um contexto, e devolve junto o veredito de
 * degradação — quem chama precisa poder dizer ao usuário o que foi perdido.
 * A ordem de preferência é `curated` → `analytic` → `simulation` só quando
 * nenhum `prefer` é dado: é a ordem de custo crescente.
 */
const FALLBACK_ORDER: readonly EvaluatorKind[] = ['curated', 'analytic', 'simulation'];

export class DefaultEvaluatorRegistry implements EvaluatorRegistry {
  private readonly evaluators: BuildEvaluator[] = [];

  register(e: BuildEvaluator): void {
    const existing = this.evaluators.findIndex((x) => x.id === e.id);
    if (existing >= 0) this.evaluators[existing] = e;
    else this.evaluators.push(e);
  }

  resolve(
    ctx: EvaluationContext,
    prefer?: EvaluatorKind,
  ): { readonly evaluator: BuildEvaluator; readonly degraded: CapabilityVerdict } {
    const order = prefer ? [prefer, ...FALLBACK_ORDER.filter((k) => k !== prefer)] : FALLBACK_ORDER;
    const candidates = order.flatMap((kind) => this.evaluators.filter((e) => e.capabilities.kind === kind));

    if (candidates.length === 0) throw new Error('nenhum avaliador registrado');

    for (const evaluator of candidates) {
      const verdict = evaluator.canHandle(ctx);
      if (verdict.ok) return { evaluator, degraded: verdict };
    }

    // Nenhum aceita: devolve o primeiro com o motivo, para a UI poder explicar.
    const evaluator = candidates[0]!;
    return { evaluator, degraded: evaluator.canHandle(ctx) };
  }

  list(): readonly EvaluatorCapabilities[] {
    return this.evaluators.map((e) => e.capabilities);
  }
}
