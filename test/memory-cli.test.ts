import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveMemoryPath } from '../src/modules/builtin/memory/store.ts';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(THIS_DIR, '..');

function makeHomeDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-memory-cli-test-'));
}

function runCli(args: string[], homeDir: string) {
  const out = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', '--json', ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: homeDir,
    },
  });

  const stdout = out.stdout.trim();
  return {
    status: out.status,
    stderr: out.stderr,
    stdout,
    json: stdout ? JSON.parse(stdout) : null,
  };
}

afterEach(() => {
  for (const entry of fs.readdirSync(os.tmpdir())) {
    if (entry.startsWith('dispatch-memory-cli-test-')) {
      fs.rmSync(path.join(os.tmpdir(), entry), { recursive: true, force: true });
    }
  }
});

describe('memory CLI', () => {
  it('lists no namespaces on a fresh HOME', () => {
    const homeDir = makeHomeDir();
    const result = runCli(['memory', 'list'], homeDir);

    expect(result.status).toBe(0);
    expect(result.json).toEqual({
      root: path.join(homeDir, '.dispatch', 'memory'),
      namespaces: [],
    });
  });

  it('lists and inspects existing namespaces', () => {
    const homeDir = makeHomeDir();
    const configDir = path.join(homeDir, '.dispatch');
    const memoryPath = resolveMemoryPath(configDir, 'reference-data');
    fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
    fs.writeFileSync(
      memoryPath,
      `${JSON.stringify(
        {
          catalog: {
            primary: {
              payload: {
                entryCount: 1,
              },
            },
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    const listResult = runCli(['memory', 'list'], homeDir);
    const inspectResult = runCli(['memory', 'inspect', '--namespace', 'reference-data'], homeDir);

    expect(listResult.status).toBe(0);
    expect(listResult.json?.namespaces).toEqual([
      {
        namespace: 'reference-data',
        path: memoryPath,
      },
    ]);

    expect(inspectResult.status).toBe(0);
    expect(inspectResult.json).toEqual({
      namespace: 'reference-data',
      path: memoryPath,
      values: {
        catalog: {
          primary: {
            payload: {
              entryCount: 1,
            },
          },
        },
      },
    });
  });

  it('returns NOT_FOUND for a missing namespace', () => {
    const homeDir = makeHomeDir();
    const result = runCli(['memory', 'inspect', '--namespace', 'missing-space'], homeDir);

    expect(result.status).toBe(4);
    expect(result.json).toEqual(
      expect.objectContaining({
        status: 'error',
        code: 'NOT_FOUND',
        message: 'Memory namespace not found: missing-space',
      }),
    );
  });
});
