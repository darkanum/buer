import { describe, it, expect } from 'vitest';
import { parseArgs, reportError } from '../src/index.js';

describe('parseArgs', () => {
  it('separa comando, posicionais e flags (valor vs booleana)', () => {
    expect(parseArgs(['sync', '--out', 'x.json', '--dry-run', '--cookie', 'a=b'])).toEqual({
      command: 'sync',
      positional: [],
      flags: { out: 'x.json', 'dry-run': true, cookie: 'a=b' },
    });
  });

  it('mantém argumentos posicionais (ex.: o token de login)', () => {
    expect(parseArgs(['login', 'ow_live_test', '--api-base-url', 'http://x'])).toEqual({
      command: 'login',
      positional: ['ow_live_test'],
      flags: { 'api-base-url': 'http://x' },
    });
  });

  it('argv vazio dá comando vazio', () => {
    expect(parseArgs([])).toEqual({ command: '', positional: [], flags: {} });
  });
});

describe('reportError (handler global de erro)', () => {
  it('redige um cookie antes de formatar a mensagem', () => {
    const out = reportError(new Error('sessão inválida: Cookie: ltoken_v2=abc123; ltuid_v2=7'));
    expect(out).not.toContain('abc123');
  });

  it('redige um token ow_live_ antes de formatar a mensagem', () => {
    const out = reportError(new Error('falha ao enviar com token ow_live_deadbeef'));
    expect(out).not.toContain('deadbeef');
  });

  it('preserva o resto da mensagem e funciona para erros não-Error', () => {
    expect(reportError(new Error('erro 500 no /api/ingest'))).toContain('/api/ingest');
    expect(reportError('string crua')).toBe('string crua');
  });
});
