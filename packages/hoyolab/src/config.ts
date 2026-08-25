// Bases da API do Battle Chronicle — verificado em docs/superpowers/specs/
// 2026-08-24-onewash-design.md §3.3. O host já mudou 2x desde 2024, por isso
// ambas são sobrescrevíveis via HoyolabClientOptions (accountBase/recordBase).
export const ACCOUNT_BASE = 'https://api-account-os.hoyolab.com';
export const RECORD_BASE = 'https://sg-public-api.hoyolab.com/event/game_record';

// x-rpc-language é obrigatório na prática (sem ele, a resposta vem em chinês).
// Atenção: o código é pt-pt mas o conteúdo devolvido é pt-BR.
export const DEFAULT_LANG = 'pt-pt';
