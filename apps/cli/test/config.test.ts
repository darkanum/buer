import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readConfig, writeConfig, redactConfig } from '../src/config.js';

describe('config', () => {
  it('grava com permissão 0600 e lê de volta', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ow-'));
    writeConfig({ apiToken: 'ow_live_secret', apiBaseUrl: 'http://x' }, dir);
    expect(readConfig(dir).apiToken).toBe('ow_live_secret');
    if (process.platform !== 'win32') {
      expect(statSync(join(dir, 'config.json')).mode & 0o777).toBe(0o600);
    }
  });
  it('redactConfig nunca revela o token', () => {
    const r = redactConfig({ apiToken: 'ow_live_secret', apiBaseUrl: 'http://x' });
    expect(JSON.stringify(r)).not.toContain('secret');
    expect(r.paired).toBe(true);
  });
});
