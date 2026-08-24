import { describe, it, expect } from 'vitest';
import { redact } from '../src/redact.js';
describe('redact', () => {
  it('mascara cookie e token em qualquer contexto', () => {
    expect(redact('Cookie: ltoken_v2=abc123; ltuid_v2=7')).not.toContain('abc123');
    expect(redact('token ow_live_deadbeef falhou')).not.toContain('deadbeef');
  });
  it('preserva o resto da mensagem', () => {
    expect(redact('erro 500 no /api/ingest')).toContain('/api/ingest');
  });
});
