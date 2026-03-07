import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveMemoryPath } from '../src/modules/builtin/memory/store.ts';

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
    stdout,
    stderr: out.stderr,
    json: stdout ? JSON.parse(stdout) : null,
  };
}

function runCliHuman(args: string[], env?: NodeJS.ProcessEnv) {
  const out = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env,
    },
  });

  return {
    status: out.status,
    stdout: out.stdout,
    stderr: out.stderr,
  };
}

afterEach(() => {
  for (const entry of fs.readdirSync(os.tmpdir())) {
    if (entry.startsWith('dispatch-job-cli-test-')) {
      fs.rmSync(path.join(os.tmpdir(), entry), { recursive: true, force: true });
    }
  }
});

describe('job CLI', () => {
  it('emits exactly one JSON object for job run including next actions', () => {
    const result = runCli(['job', 'run', '--case', 'jobs/flow-sleep.job.case.json']);

    expect(result.status).toBe(0);
    expect(() => JSON.parse(result.stdout)).not.toThrow();
    expect(result.json).toEqual(expect.objectContaining({
      cliVersion: expect.any(String),
      status: 'SUCCESS',
      runId: expect.any(String),
      runDir: expect.any(String),
      moduleResolutionPath: expect.any(String),
      next: expect.any(Array),
    }));
  });

  it('omits next on passing job assert output', () => {
    const runResult = runCli(['job', 'run', '--case', 'jobs/flow-sleep.job.case.json']);
    const assertResult = runCli(['job', 'assert', '--run-id', String(runResult.json?.runId)]);

    expect(runResult.status).toBe(0);
    expect(assertResult.status).toBe(0);
    expect(assertResult.json).toEqual(expect.objectContaining({
      runId: runResult.json?.runId,
      runDir: expect.any(String),
      overall: 'PASS',
      passed: expect.any(Number),
      failed: expect.any(Number),
      checks: expect.any(Array),
    }));
    expect(assertResult.json?.next).toBeUndefined();
  });

  it('returns the assertion result object at the top level on FAIL', () => {
    const runResult = runCli(['job', 'run', '--case', 'jobs/flow-sleep.job.case.json']);
    const assertResult = runCli([
      'job',
      'assert',
      '--run-id',
      String(runResult.json?.runId),
      '--check',
      'calls-count-min',
      '--param',
      'min=99',
    ]);

    expect(runResult.status).toBe(0);
    expect(assertResult.status).toBe(1);
    expect(() => JSON.parse(assertResult.stdout)).not.toThrow();
    expect(assertResult.json).toEqual(expect.objectContaining({
      runId: runResult.json?.runId,
      runDir: expect.any(String),
      overall: 'FAIL',
      passed: expect.any(Number),
      failed: expect.any(Number),
      checks: expect.any(Array),
      next: expect.any(Array),
    }));
    expect(assertResult.json?.status).toBeUndefined();
    expect(assertResult.json?.code).toBeUndefined();
  });

  it('omits next on error envelopes when there are no follow-up actions', () => {
    const result = runCli(['job', 'assert', '--run-id', 'does-not-exist']);

    expect(result.status).toBe(1);
    expect(result.json).toEqual(expect.objectContaining({
      status: 'error',
      code: expect.any(String),
      retryable: expect.any(Boolean),
      message: expect.any(String),
    }));
    expect(result.json?.next).toBeUndefined();
  });

  it('shows declared memory dependencies in successful human validate output', () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-job-cli-test-'));
    const memoryPath = resolveMemoryPath(path.join(homeDir, '.dispatch'), 'jsonplaceholder-reference');
    fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
    fs.writeFileSync(
      memoryPath,
      `${JSON.stringify(
        {
          users: {
            'user-1': {
              payload: {
                id: 1,
              },
            },
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    const result = runCliHuman(
      ['job', 'validate', '--case', 'modules/jsonplaceholder/jobs/jsonplaceholder-from-memory.job.case.json'],
      { HOME: homeDir },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Memory deps:');
    expect(result.stdout).toContain('jsonplaceholder-reference.users.user-1');
    expect(result.stdout).toContain('seed: jsonplaceholder:seed-user-1-reference');
  });
});
