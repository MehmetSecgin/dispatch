import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const SDK_IMPORT = JSON.stringify(pathToFileURL(path.join(REPO_ROOT, 'src', 'index.ts')).href);
const ZOD_IMPORT = JSON.stringify(pathToFileURL(path.join(REPO_ROOT, 'node_modules', 'zod', 'index.js')).href);

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

function runCliHuman(args: string[]) {
  const out = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });

  return {
    status: out.status,
    stderr: out.stderr,
    stdout: out.stdout,
  };
}

afterEach(() => {
  for (const entry of fs.readdirSync(os.tmpdir())) {
    if (entry.startsWith('dispatch-module-validate-test-')) {
      fs.rmSync(path.join(os.tmpdir(), entry), { recursive: true, force: true });
    }
  }
});

describe('module CLI', () => {
  it('lets plain node import the repo jsonplaceholder module entry', () => {
    const moduleEntry = pathToFileURL(path.join(REPO_ROOT, 'modules', 'jsonplaceholder', 'index.mjs')).href;
    const out = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import(${JSON.stringify(moduleEntry)}).then((m) => {
          console.log(m.default?.name ?? '');
        }).catch((err) => {
          console.error(err);
          process.exit(1);
        });`,
      ],
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      },
    );

    expect(out.status).toBe(0);
    expect(out.stdout.trim()).toBe('jsonplaceholder');
  });

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

  it('includes discovered module jobs in inspect output', () => {
    const result = runCli(['module', 'inspect', 'jsonplaceholder']);

    expect(result.status).toBe(0);
    expect(result.json?.jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'seed-user-1-reference',
          kind: 'seed',
        }),
      ]),
    );
  });

  it('separates case jobs and seed jobs in human inspect output', () => {
    const result = runCliHuman(['module', 'inspect', 'jsonplaceholder']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Case Jobs:');
    expect(result.stdout).toContain('Seed Jobs:');
    expect(result.stdout).toContain('Seed job seed-user-1-reference');
  });

  it('fails module validate when a case job mutates memory', () => {
    const moduleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-module-validate-test-'));
    fs.mkdirSync(path.join(moduleDir, 'jobs'), { recursive: true });
    fs.writeFileSync(
      path.join(moduleDir, 'module.json'),
      `${JSON.stringify(
        {
          name: 'memory-mutation-fixture',
          version: '1.0.0',
          entry: 'index.mjs',
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(moduleDir, 'index.mjs'),
      [
        `import { defineAction, defineModule } from ${SDK_IMPORT};`,
        `import { z } from ${ZOD_IMPORT};`,
        '',
        'async function noop() {',
        "  return { response: { ok: true }, detail: 'ok' };",
        '}',
        '',
        'export default defineModule({',
        "  name: 'memory-mutation-fixture',",
        "  version: '1.0.0',",
        '  actions: {',
        '    noop: defineAction({',
        "      description: 'No-op fixture action.',",
        '      schema: z.object({}),',
        '      handler: noop,',
        '    }),',
        '  },',
        '});',
        '',
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(
      path.join(moduleDir, 'jobs', 'bad-memory.job.case.json'),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          jobType: 'bad-memory-case',
          scenario: {
            steps: [
              {
                id: 'store',
                action: 'memory.store',
                payload: {
                  namespace: 'fixture',
                  key: 'x',
                  value: 1,
                },
              },
            ],
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    const result = runCli(['module', 'validate', '--path', moduleDir]);

    expect(result.status).toBe(2);
    expect(result.json?.details?.jobIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: expect.stringContaining('bad-memory'),
          message: expect.stringContaining('only allowed in seed jobs'),
        }),
      ]),
    );
  });
});
