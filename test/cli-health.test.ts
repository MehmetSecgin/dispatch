import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(THIS_DIR, '..');

function runCli(args: string[], env?: NodeJS.ProcessEnv) {
  const out = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', '--json', ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env,
    },
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
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-cli-health-'));
    const result = runCli(['doctor'], { HOME: homeDir });

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

  it('reports legacy installed modules during doctor', () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-cli-health-'));
    const installDir = path.join(homeDir, '.dispatch', 'modules', 'legacy-fixture@1.0.0');
    fs.mkdirSync(installDir, { recursive: true });
    fs.writeFileSync(
      path.join(installDir, 'module.json'),
      `${JSON.stringify({ name: 'legacy-fixture', version: '1.0.0', entry: 'index.mjs' }, null, 2)}\n`,
      'utf8',
    );
    fs.writeFileSync(path.join(installDir, 'index.mjs'), 'export default {};\n', 'utf8');

    const result = runCli(['doctor'], { HOME: homeDir });

    expect(result.status).toBe(1);
    expect(result.json?.details?.result?.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'legacy installed modules',
          ok: false,
        }),
      ]),
    );
  });
});
