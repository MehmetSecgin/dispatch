import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveMemoryPath } from '../src/modules/builtin/memory/store.ts';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const TSX_LOADER = path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'loader.mjs');
const SDK_IMPORT = JSON.stringify(pathToFileURL(path.join(REPO_ROOT, 'src', 'index.ts')).href);
const ZOD_IMPORT = JSON.stringify(pathToFileURL(path.join(REPO_ROOT, 'node_modules', 'zod', 'index.js')).href);
const HTTP_FIXTURE_MODULE_NAME = `zz-job-http-fixture-${process.pid}`;
const HTTP_FIXTURE_MODULE_DIR = path.join(REPO_ROOT, 'modules', HTTP_FIXTURE_MODULE_NAME);

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

function runCliIn(cwd: string, args: string[], env?: NodeJS.ProcessEnv) {
  const out = spawnSync(process.execPath, ['--import', TSX_LOADER, path.join(REPO_ROOT, 'src', 'cli.ts'), '--json', ...args], {
    cwd,
    encoding: 'utf8',
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

afterEach(() => {
  for (const entry of fs.readdirSync(os.tmpdir())) {
    if (entry.startsWith('dispatch-job-cli-test-')) {
      fs.rmSync(path.join(os.tmpdir(), entry), { recursive: true, force: true });
    }
  }
  fs.rmSync(HTTP_FIXTURE_MODULE_DIR, { recursive: true, force: true });
});

describe('job CLI', () => {
  it('validates a workspace job against repo-local modules even when invoked outside the repo root', () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-job-cli-test-'));
    const externalCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-job-cli-test-'));
    const moduleDir = path.join(workspaceDir, 'modules', 'workspace-job-fixture');
    fs.mkdirSync(moduleDir, { recursive: true });
    fs.writeFileSync(
      path.join(moduleDir, 'module.json'),
      `${JSON.stringify({ name: 'workspace-job-fixture', version: '1.0.0', entry: 'index.mjs' }, null, 2)}\n`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(moduleDir, 'index.mjs'),
      [
        `import { defineAction, defineModule } from ${SDK_IMPORT};`,
        `import { z } from ${ZOD_IMPORT};`,
        'export default defineModule({',
        "  name: 'workspace-job-fixture',",
        "  version: '1.0.0',",
        '  actions: {',
        '    ping: defineAction({',
        "      description: 'Ping a workspace-local action.',",
        '      schema: z.object({}),',
        "      handler: async () => ({ response: { ok: true }, detail: 'pong' }),",
        '    }),',
        '  },',
        '});',
      ].join('\n'),
      'utf8',
    );
    const casePath = path.join(workspaceDir, 'jobs', 'workspace.job.case.json');
    fs.mkdirSync(path.dirname(casePath), { recursive: true });
    fs.writeFileSync(
      casePath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          jobType: 'workspace-job',
          scenario: {
            steps: [
              {
                id: 'ping',
                action: 'workspace-job-fixture.ping',
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

    const result = runCliIn(externalCwd, ['job', 'validate', '--case', casePath]);

    expect(result.status).toBe(0);
    expect(result.json).toEqual(expect.objectContaining({ valid: true }));
  });

  it('captures action exports into run scope for later steps', () => {
    fs.mkdirSync(HTTP_FIXTURE_MODULE_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(HTTP_FIXTURE_MODULE_DIR, 'module.json'),
      `${JSON.stringify(
        {
          name: HTTP_FIXTURE_MODULE_NAME,
          version: '1.0.0',
          entry: 'index.mjs',
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(HTTP_FIXTURE_MODULE_DIR, 'index.mjs'),
      [
        `import { defineAction, defineModule } from ${SDK_IMPORT};`,
        `import { z } from ${ZOD_IMPORT};`,
        '',
        'async function publish(_ctx, payload) {',
        "  const generatedId = payload.generatedId || 'generated-id';",
        '  return {',
        '    response: { ok: true },',
        '    exports: { generatedId },',
        "    detail: `published=${generatedId}`,",
        '  };',
        '}',
        '',
        'async function consume(_ctx, payload) {',
        "  if (payload.generatedId !== 'generated-id') throw new Error(`unexpected generatedId=${payload.generatedId}`);",
        "  return { response: { consumed: payload.generatedId }, detail: 'consumed export' };",
        '}',
        '',
        'export default defineModule({',
        `  name: '${HTTP_FIXTURE_MODULE_NAME}',`,
        "  version: '1.0.0',",
        '  actions: {',
        "    publish: defineAction({",
        "      description: 'Generate or reuse an identifier.',",
        "      schema: z.object({ generatedId: z.string().min(1).optional() }),",
        '      handler: publish,',
        '    }),',
        "    consume: defineAction({",
        "      description: 'Consume an identifier from a prior step export.',",
        "      schema: z.object({ generatedId: z.string().min(1) }),",
        '      handler: consume,',
        '    }),',
        '  },',
        '});',
        '',
      ].join('\n'),
      'utf8',
    );

    const casePath = path.join(HTTP_FIXTURE_MODULE_DIR, 'step-exports.job.case.json');
    fs.writeFileSync(
      casePath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          jobType: 'step-exports',
          scenario: {
            steps: [
              {
                id: 'publish',
                action: `${HTTP_FIXTURE_MODULE_NAME}.publish`,
                payload: {},
                capture: {
                  workflowId: 'exports.generatedId',
                },
              },
              {
                id: 'consume',
                action: `${HTTP_FIXTURE_MODULE_NAME}.consume`,
                payload: {
                  generatedId: '${run.workflowId}',
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

    const result = runCli(['job', 'run', '--case', path.relative(REPO_ROOT, casePath)]);

    expect(result.status).toBe(0);
    expect(result.json).toEqual(expect.objectContaining({
      status: 'SUCCESS',
      runDir: expect.any(String),
    }));
  });

  it('resolves env-backed credential profiles into ctx.credential without putting secrets in the job payload', () => {
    fs.mkdirSync(HTTP_FIXTURE_MODULE_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(HTTP_FIXTURE_MODULE_DIR, 'module.json'),
      `${JSON.stringify(
        {
          name: HTTP_FIXTURE_MODULE_NAME,
          version: '1.0.0',
          entry: 'index.mjs',
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(HTTP_FIXTURE_MODULE_DIR, 'index.mjs'),
      [
        `import { defineAction, defineModule } from ${SDK_IMPORT};`,
        `import { z } from ${ZOD_IMPORT};`,
        '',
        'async function login(ctx) {',
        "  if (!ctx.credential || typeof ctx.credential !== 'object') throw new Error('missing credential');",
        "  const credential = ctx.credential;",
        "  if (credential.username !== 'demo-user' || credential.password !== 'demo-pass') throw new Error('unexpected credential');",
        "  return { response: { username: credential.username }, detail: 'logged in with credential profile' };",
        '}',
        '',
        'export default defineModule({',
        `  name: '${HTTP_FIXTURE_MODULE_NAME}',`,
        "  version: '1.0.0',",
        '  actions: {',
        "    login: defineAction({",
        "      description: 'Log in with a credential profile.',",
        '      schema: z.object({}),',
        "      credentialSchema: z.object({ username: z.string().min(1), password: z.string().min(1) }),",
        '      handler: login,',
        '    }),',
        '  },',
        '});',
        '',
      ].join('\n'),
      'utf8',
    );

    const casePath = path.join(HTTP_FIXTURE_MODULE_DIR, 'credential-profile.job.case.json');
    fs.writeFileSync(
      casePath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          jobType: 'credential-profile',
          credentials: {
            adminQa: {
              fromEnv: {
                username: 'DISPATCH_ADMIN_USERNAME',
                password: 'DISPATCH_ADMIN_PASSWORD',
              },
            },
          },
          scenario: {
            steps: [
              {
                id: 'login',
                action: `${HTTP_FIXTURE_MODULE_NAME}.login`,
                credential: 'adminQa',
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

    const result = runCli(['job', 'run', '--case', path.relative(REPO_ROOT, casePath)], {
      DISPATCH_ADMIN_USERNAME: 'demo-user',
      DISPATCH_ADMIN_PASSWORD: 'demo-pass',
    });

    expect(result.status).toBe(0);
    expect(result.json).toEqual(expect.objectContaining({
      status: 'SUCCESS',
      runDir: expect.any(String),
    }));

    const inputCase = JSON.parse(fs.readFileSync(path.join(result.json?.runDir, 'job.case.input.json'), 'utf8'));
    expect(inputCase.credentials.adminQa.fromEnv).toEqual({
      username: 'DISPATCH_ADMIN_USERNAME',
      password: '[REDACTED]',
    });
  });

  it('fails job run preflight when required credential env vars are missing', () => {
    fs.mkdirSync(HTTP_FIXTURE_MODULE_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(HTTP_FIXTURE_MODULE_DIR, 'module.json'),
      `${JSON.stringify(
        {
          name: HTTP_FIXTURE_MODULE_NAME,
          version: '1.0.0',
          entry: 'index.mjs',
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(HTTP_FIXTURE_MODULE_DIR, 'index.mjs'),
      [
        `import { defineAction, defineModule } from ${SDK_IMPORT};`,
        `import { z } from ${ZOD_IMPORT};`,
        '',
        'export default defineModule({',
        `  name: '${HTTP_FIXTURE_MODULE_NAME}',`,
        "  version: '1.0.0',",
        '  actions: {',
        "    login: defineAction({",
        "      description: 'Log in with a credential profile.',",
        '      schema: z.object({}),',
        "      credentialSchema: z.object({ username: z.string().min(1), password: z.string().min(1) }),",
        "      handler: async () => ({ response: { ok: true } }),",
        '    }),',
        '  },',
        '});',
        '',
      ].join('\n'),
      'utf8',
    );

    const casePath = path.join(HTTP_FIXTURE_MODULE_DIR, 'missing-credential-env.job.case.json');
    fs.writeFileSync(
      casePath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          jobType: 'missing-credential-env',
          credentials: {
            adminQa: {
              fromEnv: {
                username: 'DISPATCH_ADMIN_USERNAME',
                password: 'DISPATCH_ADMIN_PASSWORD',
              },
            },
          },
          scenario: {
            steps: [
              {
                id: 'login',
                action: `${HTTP_FIXTURE_MODULE_NAME}.login`,
                credential: 'adminQa',
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

    const result = runCli(['job', 'run', '--case', path.relative(REPO_ROOT, casePath)], {
      DISPATCH_ADMIN_USERNAME: 'demo-user',
    });

    expect(result.status).toBe(2);
    expect(result.json).toEqual(expect.objectContaining({
      status: 'error',
      code: 'USAGE_ERROR',
      message: 'job credential preflight failed',
      details: expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({
            message: expect.stringContaining("Missing required environment variable 'DISPATCH_ADMIN_PASSWORD'"),
          }),
        ]),
      }),
    }));
  });

  it('fails job validate when an action requires a credential profile but the job does not bind one', () => {
    fs.mkdirSync(HTTP_FIXTURE_MODULE_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(HTTP_FIXTURE_MODULE_DIR, 'module.json'),
      `${JSON.stringify(
        {
          name: HTTP_FIXTURE_MODULE_NAME,
          version: '1.0.0',
          entry: 'index.mjs',
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(HTTP_FIXTURE_MODULE_DIR, 'index.mjs'),
      [
        `import { defineAction, defineModule } from ${SDK_IMPORT};`,
        `import { z } from ${ZOD_IMPORT};`,
        '',
        'export default defineModule({',
        `  name: '${HTTP_FIXTURE_MODULE_NAME}',`,
        "  version: '1.0.0',",
        '  actions: {',
        "    login: defineAction({",
        "      description: 'Log in with a credential profile.',",
        '      schema: z.object({}),',
        "      credentialSchema: z.object({ username: z.string().min(1), password: z.string().min(1) }),",
        "      handler: async () => ({ response: { ok: true } }),",
        '    }),',
        '  },',
        '});',
        '',
      ].join('\n'),
      'utf8',
    );

    const casePath = path.join(HTTP_FIXTURE_MODULE_DIR, 'missing-credential-binding.job.case.json');
    fs.writeFileSync(
      casePath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          jobType: 'missing-credential-binding',
          scenario: {
            steps: [
              {
                id: 'login',
                action: `${HTTP_FIXTURE_MODULE_NAME}.login`,
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

    const result = runCli(['job', 'validate', '--case', path.relative(REPO_ROOT, casePath)]);

    expect(result.status).toBe(2);
    expect(result.json).toEqual(expect.objectContaining({
      status: 'error',
      code: 'USAGE_ERROR',
      message: 'job case validation failed',
      details: expect.objectContaining({
        credentialIssues: expect.arrayContaining([
          expect.objectContaining({
            message: expect.stringContaining('requires a credential profile'),
          }),
        ]),
      }),
    }));
  });

  it('fails job validate when env-backed http config is missing', () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-job-cli-test-'));
    const casePath = path.join(homeDir, 'env-http-missing.job.case.json');
    fs.writeFileSync(
      casePath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          jobType: 'env-http-missing',
          http: {
            baseUrl: '${env.DISPATCH_HTTP_BASE_URL}',
            defaultHeaders: {
              'x-context': '${env.DISPATCH_HTTP_X_CONTEXT}',
            },
          },
          dependencies: {
            http: {
              required: ['baseUrl', 'defaultHeaders.x-context'],
            },
          },
          scenario: {
            steps: [
              {
                id: 'sleep',
                action: 'flow.sleep',
                payload: {
                  duration: '1ms',
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

    const result = runCli(['job', 'validate', '--case', casePath], { HOME: homeDir });

    expect(result.status).toBe(2);
    expect(result.json).toEqual(expect.objectContaining({
      status: 'error',
      code: 'USAGE_ERROR',
      message: 'job case validation failed',
      details: expect.objectContaining({
        dependencyIssues: expect.arrayContaining([
          expect.objectContaining({
            dependencyType: 'http',
            httpPath: 'baseUrl',
            message: expect.stringContaining('must resolve to a non-empty string'),
          }),
        ]),
      }),
    }));
  });

  it('resolves env-backed job http config and writes it to the resolved case artifact', () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-job-cli-test-'));
    const casePath = path.join(homeDir, 'env-http-resolved.job.case.json');
    fs.writeFileSync(
      casePath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          jobType: 'env-http-resolved',
          http: {
            baseUrl: '${env.DISPATCH_HTTP_BASE_URL}',
            defaultHeaders: {
              'x-context': '${env.DISPATCH_HTTP_X_CONTEXT}',
              'x-started-at': '${run.startedAt}',
            },
          },
          scenario: {
            steps: [
              {
                id: 'sleep',
                action: 'flow.sleep',
                payload: {
                  duration: '1ms',
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

    const result = runCli(['job', 'run', '--case', casePath], {
      HOME: homeDir,
      DISPATCH_HTTP_BASE_URL: 'https://api.example.test',
      DISPATCH_HTTP_X_CONTEXT: 'example-context',
    });

    expect(result.status).toBe(0);
    expect(result.json).toEqual(expect.objectContaining({
      status: 'SUCCESS',
      runDir: expect.any(String),
    }));

    const resolvedCase = JSON.parse(fs.readFileSync(path.join(result.json?.runDir, 'job.case.resolved.json'), 'utf8'));
    expect(resolvedCase.http).toEqual({
      baseUrl: 'https://api.example.test',
      defaultHeaders: {
        'x-context': 'example-context',
        'x-started-at': expect.any(String),
      },
    });
  });

  it('applies job-level http defaults across steps and keeps cookies run-scoped', async () => {
    fs.mkdirSync(HTTP_FIXTURE_MODULE_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(HTTP_FIXTURE_MODULE_DIR, 'module.json'),
      `${JSON.stringify(
        {
          name: HTTP_FIXTURE_MODULE_NAME,
          version: '1.0.0',
          entry: 'index.mjs',
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(HTTP_FIXTURE_MODULE_DIR, 'index.mjs'),
      [
        `import { defineAction, defineModule } from ${SDK_IMPORT};`,
        `import { z } from ${ZOD_IMPORT};`,
        '',
        'async function login(ctx, payload) {',
        "  const resp = await ctx.http.post('/login', { user: payload.user });",
        "  const response = ctx.http.requireOk(resp, 'login');",
        "  return { response, detail: 'logged in' };",
        '}',
        '',
        'async function me(ctx) {',
        "  const resp = await ctx.http.get('/me');",
        "  const response = ctx.http.requireOk(resp, 'me');",
        "  return { response, detail: 'fetched me' };",
        '}',
        '',
        'export default defineModule({',
        `  name: '${HTTP_FIXTURE_MODULE_NAME}',`,
        "  version: '1.0.0',",
        '  actions: {',
        "    login: defineAction({",
        "      description: 'Log in to the fixture API.',",
        "      schema: z.object({ user: z.string().min(1) }),",
        '      handler: login,',
        '    }),',
        "    me: defineAction({",
        "      description: 'Fetch the current user from the fixture API.',",
        '      schema: z.object({}),',
        '      handler: me,',
        '    }),',
        '  },',
        '});',
        '',
      ].join('\n'),
      'utf8',
    );

    const requestLogPath = path.join(HTTP_FIXTURE_MODULE_DIR, 'http-log.jsonl');
    const serverScript = `
      const fs = require('node:fs');
      const http = require('node:http');
      const logPath = process.argv[1];
      const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk.toString();
        });
        req.on('end', () => {
          fs.appendFileSync(logPath, JSON.stringify({
            url: req.url || '',
            method: req.method || '',
            headers: req.headers,
            body,
          }) + '\\n', 'utf8');
          if (req.url === '/login' && req.method === 'POST') {
            res.setHeader('Set-Cookie', 'sid=fixture-session; Path=/; HttpOnly');
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
            return;
          }
          if (req.url === '/me' && req.method === 'GET') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, cookie: req.headers.cookie || null }));
            return;
          }
          res.statusCode = 404;
          res.end(JSON.stringify({ error: 'not found' }));
        });
      });
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') process.exit(1);
        process.stdout.write(String(address.port));
      });
    `;
    const server = spawn(process.execPath, ['-e', serverScript, requestLogPath], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    const port = await new Promise<number>((resolve, reject) => {
      let output = '';
      const onData = (chunk: Buffer) => {
        output += chunk.toString();
        const trimmed = output.trim();
        if (!trimmed) return;
        server.stdout.off('data', onData);
        resolve(Number(trimmed));
      };
      server.stdout.on('data', onData);
      server.once('error', reject);
      server.once('exit', (code) => {
        if (!output.trim()) reject(new Error(`Fixture server exited before announcing port (${code ?? 'null'})`));
      });
    });
    if (!Number.isInteger(port) || port <= 0) throw new Error('Failed to start fixture server');

    const casePath = path.join(HTTP_FIXTURE_MODULE_DIR, 'shared-http.job.case.json');
    fs.writeFileSync(
      casePath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          jobType: 'shared-http-defaults',
          http: {
            baseUrl: `http://127.0.0.1:${port}`,
            defaultHeaders: {
              'x-client': 'dispatch-test',
              'x-run-started-at': '${run.startedAt}',
            },
          },
          scenario: {
            steps: [
              {
                id: 'login',
                action: `${HTTP_FIXTURE_MODULE_NAME}.login`,
                payload: {
                  user: 'demo',
                },
              },
              {
                id: 'me',
                action: `${HTTP_FIXTURE_MODULE_NAME}.me`,
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
      const result = runCli(['job', 'run', '--case', path.relative(REPO_ROOT, casePath)]);
      const seen = fs
        .readFileSync(requestLogPath, 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line));

      expect(result.status).toBe(0);
      expect(result.json).toEqual(expect.objectContaining({
        status: 'SUCCESS',
        runId: expect.any(String),
        runDir: expect.any(String),
      }));
      expect(seen).toHaveLength(2);
      expect(seen[0].url).toBe('/login');
      expect(seen[0].headers['x-client']).toBe('dispatch-test');
      expect(seen[0].headers['x-run-started-at']).toEqual(expect.any(String));
      expect(seen[1].url).toBe('/me');
      expect(seen[1].headers['x-client']).toBe('dispatch-test');
      expect(seen[1].headers.cookie).toBe('sid=fixture-session');

      const resolvedCase = JSON.parse(fs.readFileSync(path.join(result.json?.runDir, 'job.case.resolved.json'), 'utf8'));
      expect(resolvedCase.http).toEqual({
        baseUrl: `http://127.0.0.1:${port}`,
        defaultHeaders: {
          'x-client': 'dispatch-test',
          'x-run-started-at': expect.any(String),
        },
      });
    } finally {
      server.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        server.once('exit', () => resolve());
      });
    }
  });

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

  it('shows declared http dependencies in successful human validate output', () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-job-cli-test-'));
    const casePath = path.join(homeDir, 'http-deps.job.case.json');
    fs.writeFileSync(
      casePath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          jobType: 'http-deps-fixture',
          http: {
            baseUrl: 'https://api.example.test',
            defaultHeaders: {
              'x-client': 'dispatch-test',
            },
          },
          dependencies: {
            http: {
              required: ['baseUrl', 'defaultHeaders.x-client'],
            },
          },
          scenario: {
            steps: [
              {
                id: 'sleep',
                action: 'flow.sleep',
                payload: {
                  duration: '1ms',
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

    const result = runCliHuman(['job', 'validate', '--case', casePath], { HOME: homeDir });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('HTTP deps:');
    expect(result.stdout).toContain('http.baseUrl');
    expect(result.stdout).toContain('http.defaultHeaders.x-client');
  });
});
