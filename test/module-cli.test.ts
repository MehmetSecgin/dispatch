import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(THIS_DIR, '..');

function runCli(args: string[]) {
  const out = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', '--json', ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });

  const stdout = out.stdout.trim();
  return {
    status: out.status,
    stderr: out.stderr,
    json: stdout ? JSON.parse(stdout) : null,
  };
}

describe('module CLI', () => {
  it('omits the duplicate top-level actions array from module list JSON', () => {
    const result = runCli(['module', 'list']);

    expect(result.status).toBe(0);
    expect(result.json?.actions).toBeUndefined();
    expect(result.json?.modules).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: expect.any(String),
        actions: expect.any(Array),
      }),
    ]));
  });

  it('accepts the module name as a positional argument for inspect', () => {
    const result = runCli(['module', 'inspect', 'flow']);

    expect(result.status).toBe(0);
    expect(result.json?.name).toBe('flow');
    expect(result.json?.actionCount).toBeGreaterThan(0);
  });
});
