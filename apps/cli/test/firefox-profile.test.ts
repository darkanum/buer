import { describe, it, expect } from 'vitest';
import { parseProfilesIni } from '../src/firefox-profile.js';

describe('parseProfilesIni', () => {
  it('prefere a seção [InstallXXXX] com Default=<path>, quando presente', () => {
    const ini = [
      '[Profile0]',
      'Name=default',
      'IsRelative=1',
      'Path=Profiles/abc.default',
      'Default=1',
      '',
      '[Install4F96D1932A9F858E]',
      'Default=Profiles/xyz.default-release',
      'Locked=1',
    ].join('\n');
    expect(parseProfilesIni(ini)).toEqual({ path: 'Profiles/xyz.default-release', isRelative: true });
  });

  it('sem seção Install, usa o [ProfileN] com Default=1', () => {
    const ini = [
      '[Profile1]',
      'Name=other',
      'IsRelative=1',
      'Path=Profiles/other',
      '',
      '[Profile0]',
      'Name=default',
      'IsRelative=0',
      'Path=/abs/path/default',
      'Default=1',
    ].join('\n');
    expect(parseProfilesIni(ini)).toEqual({ path: '/abs/path/default', isRelative: false });
  });

  it('devolve null quando não há nenhuma seção de perfil', () => {
    expect(parseProfilesIni('[General]\nStartWithLastProfile=1')).toBeNull();
  });
});
