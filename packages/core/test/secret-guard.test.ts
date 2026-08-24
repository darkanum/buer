import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, chmodSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Path to the real hook this test guards, relative to this file:
// packages/core/test/secret-guard.test.ts -> repo root -> .husky/pre-commit
const HOOK_SOURCE = fileURLToPath(
  new URL('../../../.husky/pre-commit', import.meta.url),
);

/**
 * Builds a realistic-shaped (long, "v2_"-prefixed) fake secret value at
 * runtime, assembled from fragments so this source file itself never
 * contains the contiguous secret-shaped string the guard scans for.
 * Otherwise committing this very test would trip the guard it verifies —
 * the same self-reference problem the guard's own .husky/ exclusion fixes.
 */
function realisticFakeValue(param: string): string {
  const marker = ['v', '2', '_'].join('');
  const body = ['QWxhZGRpbjpv', 'cGVuIHNlc2Ft', 'ZQabcdefghijklmnop'].join('');
  return `${param}=${marker}${body}`;
}

/**
 * Builds a throwaway git repo and installs the real .husky/pre-commit script
 * as its native git hook, so `git commit` exercises it exactly the way a
 * real commit would (letting git resolve the shebang interpreter itself,
 * which avoids depending on `sh` being on the test runner's PATH).
 */
function makeTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'buer-secret-guard-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@buer.local'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Buer Test'], { cwd: dir });
  const hookDest = join(dir, '.git', 'hooks', 'pre-commit');
  copyFileSync(HOOK_SOURCE, hookDest);
  chmodSync(hookDest, 0o755);
  return dir;
}

/** Stages a file with the given content and attempts to commit it. */
function attemptCommit(dir: string, content: string): { blocked: boolean; message: string } {
  writeFileSync(join(dir, 'sample.txt'), content, 'utf8');
  execFileSync('git', ['add', 'sample.txt'], { cwd: dir });
  try {
    execFileSync('git', ['commit', '-m', 'test commit'], { cwd: dir, stdio: 'pipe' });
    return { blocked: false, message: '' };
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer };
    const message = `${e.stdout?.toString() ?? ''}${e.stderr?.toString() ?? ''}`;
    return { blocked: true, message };
  }
}

describe('secret guard (.husky/pre-commit)', () => {
  let repoDir: string | undefined;

  afterEach(() => {
    if (repoDir) {
      rmSync(repoDir, { recursive: true, force: true });
      repoDir = undefined;
    }
  });

  it('blocks a realistic ltoken_v2 secret value', () => {
    repoDir = makeTempRepo();
    const result = attemptCommit(repoDir, `${realisticFakeValue('ltoken_v2')}\n`);
    expect(result.blocked).toBe(true);
    expect(result.message).toMatch(/cookie do HoYoLAB/);
  });

  it('blocks a realistic cookie_token_v2 secret value', () => {
    repoDir = makeTempRepo();
    const result = attemptCommit(repoDir, `${realisticFakeValue('cookie_token_v2')}\n`);
    expect(result.blocked).toBe(true);
  });

  it('allows short fake test data (paste-provider style fixtures)', () => {
    repoDir = makeTempRepo();
    const result = attemptCommit(repoDir, 'ltoken_v2=abc; ltuid_v2=42\n');
    expect(result.blocked).toBe(false);
  });

  it('allows short fake test data (redaction test fixtures)', () => {
    repoDir = makeTempRepo();
    const result = attemptCommit(repoDir, "redact('ltoken_v2=abc123')\n");
    expect(result.blocked).toBe(false);
  });
});
