// packages/meta/scripts/research/search.ts
//
// A primeira das duas chamadas de API: pesquisa com busca web restrita aos três
// domínios de referência. Devolve o texto bruto e as URLs consultadas — a
// estruturação é da extração (extract.ts), não daqui.
//
// O cliente é INJETADO. Nenhum teste desta suíte toca a rede.

import type Anthropic from '@anthropic-ai/sdk';
import { MODEL, SOURCE_DOMAINS } from './client.js';
import { SOURCE_IDS } from './claims.js';

export interface SearchClient {
  stream(params: Anthropic.MessageStreamParams): { finalMessage(): Promise<Anthropic.Message> };
}

export interface SearchDeps {
  readonly client: SearchClient;
  readonly model?: string;
  /** Teto de buscas por personagem. Três fontes, com folga para refinar. */
  readonly maxUses?: number;
  /** Quantas vezes retomar um turno pausado antes de desistir. */
  readonly maxResumes?: number;
}

export interface ResearchOutput {
  readonly text: string;
  /** As URLs que a busca DE FATO consultou — nunca as que o modelo declarou. */
  readonly urls: readonly string[];
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
  /**
   * O teto de retomadas foi atingido com o turno ainda pausado.
   *
   * Sem este campo, esgotar `maxResumes` era indistinguível de terminar
   * normalmente: a pesquisa cortada seguia para a extração, gerava claims
   * parciais, e a reconciliação lia os campos que faltaram como "esta fonte
   * não cobre isto" — que é a premissa central do pipeline, e aqui estaria
   * mentindo. Um `true` aqui é motivo para o lote reportar o alvo numa seção
   * própria e para a ficha registrar a ressalva em `notes`.
   */
  readonly truncated: boolean;
}

/**
 * O prompt. Em português porque a ficha e os `why` são lidos por um usuário
 * brasileiro, ainda que as fontes sejam em inglês.
 *
 * As duas exigências que fazem o pipeline funcionar estão aqui: atribuição
 * POR FONTE (senão a reconciliação não tem o que comparar) e a proibição de
 * preencher lacuna (senão o pipeline industrializa o defeito da §14.3).
 */
export function buildCharacterPrompt(slug: string): string {
  return [
    `Pesquise a build recomendada do personagem "${slug}" de Genshin Impact nestes três sites, e SOMENTE neles:`,
    '',
    '1. icy-veins.com',
    '2. game8.co',
    '3. genshin-builds.com',
    '',
    'Relate o que **cada fonte** diz **separadamente**. Não resuma as três numa recomendação só —',
    'a comparação entre elas é feita depois, e ela precisa saber quem disse o quê.',
    '',
    'Para cada fonte, extraia, quando a fonte cobrir:',
    '- conjuntos de artefato recomendados, do melhor para o pior;',
    '- main-stats de ampulheta (sands), cálice (goblet) e capacete (circlet);',
    '- prioridade de substats;',
    '- armas recomendadas, da melhor para a pior;',
    '- limiar de Recarga de Energia (ER) em porcentagem, e **a razão que a fonte dá** para esse número;',
    '- o papel do personagem no time (main dps, sub dps, buffer, healer, shielder, battery, driver, enabler);',
    '- com que atributo a build escala (ATQ, Vida, DEF ou Maestria Elemental).',
    '',
    'REGRA QUE NÃO PODE SER QUEBRADA: se uma fonte não cobre um item, **omita esse item para essa fonte**.',
    'Não invente, não deduza de outra fonte, e não preencha com o valor "usual". Um campo ausente é',
    'informação correta; um campo preenchido por suposição é um erro que ninguém vai conseguir detectar depois.',
    '',
    'Ao fim, liste a URL exata que você usou de cada fonte.',
  ].join('\n');
}

/** Junta os blocos de texto da resposta. */
function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

/**
 * URLs dos resultados de busca.
 *
 * Cuidado real: erro de server tool volta com HTTP 200 e um bloco cujo
 * `content` é um OBJETO de erro, não a lista de resultados. Iterar sem checar
 * `Array.isArray` quebra exatamente no caso em que a busca falhou.
 */
function urlsOf(message: Anthropic.Message): string[] {
  const urls: string[] = [];
  for (const block of message.content as { type: string; content?: unknown }[]) {
    if (block.type !== 'web_search_tool_result') continue;
    if (!Array.isArray(block.content)) continue;
    for (const result of block.content as { type?: string; url?: string }[]) {
      if (typeof result.url === 'string') urls.push(result.url);
    }
  }
  return urls;
}

/**
 * A primeira chamada de API, para QUALQUER prompt de pesquisa.
 *
 * Compartilhada entre a pesquisa de personagem e a de times: eram 45 linhas
 * idênticas em dois arquivos, diferindo só no prompt — mesmo laço de
 * `pause_turn`, mesma contagem de `usage`, mesmo cast. Duas cópias do mesmo
 * laço significam que toda correção nele (o sinal de truncamento, por
 * exemplo) teria que ser feita duas vezes, ou metade do pipeline ficaria com
 * o defeito.
 */
export async function runResearchLoop(prompt: string, deps: SearchDeps): Promise<ResearchOutput> {
  const maxResumes = deps.maxResumes ?? 4;
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: prompt }];

  const texts: string[] = [];
  const urls: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let truncated = false;

  for (let attempt = 0; attempt <= maxResumes; attempt++) {
    const stream = deps.client.stream({
      model: deps.model ?? MODEL,
      // Streaming com teto alto: a busca web produz turnos longos, e sem
      // streaming isso bate no timeout de HTTP do SDK.
      max_tokens: 64000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      tools: [
        {
          type: 'web_search_20260209',
          name: 'web_search',
          max_uses: deps.maxUses ?? 8,
          allowed_domains: [...SOURCE_DOMAINS],
        },
      ],
      messages,
    } as Anthropic.MessageStreamParams);

    const message = await stream.finalMessage();
    texts.push(textOf(message));
    urls.push(...urlsOf(message));
    inputTokens += message.usage?.input_tokens ?? 0;
    outputTokens += message.usage?.output_tokens ?? 0;

    // A busca web pode pausar um turno longo. O SDK não retoma sozinho: sem
    // este laço a resposta volta truncada, sem erro e sem aviso.
    if (message.stop_reason !== 'pause_turn') break;

    // Sair por ESGOTAR o teto não é a mesma coisa que sair por ter acabado.
    // Sem esta distinção, a pesquisa cortada seguia para a extração e a
    // reconciliação tratava a lacuna como cobertura ausente da fonte.
    if (attempt === maxResumes) {
      truncated = true;
      break;
    }
    messages.push({ role: 'assistant', content: message.content });
  }

  return {
    text: texts.filter((t) => t !== '').join('\n'),
    urls: [...new Set(urls)],
    usage: { inputTokens, outputTokens },
    truncated,
  };
}

export function researchCharacter(slug: string, deps: SearchDeps): Promise<ResearchOutput> {
  return runResearchLoop(buildCharacterPrompt(slug), deps);
}

/** Só para o prompt de arquétipo saber os ids de fonte válidos. */
export const KNOWN_SOURCES = SOURCE_IDS;
