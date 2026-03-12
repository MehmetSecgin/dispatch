import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveMemoryPath } from '../src/modules/builtin/memory/store.ts';
import { startRegistryFixture } from './helpers/registry-fixture.ts';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const FIXTURE_MODULE_NAME = `zz-memory-deps-fixture-${process.pid}`;
const FIXTURE_MODULE_DIR = path.join(REPO_ROOT, 'modules', FIXTURE_MODULE_NAME);
const FIXTURE_CASE_PATH = path.join(FIXTURE_MODULE_DIR, 'jobs', 'from-memory.job.case.json');
const FIXTURE_HTTP_CASE_PATH = path.join(FIXTURE_MODULE_DIR, 'jobs', 'requires-http.job.case.json');
const MEMORY_CONFIG_DIR = path.join(os.tmpdir(), `dispatch-memory-config-${process.pid}`);
const SDK_IMPORT = JSON.stringify(pathToFileURL(path.join(REPO_ROOT, 'src', 'index.ts')).href);

function runCli(args: string[], env?: NodeJS.ProcessEnv) {
  const out = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', '--json', ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: path.dirname(MEMORY_CONFIG_DIR),
      ...env,
    },
  });

  return {
    status: out.status,
    stderr: out.stderr,
    stdout: out.stdout.trim(),
    json: out.stdout.trim() ? JSON.parse(out.stdout.trim()) : null,
  };
}

async function runCliAsync(args: string[], env?: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/cli.ts', '--json', ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: path.dirname(MEMORY_CONFIG_DIR),
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const status = await new Promise<number | null>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve(code));
  });

  return {
    status,
    stderr,
    stdout: stdout.trim(),
    json: stdout.trim() ? JSON.parse(stdout.trim()) : null,
  };
}

