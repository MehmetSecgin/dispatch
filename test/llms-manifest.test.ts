import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(THIS_DIR, '..');

describe('--llms manifest', () => {
  it('prints a compact JSON manifest for agent discovery', () => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', '--llms'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);

    const manifest = JSON.parse(result.stdout);
    expect(manifest).toEqual(expect.objectContaining({
      version: expect.any(String),
      hint: expect.any(String),
      commands: expect.any(Array),
      actions: expect.any(Array),
    }));

    expect(manifest.commands.length).toBeGreaterThan(0);
    expect(manifest.actions.length).toBeGreaterThan(0);
    expect(manifest.commands).toEqual(expect.arrayContaining([
      expect.objectContaining({
        cmd: expect.any(String),
        desc: expect.any(String),
      }),
    ]));
    expect(manifest.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: expect.any(String),
        desc: expect.anything(),
      }),
    ]));

    expect(manifest.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'flow.sleep',
      }),
    ]));
    expect(manifest.commands).toEqual(expect.arrayContaining([
      expect.objectContaining({ cmd: 'job run --case <path>' }),
      expect.objectContaining({ cmd: 'job batch-inspect --batch-id <id>' }),
      expect.objectContaining({ cmd: 'job inspect --run-id <id>' }),
      expect.objectContaining({ cmd: 'job dump --run-id <id>' }),
      expect.objectContaining({ cmd: 'job readable --run-id <id>' }),
      expect.objectContaining({ cmd: 'job assert --run-id <id>' }),
      expect.objectContaining({ cmd: 'module inspect <name>' }),
      expect.objectContaining({ cmd: 'schema case --print' }),
      expect.objectContaining({ cmd: 'schema action --name <module.action> --print' }),
    ]));

    const excluded = ['version', 'skill-version', 'completion', 'self-check', 'help'];
    for (const name of excluded) {
      expect(manifest.commands.some((entry: { cmd: string }) => entry.cmd === name)).toBe(false);
    }
  });
});
