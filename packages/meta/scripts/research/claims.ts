// packages/meta/scripts/research/claims.ts
//
// Os tipos que atravessam o pipeline. Sem lógica — existe para que a
// reconciliação (pura) e a extração (que chama a API) concordem sobre a forma
// do dado sem uma depender da outra.

/** As três fontes, na ordem de preferência decidida em docs/STATUS.md. */
export const SOURCE_IDS = ['icy-veins', 'game8', 'genshin-builds'] as const;
export type SourceId = (typeof SOURCE_IDS)[number];

/**
 * O que UMA fonte afirma sobre UM personagem.
 *
 * Todo campo é opcional, e ausência significa "esta fonte não cobre isto" —
 * nunca "o valor é vazio". A distinção é a regra central do pipeline: um campo
 * ausente não vira divergência nem palpite.
 */
export interface SourceClaim {
  readonly source: SourceId;
  readonly url: string;
  readonly sets?: readonly string[];
  readonly mainStats?: {
    readonly sands?: readonly string[];
    readonly goblet?: readonly string[];
    readonly circlet?: readonly string[];
  };
  readonly substats?: readonly string[];
  readonly weapons?: readonly string[];
  readonly erThreshold?: number;
  /**
   * A razão que ESTA fonte dá para o limiar de ER, nas palavras dela.
   *
   * NÃO entra na votação da reconciliação: razões em prosa nunca vão bater
   * literalmente entre três sites, e votar em texto produziria "empate" em
   * todo personagem. Quem escolhe é a escrita da ficha (Task 5), pegando a da
   * fonte de maior preferência que tiver uma — assim o `why` fica sempre
   * atribuível a uma URL de `sources`, em vez de ser gerado por template.
   */
  readonly erWhy?: string;
  readonly roles?: readonly string[];
  readonly scalesOn?: string;
}

export interface CharacterClaims {
  readonly character: string;
  readonly claims: readonly SourceClaim[];
}

/**
 * Um campo em que as fontes não falaram a mesma coisa. Vai para `notes`.
 *
 * A distinção entre os dois tipos é a correção que este pipeline faz sobre a
 * intuição óbvia:
 *
 * - `alternatives` — campo de LISTA ORDENADA (conjuntos, armas, substats,
 *   main-stats). Fontes divergirem aqui NÃO é contradição: é o catálogo de
 *   opções ficando maior. A ficha guarda todas, ranqueadas por quantas fontes
 *   citaram cada uma e em que posição. Não derruba a confiança.
 * - `conflict` — campo de valor ÚNICO (limiar de ER, o atributo que escala).
 *   Aqui divergir é contradição: um personagem não tem dois limiares de ER.
 *   Derruba a confiança.
 *
 * Tratar os dois do mesmo jeito descartaria opção boa por "maioria" — e é
 * exatamente o que a ficha, com seus `rank`, foi desenhada para não fazer.
 */
export interface Divergence {
  readonly field: string;
  readonly kind: 'alternatives' | 'conflict';
  readonly bySource: Readonly<Record<string, string>>;
}

export interface AgreedFields {
  readonly sets?: readonly string[];
  readonly mainStats?: {
    readonly sands?: readonly string[];
    readonly goblet?: readonly string[];
    readonly circlet?: readonly string[];
  };
  readonly substats?: readonly string[];
  readonly weapons?: readonly string[];
  readonly erThreshold?: number;
  readonly roles?: readonly string[];
  readonly scalesOn?: string;
}

export interface ReconcileResult {
  readonly agreed: AgreedFields;
  readonly divergences: readonly Divergence[];
  /** Derivada da concordância. NUNCA 'high' — isso exige revisão humana. */
  readonly confidence: 'medium' | 'low';
  /**
   * As URLs que o MODELO declarou no passo de extração, uma por claim.
   *
   * NÃO é o mesmo que "as URLs consultadas": quem sabe isso é
   * `ResearchOutput.urls`, colhido dos blocos `web_search_tool_result` da
   * primeira chamada. Estas aqui são afirmação do modelo, e por isso não
   * entram em `provenance.sources` — a diferença entre as duas listas vira
   * nota na ficha, nomeada como não confirmada (ver `buildDraft`).
   */
  readonly sources: readonly string[];
}
