import { describe, it, expect } from 'vitest';
import { IngestEnvelope, PROTOCOL_VERSION } from '../src/protocol.js';

const good = {
  protocolVersion: PROTOCOL_VERSION, cliVersion: '0.1.0', takenAt: new Date().toISOString(),
  account: { gameUid: '800000000', region: 'os_asia', nickname: 'X', lang: 'pt-pt' },
  raw: { list: { list: [] }, detail: { list: [] } },
};

describe('IngestEnvelope', () => {
  it('aceita envelope válido', () => {
    expect(IngestEnvelope.safeParse(good).success).toBe(true);
  });
  it('rejeita lang pt-br', () => {
    const bad = { ...good, account: { ...good.account, lang: 'pt-br' } };
    expect(IngestEnvelope.safeParse(bad).success).toBe(false);
  });
  it('rejeita envelope sem raw', () => {
    const { raw, ...bad } = good;
    expect(IngestEnvelope.safeParse(bad).success).toBe(false);
  });
});