beforeAll(() => {
  fs.rmSync(FIXTURE_MODULE_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(FIXTURE_MODULE_DIR, 'jobs'), { recursive: true });
  fs.writeFileSync(
    path.join(FIXTURE_MODULE_DIR, 'module.json'),
    `${JSON.stringify(
      {
        name: FIXTURE_MODULE_NAME,
        version: '1.0.0',
        entry: 'index.mjs',
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  fs.writeFileSync(
    path.join(FIXTURE_MODULE_DIR, 'index.mjs'),
    [
      "import { z } from 'zod';",
      `import { defineAction, defineModule } from ${SDK_IMPORT};`,
      '',
      'async function getUser(_ctx, payload) {',
      '  return {',
      '    response: {',
      '      id: payload.id,',
      "      name: `User ${payload.id}`,",
      "      role: 'trader',",
      '    },',
      "    detail: `user=${payload.id}`,",
      '  };',
      '}',
      '',
      'export default defineModule({',
      `  name: '${FIXTURE_MODULE_NAME}',`,
      "  version: '1.0.0',",
      '  actions: {',
      "    'get-user': defineAction({",
      "      description: 'Return a deterministic user fixture.',",
      "      schema: z.object({ id: z.union([z.number().int(), z.string().min(1)]) }),",
      '      handler: getUser,',
      '    }),',
      '  },',
      '});',
      '',
    ].join('\n'),
    'utf8',
  );
  fs.writeFileSync(
    path.join(FIXTURE_MODULE_DIR, 'jobs', 'cache-user.job.seed.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        jobType: 'fixture-cache-user',
        scenario: {
          steps: [
            {
              id: 'user',
              action: `${FIXTURE_MODULE_NAME}.get-user`,
              payload: {
                id: 7,
              },
            },
            {
              id: 'store-user',
              action: 'memory.store',
              payload: {
                namespace: 'fixture-reference',
                key: 'users.user-7',
                value: {
                  payload: '${jsonpath(step:user, $)}',
                  meta: {
                    cachedAt: '${run.startedAt}',
                    source: `${FIXTURE_MODULE_NAME}.get-user`,
                    sourceKey: '7',
                  },
                },
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
  fs.writeFileSync(
    FIXTURE_CASE_PATH,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        jobType: 'fixture-from-memory',
        dependencies: {
          memory: [
            {
              namespace: 'fixture-reference',
              key: 'users.user-7',
              fill: {
                module: FIXTURE_MODULE_NAME,
                job: 'cache-user',
              },
            },
          ],
        },
        scenario: {
          steps: [
            {
              id: 'recall-user',
              action: 'memory.recall',
              payload: {
                namespace: 'fixture-reference',
                key: 'users.user-7',
              },
            },
            {
              id: 'verify-user',
              action: `${FIXTURE_MODULE_NAME}.get-user`,
              payload: {
                id: '${step.recall-user.response.value.payload.id}',
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
  fs.writeFileSync(
    FIXTURE_HTTP_CASE_PATH,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        jobType: 'fixture-requires-http',
        http: {
          defaultHeaders: {
            'x-client': 'dispatch-test',
          },
        },
        dependencies: {
          http: {
            required: ['baseUrl', 'defaultHeaders.x-client', 'defaultHeaders.x-brand'],
          },
        },
        scenario: {
          steps: [
            {
              id: 'user',
              action: `${FIXTURE_MODULE_NAME}.get-user`,
              payload: {
                id: 7,
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
  fs.rmSync(path.join(path.dirname(MEMORY_CONFIG_DIR), '.dispatch'), { recursive: true, force: true });
});

afterAll(() => {
  fs.rmSync(FIXTURE_MODULE_DIR, { recursive: true, force: true });
  fs.rmSync(path.join(path.dirname(MEMORY_CONFIG_DIR), '.dispatch'), { recursive: true, force: true });
});

describe('job dependency preflight', () => {
  it('reports missing memory dependencies with a fill-job next action', () => {
    const result = runCli(['job', 'validate', '--case', path.relative(REPO_ROOT, FIXTURE_CASE_PATH)]);

    expect(result.status).toBe(2);
    expect(result.json).toEqual(
      expect.objectContaining({
        status: 'error',
        code: 'USAGE_ERROR',
        next: [
          expect.objectContaining({
            command: expect.stringContaining('cache-user.job.seed.json'),
            description: expect.stringContaining('seed job'),
          }),
        ],
      }),
    );
    expect(result.json?.details?.dependencyIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining('seed with'),
        }),
      ]),
    );
  });

  it('resolves fill jobs before running when --resolve-deps is set', () => {
    const result = runCli(['job', 'run', '--case', path.relative(REPO_ROOT, FIXTURE_CASE_PATH), '--resolve-deps']);

    expect(result.status).toBe(0);
    expect(result.json).toEqual(
      expect.objectContaining({
        status: 'SUCCESS',
        runId: expect.any(String),
        next: expect.any(Array),
      }),
    );

    const memoryPath = resolveMemoryPath(path.join(path.dirname(MEMORY_CONFIG_DIR), '.dispatch'), 'fixture-reference');
    const stored = JSON.parse(fs.readFileSync(memoryPath, 'utf8'));
    expect(stored.users['user-7'].payload).toEqual({
      id: 7,
      name: 'User 7',
      role: 'trader',
    });
  });

  it('fetches missing pinned modules from the registry when --resolve-deps is set', async () => {
    const fixture = await startRegistryFixture({
      moduleName: `zz-remote-job-fixture-${process.pid}`,
      version: '2.0.0',
    });
    const caseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-remote-case-'));
    const casePath = path.join(caseDir, 'remote-fetch.job.case.json');
    fs.writeFileSync(
      casePath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          jobType: 'remote-fetch-case',
          dependencies: {
            modules: [
              {
                name: fixture.moduleName,
                version: fixture.version,
              },
            ],
          },
          scenario: {
            steps: [
              {
                id: 'remote',
                action: `${fixture.moduleName}.ping`,
                payload: {},
              },
            ],
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    try {
      const result = await runCliAsync(['job', 'run', '--case', casePath, '--resolve-deps'], {
        HOME: fixture.homeDir,
      });

      expect(result.status).toBe(0);
      expect(result.json).toEqual(
        expect.objectContaining({
          status: 'SUCCESS',
        }),
      );
      expect(
        fs.existsSync(path.join(fixture.homeDir, '.dispatch', 'modules', `${fixture.moduleName}@${fixture.version}`, 'module.json')),
      ).toBe(true);
    } finally {
      fs.rmSync(caseDir, { recursive: true, force: true });
      await fixture.stop();
    }
  });

  it('reports missing required http config during validate', () => {
    const result = runCli(['job', 'validate', '--case', path.relative(REPO_ROOT, FIXTURE_HTTP_CASE_PATH)]);

    expect(result.status).toBe(2);
    expect(result.json?.details?.dependencyIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dependencyType: 'http',
          httpPath: 'baseUrl',
        }),
        expect.objectContaining({
          dependencyType: 'http',
          httpPath: 'defaultHeaders.x-brand',
        }),
      ]),
    );
  });

  it('reports missing required http config before execution', () => {
    const result = runCli(['job', 'run', '--case', path.relative(REPO_ROOT, FIXTURE_HTTP_CASE_PATH)]);

    expect(result.status).toBe(2);
    expect(result.json).toEqual(
      expect.objectContaining({
        status: 'error',
        code: 'USAGE_ERROR',
        message: 'job dependency preflight failed',
      }),
    );
    expect(result.json?.details?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dependencyType: 'http',
          httpPath: 'baseUrl',
        }),
      ]),
    );
  });
});
