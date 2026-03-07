import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveMemoryPath } from '../src/modules/builtin/memory/store.ts';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const FIXTURE_MODULE_NAME = `zz-memory-deps-fixture-${process.pid}`;
const FIXTURE_MODULE_DIR = path.join(REPO_ROOT, 'modules', FIXTURE_MODULE_NAME);
const FIXTURE_CASE_PATH = path.join(FIXTURE_MODULE_DIR, 'jobs', 'from-memory.job.case.json');
const MEMORY_CONFIG_DIR = path.join(os.tmpdir(), `dispatch-memory-config-${process.pid}`);

function runCli(args: string[]) {
  const out = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', '--json', ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: path.dirname(MEMORY_CONFIG_DIR),
    },
  });

  return {
    status: out.status,
    stderr: out.stderr,
    stdout: out.stdout.trim(),
    json: out.stdout.trim() ? JSON.parse(out.stdout.trim()) : null,
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
        actions: {
          'get-user': {
            handler: 'getUser',
            description: 'Return a deterministic user fixture.',
          },
        },
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
      '',
      'export const schemas = {',
      "  'get-user': z.object({ id: z.union([z.number().int(), z.string().min(1)]) }),",
      '};',
      '',
      'export async function getUser(_ctx, payload) {',
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
          }),
        ],
      }),
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
});
