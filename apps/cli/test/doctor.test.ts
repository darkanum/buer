import { describe, it, expect } from 'vitest';
import { runDoctor, type DoctorDeps } from '../src/commands/doctor.js';

const baseDeps: DoctorDeps = {
  findSession: async () => ({ ltoken_v2: 'x', ltuid_v2: '1' }),
  checkHoyolab: async () => ({ reachable: true, valid: true }),
  checkApi: async () => true,
  readConfig: () => ({ apiToken: 'ow_live_x', apiBaseUrl: 'http://x' }),
};

describe('runDoctor', () => {
  it('tudo certo: cookie achado + válido, HoYoLAB e API respondem, pareado', async () => {
    const report = await runDoctor(baseDeps);
    expect(report).toEqual({
      cookieFound: true,
      cookieValid: true,
      hoyolabReachable: true,
      apiReachable: true,
      paired: true,
    });
  });

  it('sem sessão: cookieFound e cookieValid ficam false mesmo se checkHoyolab dissesse valid', async () => {
    const report = await runDoctor({
      ...baseDeps,
      findSession: async () => null,
      // Uma implementação real nunca devolveria valid:true sem sessão, mas
      // runDoctor não deve confiar cegamente nisso — cookieValid tem que
      // exigir cookieFound também.
      checkHoyolab: async () => ({ reachable: true, valid: true }),
    });
    expect(report.cookieFound).toBe(false);
    expect(report.cookieValid).toBe(false);
  });

  it('sessão achada mas inválida', async () => {
    const report = await runDoctor({
      ...baseDeps,
      checkHoyolab: async () => ({ reachable: true, valid: false }),
    });
    expect(report.cookieFound).toBe(true);
    expect(report.cookieValid).toBe(false);
    expect(report.hoyolabReachable).toBe(true);
  });

  it('HoYoLAB e API OneWash inalcançáveis', async () => {
    const report = await runDoctor({
      ...baseDeps,
      findSession: async () => null,
      checkHoyolab: async () => ({ reachable: false, valid: false }),
      checkApi: async () => false,
    });
    expect(report.hoyolabReachable).toBe(false);
    expect(report.apiReachable).toBe(false);
  });

  it('não pareado (sem token) mas o resto ok', async () => {
    const report = await runDoctor({
      ...baseDeps,
      readConfig: () => ({ apiBaseUrl: 'http://x' }),
    });
    expect(report.paired).toBe(false);
  });
});
