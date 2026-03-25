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
const RUN_FIXTURE_MODULE_NAME = `zz-run-fixture-${process.pid}`;
const RUN_FIXTURE_MODULE_DIR = path.join(REPO_ROOT, 'modules', RUN_FIXTURE_MODULE_NAME);

function runCli(args: string[], env?: NodeJS.ProcessEnv) {
  const out = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', '--json', ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 15000,
    env: {
      ...process.env,
      ...env,
    },
  });

  const stdout = out.stdout.trim();
  return {
    status: out.status,
    stdout,
    stderr: out.stderr,
    json: stdout ? JSON.parse(stdout) : null,
  };
}

function writeFixtureModule(contents: string): void {
  fs.mkdirSync(RUN_FIXTURE_MODULE_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(RUN_FIXTURE_MODULE_DIR, 'module.json'),
    `${JSON.stringify(
      {
        name: RUN_FIXTURE_MODULE_NAME,
        version: '1.0.0',
        entry: 'index.mjs',
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  fs.writeFileSync(path.join(RUN_FIXTURE_MODULE_DIR, 'index.mjs'), contents, 'utf8');
}

afterEach(() => {
  fs.rmSync(RUN_FIXTURE_MODULE_DIR, { recursive: true, force: true });
  for (const entry of fs.readdirSync(os.tmpdir())) {
    if (entry.startsWith('dispatch-run-cli-test-')) {
      fs.rmSync(path.join(os.tmpdir(), entry), { recursive: true, force: true });
    }
  }
});

describe('dispatch run CLI', () => {
  it('runs one action and writes compatible artifacts', () => {
    writeFixtureModule(
      [
        `import { defineAction, defineModule } from ${SDK_IMPORT};`,
        `import { z } from ${ZOD_IMPORT};`,
        'export default defineModule({',
        `  name: '${RUN_FIXTURE_MODULE_NAME}',`,
        "  version: '1.0.0',",
        '  actions: {',
        "    ping: defineAction({",
        "      description: 'Run one action directly.',",
        '      schema: z.object({ count: z.number().int(), enabled: z.boolean() }),',
        "      handler: async (ctx, payload) => { ctx.artifacts.appendActivity(`ping count=${payload.count}`); return { response: payload, detail: 'pong' }; },",
        '    }),',
        '  },',
        '});',
      ].join('\n'),
    );

    const result = runCli(['run', `${RUN_FIXTURE_MODULE_NAME}.ping`, '--input', 'count=3', '--input', 'enabled=true']);

    expect(result.status).toBe(0);
    expect(result.json).toEqual(
      expect.objectContaining({
        cliVersion: expect.any(String),
        action: `${RUN_FIXTURE_MODULE_NAME}.ping`,
        status: 'SUCCESS',
        runId: expect.any(String),
        runDir: expect.any(String),
        response: {
          count: 3,
          enabled: true,
        },
        detail: 'pong',
        next: [
          {
            command: expect.stringContaining('dispatch job readable --run-id'),
            description: 'full request/response trace',
          },
        ],
      }),
    );

    const runDir = result.json?.runDir as string;
    expect(JSON.parse(fs.readFileSync(path.join(runDir, 'meta.json'), 'utf8'))).toEqual(
      expect.objectContaining({
        action: `${RUN_FIXTURE_MODULE_NAME}.ping`,
        runId: result.json?.runId,
      }),
    );
    expect(JSON.parse(fs.readFileSync(path.join(runDir, 'summary.json'), 'utf8'))).toEqual(
      expect.objectContaining({
        runId: result.json?.runId,
        runDir,
        jobType: `action-run:${RUN_FIXTURE_MODULE_NAME}.ping`,
        status: 'SUCCESS',
      }),
    );
    expect(JSON.parse(fs.readFileSync(path.join(runDir, 'module_resolution.json'), 'utf8'))).toEqual(
      expect.objectContaining({
        steps: [
          expect.objectContaining({
            stepAction: `${RUN_FIXTURE_MODULE_NAME}.ping`,
          }),
        ],
      }),
    );
  });

  it('returns NOT_FOUND for an unknown action', () => {
    const result = runCli(['run', 'missing.action']);

    expect(result.status).toBe(4);
    expect(result.json).toEqual(
      expect.objectContaining({
        status: 'error',
        code: 'NOT_FOUND',
      }),
    );
  });

  it('fails with USAGE_ERROR when required inputs are missing', () => {
    writeFixtureModule(
      [
        `import { defineAction, defineModule } from ${SDK_IMPORT};`,
        `import { z } from ${ZOD_IMPORT};`,
        'export default defineModule({',
        `  name: '${RUN_FIXTURE_MODULE_NAME}',`,
        "  version: '1.0.0',",
        '  actions: {',
        "    ping: defineAction({",
        "      description: 'Run one action directly.',",
        '      schema: z.object({ count: z.number().int() }),',
        "      handler: async (_ctx, payload) => ({ response: payload, detail: 'pong' }),",
        '    }),',
        '  },',
        '});',
      ].join('\n'),
    );

    const result = runCli(['run', `${RUN_FIXTURE_MODULE_NAME}.ping`]);

    expect(result.status).toBe(2);
    expect(result.json).toEqual(
      expect.objectContaining({
        status: 'error',
        code: 'USAGE_ERROR',
        message: 'action input preflight failed',
      }),
    );
  });

  it('resolves env-backed credentials for standalone action runs', () => {
    writeFixtureModule(
      [
        `import { defineAction, defineModule } from ${SDK_IMPORT};`,
        `import { z } from ${ZOD_IMPORT};`,
        'export default defineModule({',
        `  name: '${RUN_FIXTURE_MODULE_NAME}',`,
        "  version: '1.0.0',",
        '  actions: {',
        "    login: defineAction({",
        "      description: 'Log in directly.',",
        '      schema: z.object({}),',
        "      credentialSchema: z.object({ token: z.string().min(1) }),",
        "      handler: async (ctx) => ({ response: { token: ctx.credential.token }, detail: 'logged in' }),",
        '    }),',
        '  },',
        '});',
      ].join('\n'),
    );

    const result = runCli(
      ['run', `${RUN_FIXTURE_MODULE_NAME}.login`, '--credential', 'token=RUN_FIXTURE_TOKEN'],
      { RUN_FIXTURE_TOKEN: 'demo-token' },
    );

    expect(result.status).toBe(0);
    expect(result.json).toEqual(
      expect.objectContaining({
        status: 'SUCCESS',
        response: { token: 'demo-token' },
      }),
    );
  });

  it('writes failed summary artifacts and returns next actions when the handler throws', () => {
    writeFixtureModule(
      [
        `import { defineAction, defineModule } from ${SDK_IMPORT};`,
        `import { z } from ${ZOD_IMPORT};`,
        'export default defineModule({',
        `  name: '${RUN_FIXTURE_MODULE_NAME}',`,
        "  version: '1.0.0',",
        '  actions: {',
        "    fail: defineAction({",
        "      description: 'Fail on purpose.',",
        '      schema: z.object({}),',
        "      handler: async () => { throw new Error('boom'); },",
        '    }),',
        '  },',
        '});',
      ].join('\n'),
    );

    const result = runCli(['run', `${RUN_FIXTURE_MODULE_NAME}.fail`]);

    expect(result.status).toBe(1);
    expect(result.json).toEqual(
      expect.objectContaining({
        status: 'error',
        code: 'RUNTIME_ERROR',
        message: 'boom',
        details: expect.objectContaining({
          runId: expect.any(String),
          runDir: expect.any(String),
        }),
        next: [
          {
            command: expect.stringContaining('dispatch job readable --run-id'),
            description: 'full request/response trace',
          },
        ],
      }),
    );

    const summary = JSON.parse(fs.readFileSync(path.join(result.json.details.runDir, 'summary.json'), 'utf8'));
    expect(summary).toEqual(
      expect.objectContaining({
        status: 'FAILED',
      }),
    );
  });
});
