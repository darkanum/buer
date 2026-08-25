export { ds1, DS_SALT, APP_VERSION, CLIENT_TYPE } from './ds.js';

export { ACCOUNT_BASE, RECORD_BASE, DEFAULT_LANG } from './config.js';

export type {
  HoyolabCookies,
  HoyolabClientOptions,
  GameRole,
  GameRoleSelector,
  ListCharactersResult,
  FetchAllResult,
  HoyolabErrorKind,
  Sleep,
} from './types.js';
export { HoyolabError, classifyRetcode } from './types.js';

export { HoyolabClient } from './client.js';
