// Tipos crus, propositalmente frouxos: hoyolab/ é um cliente de API de terceiro,
// não o normalizador. `list`/`detail`/`base` ficam como `unknown` — quem sabe a
// forma exata é @buer/core#normalize (Marco 1), que já tolera campos novos.

/** Apenas ltoken_v2 + ltuid_v2 — nunca cookie_token_v2 (ver §3.3 da spec). */
export interface HoyolabCookies {
  ltoken_v2: string;
  ltuid_v2: string;
}

/** Injetável para testes com timers reais (default: setTimeout de verdade). */
export type Sleep = (ms: number) => Promise<void>;

export interface HoyolabClientOptions {
  cookies: HoyolabCookies;
  /** Código x-rpc-language. Default 'pt-pt' — nunca 'pt-br' (ver IngestEnvelope). */
  lang?: string;
  /** Override de `https://api-account-os.hoyolab.com`. */
  accountBase?: string;
  /** Override de `https://sg-public-api.hoyolab.com/event/game_record`. */
  recordBase?: string;
  /** Injetável para replay em teste; default: `fetch` global (Node 24). */
  fetch?: typeof fetch;
  /**
   * Envia o header DS por padrão (cinto-e-suspensórios — sempre correto).
   * Um spike futuro pode decidir que é dispensável nessas rotas; até lá,
   * default TRUE. Nunca inverter esse default.
   */
  useDs?: boolean;
  /** Relógio injetável usado para o `t` do DS1. Default: `Date.now()`. */
  now?: () => number;
  /** Gerador do `r` do DS1 (string numérica de 6 dígitos). Default: aleatório. */
  rand?: () => string;
  /** Tentativas extras em caso de `ratelimit`. Default: 2. */
  maxRetries?: number;
  /** Atraso (ms) antes da tentativa N+1. Default: backoff exponencial simples. */
  retryDelayMs?: (attempt: number) => number;
  /** Função de espera injetável — testes nunca devem dormir segundos reais. */
  sleep?: Sleep;
}

/** Conta de jogo hk4e_global filtrada de getUserGameRolesByCookie. */
export interface GameRole {
  gameUid: string;
  region: string;
  nickname?: string | null;
}

/**
 * Seletor opcional de conta, para quando `getUserGameRolesByCookie` devolve
 * mais de uma conta hk4e_global (ex.: um alt em os_asia e a conta principal
 * em os_usa). `uid` tem prioridade sobre `region` quando os dois são dados.
 */
export interface GameRoleSelector {
  uid?: string;
  region?: string;
}

export interface ListCharactersResult {
  ids: number[];
  base: unknown;
}

export interface FetchAllResult {
  list: unknown;
  detail: unknown;
  account: { gameUid: string; region: string; nickname?: string | null };
}

export type HoyolabErrorKind = 'session' | 'ratelimit' | 'no-chronicle' | 'unknown' | 'multiple-accounts';

const RETCODE_KIND: Record<number, HoyolabErrorKind> = {
  10001: 'session',
  10102: 'ratelimit',
  1034: 'ratelimit',
  [-110]: 'ratelimit',
  10104: 'no-chronicle',
  1009: 'no-chronicle',
};

export function classifyRetcode(retcode: number): HoyolabErrorKind {
  return RETCODE_KIND[retcode] ?? 'unknown';
}

/**
 * Erro tipado do cliente HoYoLAB. `retcode` é sempre textual (mesmo quando não
 * há um retcode numérico real — ex.: corpo não-JSON — nesse caso vale 'unknown').
 * A mensagem nunca inclui o valor do header Cookie.
 */
export class HoyolabError extends Error {
  readonly retcode: string;
  readonly kind: HoyolabErrorKind;

  constructor(kind: HoyolabErrorKind, retcode: string, message: string) {
    super(message);
    this.name = 'HoyolabError';
    this.kind = kind;
    this.retcode = retcode;
  }
}
