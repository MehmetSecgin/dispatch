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

describe('CLI health commands', () => {
  it('passes self-check with module registry status only', () => {
    const result = runCli(['self-check']);

    expect(result.status).toBe(0);
    expect(result.json?.ok).toBe(true);
    expect(result.json?.results).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'module registry',
        ok: true,
      }),
    ]));
    expect(result.json?.results?.some((entry: { name?: string }) => entry.name === 'config file')).toBe(false);
  });

  it('passes doctor without config path checks', () => {
    const result = runCli(['doctor']);

    expect(result.status).toBe(0);
    expect(result.json?.ok).toBe(true);
    expect(result.json?.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'module registry',
      }),
      expect.objectContaining({
        name: 'run-output writable',
      }),
    ]));
    expect(result.json?.checks?.some((entry: { name?: string }) => entry.name === 'config path')).toBe(false);
  });
});
