import { ds1, APP_VERSION, CLIENT_TYPE } from './ds.js';
import { ACCOUNT_BASE, RECORD_BASE, DEFAULT_LANG } from './config.js';
import {
  HoyolabError,
  classifyRetcode,
  type HoyolabClientOptions,
  type GameRole,
  type ListCharactersResult,
  type FetchAllResult,
  type Sleep,
} from './types.js';

const TRUNCATE_AT = 300;

/** Trunca um corpo de resposta para mensagem de erro — nunca inclui o Cookie. */
function truncateBody(text: string): string {
  return text.length > TRUNCATE_AT ? `${text.slice(0, TRUNCATE_AT)}…` : text;
}

function defaultRand(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

interface EnvelopeLike {
  retcode?: number;
  message?: string;
  data?: unknown;
}

export class HoyolabClient {
  private readonly cookies: HoyolabClientOptions['cookies'];
  private readonly lang: string;
  private readonly accountBase: string;
  private readonly recordBase: string;
  private readonly fetchImpl: typeof fetch;
  private readonly useDs: boolean;
  private readonly now: () => number;
  private readonly rand: () => string;
  private readonly maxRetries: number;
  private readonly retryDelayMs: (attempt: number) => number;
  private readonly sleep: Sleep;

  constructor(opts: HoyolabClientOptions) {
    this.cookies = opts.cookies;
    this.lang = opts.lang ?? DEFAULT_LANG;
    this.accountBase = opts.accountBase ?? ACCOUNT_BASE;
    this.recordBase = opts.recordBase ?? RECORD_BASE;
    this.fetchImpl = opts.fetch ?? fetch;
    this.useDs = opts.useDs ?? true;
    this.now = opts.now ?? (() => Math.floor(Date.now() / 1000));
    this.rand = opts.rand ?? defaultRand;
    this.maxRetries = opts.maxRetries ?? 2;
    this.retryDelayMs = opts.retryDelayMs ?? ((attempt) => 200 * attempt);
    this.sleep = opts.sleep ?? realSleep;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = {
      Cookie: `ltoken_v2=${this.cookies.ltoken_v2}; ltuid_v2=${this.cookies.ltuid_v2}`,
      'x-rpc-language': this.lang,
      'x-rpc-app_version': APP_VERSION,
      'x-rpc-client_type': CLIENT_TYPE,
      ...extra,
    };
    if (this.useDs) {
      h['DS'] = ds1(this.now(), this.rand());
    }
    return h;
  }

  /** GET/POST com parse defensivo + classificação de retcode + retry em ratelimit. */
  private async requestJson(url: string, init: RequestInit): Promise<unknown> {
    const attempts = this.maxRetries + 1;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const res = await this.fetchImpl(url, init);
      const text = await res.text();

      let payload: EnvelopeLike;
      try {
        payload = JSON.parse(text) as EnvelopeLike;
      } catch {
        // Corpo não-JSON (ex.: "Method Not Allowed" em texto puro) — nunca
        // deixar a SyntaxError crua escapar, e nunca ecoar o Cookie aqui.
        throw new HoyolabError('unknown', 'unknown', `resposta não-JSON (HTTP ${res.status}): ${truncateBody(text)}`);
      }

      const retcode = payload.retcode;
      if (retcode === undefined || retcode === 0) {
        return payload.data;
      }

      const kind = classifyRetcode(retcode);
      if (kind === 'ratelimit' && attempt < attempts) {
        await this.sleep(this.retryDelayMs(attempt));
        continue;
      }
      throw new HoyolabError(kind, String(retcode), payload.message ?? `HoYoLAB retcode ${retcode}`);
    }
    // Inalcançável — o loop sempre retorna ou lança.
    throw new HoyolabError('unknown', 'unknown', 'loop de retry esgotado sem resposta');
  }

  /** GET getUserGameRolesByCookie → filtra game_biz==='hk4e_global'. */
  async getGameRole(): Promise<GameRole> {
    const url = `${this.accountBase}/binding/api/getUserGameRolesByCookie?game_biz=hk4e_global`;
    const data = (await this.requestJson(url, { method: 'GET', headers: this.headers() })) as
      | { list?: Array<{ game_biz: string; region: string; game_uid: string; nickname?: string | null }> }
      | undefined;

    const role = data?.list?.find((r) => r.game_biz === 'hk4e_global');
    if (!role) {
      throw new HoyolabError('no-chronicle', 'no-role', 'nenhuma conta hk4e_global vinculada a este cookie');
    }
    return { gameUid: String(role.game_uid), region: role.region, nickname: role.nickname ?? null };
  }

  /** POST genshin/api/character/list. */
  async listCharacters(role: GameRole): Promise<ListCharactersResult> {
    const url = `${this.recordBase}/genshin/api/character/list`;
    const body = JSON.stringify({ role_id: role.gameUid, server: role.region, sort_type: 1 });
    const data = await this.requestJson(url, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body,
    });
    const list = (data as { list?: Array<{ id: number }> } | undefined)?.list ?? [];
    return { ids: list.map((c) => c.id), base: data };
  }

  /** POST genshin/api/character/detail em lote (uma requisição, não N). */
  async characterDetail(role: GameRole, ids: number[]): Promise<unknown> {
    const url = `${this.recordBase}/genshin/api/character/detail`;
    const body = JSON.stringify({ role_id: role.gameUid, server: role.region, character_ids: ids });
    return this.requestJson(url, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body,
    });
  }

  /** getGameRole → listCharacters → characterDetail, no formato que a CLI envia como `raw`. */
  async fetchAll(): Promise<FetchAllResult> {
    const role = await this.getGameRole();
    const { ids, base } = await this.listCharacters(role);
    const detail = await this.characterDetail(role, ids);
    return {
      list: base,
      detail,
      account: { gameUid: role.gameUid, region: role.region, nickname: role.nickname },
    };
  }
}
