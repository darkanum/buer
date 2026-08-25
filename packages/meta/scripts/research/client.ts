// packages/meta/scripts/research/client.ts
//
// Construção do cliente e as constantes que as duas chamadas de API
// compartilham. Ferramenta offline — nunca importada por código de runtime.

import Anthropic from '@anthropic-ai/sdk';

/** Não troque sem instrução explícita. */
export const MODEL = 'claude-opus-5';

/**
 * Os três domínios, na ordem de preferência decidida em docs/STATUS.md.
 * A busca web é restrita a eles: pesquisa com citação, não varredura aberta.
 */
export const SOURCE_DOMAINS = ['icy-veins.com', 'game8.co', 'genshin-builds.com'] as const;

/**
 * Cliente sem argumento: o SDK resolve a credencial do ambiente
 * (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, ou um perfil de `ant auth login`).
 * Nenhuma chave é lida ou impressa por este código.
 */
export function createClient(): Anthropic {
  return new Anthropic();
}

/**
 * Erro da API em uma frase, em português, sem vazar credencial.
 * Distingue o que adianta repetir do que não adianta — quem chama decide.
 */
export function describeApiError(e: unknown): string {
  if (e instanceof Anthropic.RateLimitError) return 'limite de taxa atingido; espere e repita';
  if (e instanceof Anthropic.AuthenticationError) return 'credencial inválida ou ausente (ANTHROPIC_API_KEY / ant auth login)';
  if (e instanceof Anthropic.BadRequestError) return `requisição rejeitada: ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return 'falha de conexão com a API';
  if (e instanceof Anthropic.APIError) return `erro da API (${e.status}): ${e.message}`;
  return `erro inesperado: ${String(e)}`;
}
