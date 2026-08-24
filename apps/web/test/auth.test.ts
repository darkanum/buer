import { describe, expect, it } from 'vitest';
import { extractApiKeyToken, verifyApiKey } from '../lib/auth.js';
import { makeTestAuth } from './helpers.js';

// Testability note (see task-8.1-report.md): `verifyApiKey`'s second
// parameter injects the Better Auth instance to verify against. Production
// callers omit it and get the real singleton (wired to Postgres via
// lib/db.ts); these tests inject a `createAuth(testDb)` instance backed by
// an in-memory PGlite db carrying Better Auth's own tables (test/helpers.ts)
// — real Better Auth verification logic, real (if ephemeral) storage, no
// live Google/Discord/Postgres/network involved (approach 1 from the brief).

describe('verifyApiKey', () => {
  it('rejeita token ausente', async () => {
    const req = new Request('http://x/api/ingest');
    // No second arg: the missing-token path never touches the auth
    // instance, so this also exercises the real production singleton.
    expect(await verifyApiKey(req)).toBeNull();
  });

  it('rejeita token inválido', async () => {
    const { auth: testAuth } = await makeTestAuth();
    const req = new Request('http://x/api/ingest', { headers: { 'x-api-key': 'ow_live_nope' } });
    expect(await verifyApiKey(req, testAuth)).toBeNull();
  });

  it('resolve o userId dono da chave a partir de um token válido', async () => {
    const { auth: testAuth, insertTestUser } = await makeTestAuth();
    const userId = await insertTestUser('owner@example.com');
    const created = await testAuth.api.createApiKey({
      body: { userId, permissions: { snapshots: ['write'] } },
    });

    const req = new Request('http://x/api/ingest', { headers: { 'x-api-key': created.key } });
    expect(await verifyApiKey(req, testAuth)).toEqual({ userId });
  });

  it('nunca deriva o userId do corpo da requisição', async () => {
    const { auth: testAuth, insertTestUser } = await makeTestAuth();
    const userId = await insertTestUser('owner2@example.com');
    const created = await testAuth.api.createApiKey({
      body: { userId, permissions: { snapshots: ['write'] } },
    });

    const req = new Request('http://x/api/ingest', {
      method: 'POST',
      headers: { 'x-api-key': created.key, 'content-type': 'application/json' },
      // A malicious/careless body claiming a different user must be ignored.
      body: JSON.stringify({ userId: 'someone-else' }),
    });
    expect(await verifyApiKey(req, testAuth)).toEqual({ userId });
  });
});

describe('extractApiKeyToken', () => {
  it('prefere Authorization: Bearer sobre x-api-key', () => {
    const req = new Request('http://x/api/ingest', {
      headers: { authorization: 'Bearer from-bearer', 'x-api-key': 'from-x-api-key' },
    });
    expect(extractApiKeyToken(req)).toBe('from-bearer');
  });

  it('usa x-api-key quando não há Authorization', () => {
    const req = new Request('http://x/api/ingest', { headers: { 'x-api-key': 'from-x-api-key' } });
    expect(extractApiKeyToken(req)).toBe('from-x-api-key');
  });

  it('retorna null quando nenhum header está presente', () => {
    const req = new Request('http://x/api/ingest');
    expect(extractApiKeyToken(req)).toBeNull();
  });
});
