import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectInstalledArtifactDir } from '../src/modules/artifact.ts';
import { startRegistryFixture } from './helpers/registry-fixture.ts';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const TSX_LOADER = path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'loader.mjs');
const SDK_IMPORT = JSON.stringify(pathToFileURL(path.join(REPO_ROOT, 'src', 'index.ts')).href);
const ZOD_IMPORT = JSON.stringify(pathToFileURL(path.join(REPO_ROOT, 'node_modules', 'zod', 'index.js')).href);
const EXPORT_FIXTURE_MODULE_NAME = `zz-exports-fixture-${process.pid}`;
const EXPORT_FIXTURE_MODULE_DIR = path.join(REPO_ROOT, 'modules', EXPORT_FIXTURE_MODULE_NAME);

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
    stderr: out.stderr,
    stdout: out.stdout,
  };
}

function runCliHumanIn(cwd: string, args: string[], env?: NodeJS.ProcessEnv) {
  const out = spawnSync(process.execPath, ['--import', TSX_LOADER, path.join(REPO_ROOT, 'src', 'cli.ts'), ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env,
    },
  });

  return {
    status: out.status,
    stderr: out.stderr,
    stdout: out.stdout,
  };
}

function runCliIn(cwd: string, args: string[], env?: NodeJS.ProcessEnv) {
  const out = spawnSync(
    process.execPath,
    ['--import', TSX_LOADER, path.join(REPO_ROOT, 'src', 'cli.ts'), '--json', ...args],
    {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        ...env,
      },
    },
  );

  const stdout = out.stdout.trim();
  return {
    status: out.status,
    stderr: out.stderr,
    stdout,
    json: stdout ? JSON.parse(stdout) : null,
  };
}

async function runCliHumanAsync(args: string[], env?: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
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

  return { status, stdout, stderr };
}

afterEach(() => {
  for (const entry of fs.readdirSync(os.tmpdir())) {
    if (entry.startsWith('dispatch-module-init-test-')) {
      fs.rmSync(path.join(os.tmpdir(), entry), { recursive: true, force: true });
    }
    if (entry.startsWith('dispatch-module-validate-test-')) {
      fs.rmSync(path.join(os.tmpdir(), entry), { recursive: true, force: true });
    }
    if (entry.startsWith('dispatch-module-pack-test-')) {
      fs.rmSync(path.join(os.tmpdir(), entry), { recursive: true, force: true });
    }
  }
  fs.rmSync(EXPORT_FIXTURE_MODULE_DIR, { recursive: true, force: true });
});

describe('module CLI', () => {
  it('initializes a TypeScript scaffold with build-oriented defaults', () => {
    const moduleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-module-init-test-'));
    const result = runCliHuman(['module', 'init', '--name', 'ts-fixture', '--out', moduleDir, '--typescript']);
    const manifest = JSON.parse(fs.readFileSync(path.join(moduleDir, 'module.json'), 'utf8'));
    const sourceIndex = fs.readFileSync(path.join(moduleDir, 'src', 'index.ts'), 'utf8');
    const sourceSchemas = fs.readFileSync(path.join(moduleDir, 'src', 'schemas.ts'), 'utf8');
    const sourceConstants = fs.readFileSync(path.join(moduleDir, 'src', 'constants.ts'), 'utf8');
    const tsconfig = fs.readFileSync(path.join(moduleDir, 'tsconfig.json'), 'utf8');
    const tsupConfig = fs.readFileSync(path.join(moduleDir, 'tsup.config.ts'), 'utf8');

    expect(result.status).toBe(0);
    expect(manifest).toEqual({
      name: 'ts-fixture',
      version: '0.1.0',
      entry: 'dist/index.mjs',
      metadata: {
        generatedBy: 'dispatch module init --typescript',
      },
    });
    expect(sourceIndex).toContain('type ActionContext, type ActionResult');
    expect(sourceIndex).toContain('ctx.artifacts.appendActivity(`${PING_ACTIVITY} ok=true`)');
    expect(sourceSchemas).toContain('export const PingSchema = z.object({});');
    expect(sourceConstants).toContain("export const PING_ACTIVITY = 'ping';");
    expect(tsconfig).toContain('"module": "NodeNext"');
    expect(tsupConfig).toContain("entry: ['src/index.ts']");
    expect(tsupConfig).toContain("external: ['dispatchkit', 'zod']");
    expect(tsupConfig).toContain("outDir: 'dist'");
    expect(tsupConfig).toContain("js: '.mjs'");
    expect(fs.existsSync(path.join(moduleDir, 'index.mjs'))).toBe(false);
  });

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

  it('installs a module from the configured registry with env-interpolated auth', async () => {
    const fixture = await startRegistryFixture({
      moduleName: `zz-registry-fixture-${process.pid}`,
      version: '1.2.3',
      authToken: 'token-123',
    });

    try {
      const installResult = await runCliHumanAsync(
        ['module', 'install', '--name', fixture.moduleName, '--version', fixture.version],
        {
        HOME: fixture.homeDir,
        DISPATCH_TEST_REGISTRY_TOKEN: 'token-123',
        },
      );
      const inspectResult = runCli(['module', 'inspect', fixture.moduleName], {
        HOME: fixture.homeDir,
        DISPATCH_TEST_REGISTRY_TOKEN: 'token-123',
      });
      const installDir = path.join(fixture.homeDir, '.dispatch', 'modules', `${fixture.moduleName}@${fixture.version}`);

      expect(installResult.status).toBe(0);
      expect(installResult.stdout).toContain(`Installed ${fixture.moduleName}@${fixture.version}`);
      expect(fs.existsSync(path.join(installDir, 'module.json'))).toBe(true);
      expect(fs.existsSync(path.join(installDir, 'artifact.json'))).toBe(true);
      expect(fs.existsSync(path.join(installDir, 'dist', 'index.mjs'))).toBe(true);
      expect(inspectResult.status).toBe(0);
      expect(inspectResult.json?.name).toBe(fixture.moduleName);
      expect(inspectResult.json?.version).toBe(fixture.version);
      expect(fixture.authHeaders).toContain('Bearer token-123');
    } finally {
      await fixture.stop();
    }
  });

  it('omits the duplicate top-level actions array from module list JSON', () => {
    const result = runCli(['module', 'list']);

    expect(result.status).toBe(0);
    expect(result.json?.actions).toBeUndefined();
    expect(result.json?.modules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: expect.any(String),
          actions: expect.any(Array),
        }),
      ]),
    );
  });

  it('discovers workspace-local modules from the current repo clone', () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-module-validate-test-'));
    const moduleDir = path.join(workspaceDir, 'modules', 'workspace-fixture');
    fs.mkdirSync(moduleDir, { recursive: true });
    fs.writeFileSync(
      path.join(moduleDir, 'module.json'),
      `${JSON.stringify(
        {
          name: 'workspace-fixture',
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
        'export default defineModule({',
        "  name: 'workspace-fixture',",
        "  version: '1.0.0',",
        '  actions: {',
        '    ping: defineAction({',
        "      description: 'Ping from workspace clone.',",
        '      schema: z.object({}),',
        "      handler: async () => ({ response: { ok: true }, detail: 'pong' }),",
        '    }),',
        '  },',
        '});',
        '',
      ].join('\n'),
      'utf8',
    );

    const result = runCliIn(workspaceDir, ['module', 'list']);

    expect(result.status).toBe(0);
    expect(result.json?.modules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'workspace-fixture',
          layer: 'repo',
        }),
      ]),
    );
  });

  it('accepts the module name as a positional argument for inspect', () => {
    const result = runCli(['module', 'inspect', 'flow']);

    expect(result.status).toBe(0);
    expect(result.json?.name).toBe('flow');
    expect(result.json?.actionCount).toBeGreaterThan(0);
  });

  it('prints module SKILL.md from disk', () => {
    const moduleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-module-init-test-'));
    fs.writeFileSync(path.join(moduleDir, 'SKILL.md'), '# fixture skill\n\nUse carefully.\n', 'utf8');

    const result = runCliHuman(['module', 'skill', '--path', moduleDir]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe('# fixture skill\n\nUse carefully.\n');
  });

  it('fails module skill when SKILL.md is missing', () => {
    const moduleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-module-init-test-'));

    const result = runCliHuman(['module', 'skill', '--path', moduleDir]);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(`No SKILL.md found at ${path.join(moduleDir, 'SKILL.md')}`);
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

  it('shows declared action exports in inspect and schema output', () => {
    fs.mkdirSync(EXPORT_FIXTURE_MODULE_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(EXPORT_FIXTURE_MODULE_DIR, 'module.json'),
      `${JSON.stringify(
        {
          name: EXPORT_FIXTURE_MODULE_NAME,
          version: '1.0.0',
          entry: 'index.mjs',
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(EXPORT_FIXTURE_MODULE_DIR, 'index.mjs'),
      [
        `import { defineAction, defineModule } from ${SDK_IMPORT};`,
        `import { z } from ${ZOD_IMPORT};`,
        '',
        'export default defineModule({',
        `  name: '${EXPORT_FIXTURE_MODULE_NAME}',`,
        "  version: '1.0.0',",
        '  actions: {',
        '    publish: defineAction({',
        "      description: 'Publish a fixture payload.',",
        '      schema: z.object({ name: z.string().min(1) }),',
        '      exportsSchema: z.object({ generatedId: z.string(), eventName: z.string() }),',
        '      credentialSchema: z.object({ username: z.string(), password: z.string() }),',
        "      handler: async (_ctx, payload) => ({ response: { ok: true }, exports: { generatedId: 'id-123', eventName: payload.name } }),",
        '    }),',
        '  },',
        '});',
        '',
      ].join('\n'),
      'utf8',
    );

    const inspectResult = runCli(['module', 'inspect', EXPORT_FIXTURE_MODULE_NAME]);
    const inspectHuman = runCliHuman(['module', 'inspect', EXPORT_FIXTURE_MODULE_NAME]);
    const schemaResult = runCli(['schema', 'action', '--name', `${EXPORT_FIXTURE_MODULE_NAME}.publish`, '--print']);

    expect(inspectResult.status).toBe(0);
    expect(inspectResult.json?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: `${EXPORT_FIXTURE_MODULE_NAME}.publish`,
          exportsSchema: expect.objectContaining({
            type: 'object',
            properties: expect.objectContaining({
              generatedId: expect.objectContaining({ type: 'string' }),
              eventName: expect.objectContaining({ type: 'string' }),
            }),
          }),
          credentialSchema: expect.objectContaining({
            type: 'object',
            properties: expect.objectContaining({
              username: expect.objectContaining({ type: 'string' }),
              password: expect.objectContaining({ type: 'string' }),
            }),
          }),
        }),
      ]),
    );
    expect(inspectHuman.stdout).toContain('exports: generatedId:string, eventName:string');
    expect(inspectHuman.stdout).toContain('credentials: username:string, password:string');

    expect(schemaResult.status).toBe(0);
    expect(schemaResult.json).toEqual(
      expect.objectContaining({
        action: `${EXPORT_FIXTURE_MODULE_NAME}.publish`,
        inputSchema: expect.objectContaining({
          type: 'object',
        }),
        exportsSchema: expect.objectContaining({
          type: 'object',
          properties: expect.objectContaining({
            generatedId: expect.objectContaining({ type: 'string' }),
          }),
        }),
        credentialSchema: expect.objectContaining({
          type: 'object',
          properties: expect.objectContaining({
            username: expect.objectContaining({ type: 'string' }),
          }),
        }),
      }),
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
    expect(result.json?.details?.authoringValidity?.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: expect.stringContaining('bad-memory'),
          message: expect.stringContaining('only allowed in seed jobs'),
        }),
      ]),
    );
  });

  it('reports missing-entry in artifact readiness when the declared entry file is absent', () => {
    const moduleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-module-validate-test-'));
    fs.writeFileSync(
      path.join(moduleDir, 'module.json'),
      `${JSON.stringify(
        {
          name: 'missing-entry-fixture',
          version: '1.0.0',
          entry: 'dist/index.mjs',
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    const result = runCli(['module', 'validate', '--path', moduleDir]);

    expect(result.status).toBe(2);
    expect(result.json?.details?.artifactReadiness?.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'missing-entry' })]),
    );
  });

  it('reports bundle-failed in artifact readiness when the runtime entry cannot be bundled', () => {
    const moduleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-module-validate-test-'));
    fs.writeFileSync(
      path.join(moduleDir, 'module.json'),
      `${JSON.stringify(
        {
          name: 'bundle-failed-fixture',
          version: '1.0.0',
          entry: 'index.mjs',
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    fs.writeFileSync(path.join(moduleDir, 'index.mjs'), 'export default {\n', 'utf8');

    const result = runCli(['module', 'validate', '--path', moduleDir]);

    expect(result.status).toBe(2);
    expect(result.json?.details?.artifactReadiness?.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'bundle-failed' })]),
    );
  });

  it('warns instead of failing when a shipped job only needs runtime env for http config', () => {
    const moduleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-module-validate-test-'));
    fs.mkdirSync(path.join(moduleDir, 'jobs'), { recursive: true });
    fs.writeFileSync(
      path.join(moduleDir, 'module.json'),
      `${JSON.stringify(
        {
          name: 'http-dependency-fixture',
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
        "  name: 'http-dependency-fixture',",
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
      path.join(moduleDir, 'jobs', 'requires-http.job.case.json'),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          jobType: 'requires-http',
          http: {
            baseUrl: '${env.DISPATCH_HTTP_BASE_URL}',
            defaultHeaders: {
              'x-client': '${env.DISPATCH_HTTP_X_CLIENT}',
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
                id: 'noop',
                action: 'http-dependency-fixture.noop',
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

    const result = runCli(['module', 'validate', '--path', moduleDir]);

    expect(result.status).toBe(0);
    expect(result.json?.authoringValidity?.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('requires-http:http.'),
      ]),
    );
    expect(result.json?.artifactReadiness?.status).toBe('pass');
  });

  it('validates example jobs that depend on sibling workspace modules', () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-module-validate-test-'));
    const authDir = path.join(workspaceDir, 'modules', 'auth-fixture');
    const paymentsDir = path.join(workspaceDir, 'modules', 'payments-fixture');
    fs.mkdirSync(path.join(paymentsDir, 'jobs'), { recursive: true });
    fs.mkdirSync(authDir, { recursive: true });

    fs.writeFileSync(
      path.join(authDir, 'module.json'),
      `${JSON.stringify({ name: 'auth-fixture', version: '1.0.0', entry: 'index.mjs' }, null, 2)}\n`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(authDir, 'index.mjs'),
      [
        `import { defineAction, defineModule } from ${SDK_IMPORT};`,
        `import { z } from ${ZOD_IMPORT};`,
        'export default defineModule({',
        "  name: 'auth-fixture',",
        "  version: '1.0.0',",
        '  actions: {',
        '    login: defineAction({',
        "      description: 'Authenticate a fixture user.',",
        '      schema: z.object({}),',
        "      handler: async () => ({ response: { ok: true }, exports: { token: 'abc' } }),",
        '    }),',
        '  },',
        '});',
      ].join('\n'),
      'utf8',
    );

    fs.writeFileSync(
      path.join(paymentsDir, 'module.json'),
      `${JSON.stringify({ name: 'payments-fixture', version: '1.0.0', entry: 'index.mjs' }, null, 2)}\n`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(paymentsDir, 'index.mjs'),
      [
        `import { defineAction, defineModule } from ${SDK_IMPORT};`,
        `import { z } from ${ZOD_IMPORT};`,
        'export default defineModule({',
        "  name: 'payments-fixture',",
        "  version: '1.0.0',",
        '  actions: {',
        '    charge: defineAction({',
        "      description: 'Charge a fixture payment.',",
        '      schema: z.object({ token: z.string().min(1) }),',
        "      handler: async (_ctx, payload) => ({ response: { ok: true, token: payload.token } }),",
        '    }),',
        '  },',
        '});',
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(
      path.join(paymentsDir, 'jobs', 'checkout.job.case.json'),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          jobType: 'checkout',
          dependencies: {
            modules: [{ name: 'auth-fixture', version: '^1.0.0' }],
          },
          scenario: {
            steps: [
              {
                id: 'login',
                action: 'auth-fixture.login',
                payload: {},
                capture: {
                  authToken: 'exports.token',
                },
              },
              {
                id: 'charge',
                action: 'payments-fixture.charge',
                payload: {
                  token: '${run.authToken}',
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

    const result = runCliIn(workspaceDir, ['module', 'validate', '--path', paymentsDir]);

    expect(result.status).toBe(0);
    expect(result.json?.authoringValidity?.status).toBe('pass');
    expect(result.json?.artifactReadiness?.status).toBe('pass');
  });

  it('bootstraps workspace-local modules into the dispatch home directory', () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-module-validate-test-'));
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-module-validate-test-'));
    const moduleDir = path.join(workspaceDir, 'modules', 'bootstrap-fixture');
    fs.mkdirSync(moduleDir, { recursive: true });
    fs.writeFileSync(
      path.join(moduleDir, 'module.json'),
      `${JSON.stringify({ name: 'bootstrap-fixture', version: '1.0.0', entry: 'index.mjs' }, null, 2)}\n`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(moduleDir, 'index.mjs'),
      [
        `import { defineAction, defineModule } from ${SDK_IMPORT};`,
        `import { z } from ${ZOD_IMPORT};`,
        'export default defineModule({',
        "  name: 'bootstrap-fixture',",
        "  version: '1.0.0',",
        '  actions: {',
        '    ping: defineAction({',
        "      description: 'Ping from bootstrap fixture.',",
        '      schema: z.object({}),',
        "      handler: async () => ({ response: { ok: true } }),",
        '    }),',
        '  },',
        '});',
      ].join('\n'),
      'utf8',
    );

    const result = runCliIn(workspaceDir, ['module', 'bootstrap'], { HOME: homeDir });

    expect(result.status).toBe(0);
    expect(result.json?.installed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'bootstrap-fixture',
          version: '1.0.0',
        }),
      ]),
    );
    expect(fs.existsSync(path.join(homeDir, '.dispatch', 'modules', 'bootstrap-fixture@1.0.0', 'module.json'))).toBe(true);
    expect(fs.existsSync(path.join(homeDir, '.dispatch', 'modules', 'bootstrap-fixture@1.0.0', 'artifact.json'))).toBe(true);
    expect(fs.existsSync(path.join(homeDir, '.dispatch', 'modules', 'bootstrap-fixture@1.0.0', 'dist', 'index.mjs'))).toBe(true);
  });

  it('bootstraps modules that self-import dispatchkit before dist exists', () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-module-validate-test-'));
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-module-validate-test-'));
    const moduleDir = path.join(workspaceDir, 'modules', 'bootstrap-self-import-fixture');
    fs.mkdirSync(path.join(workspaceDir, 'src'), { recursive: true });
    fs.mkdirSync(moduleDir, { recursive: true });
    fs.writeFileSync(
      path.join(workspaceDir, 'package.json'),
      `${JSON.stringify(
        {
          name: 'dispatchkit',
          type: 'module',
          exports: {
            '.': {
              import: './dist/index.js',
            },
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(workspaceDir, 'src', 'index.ts'),
      [
        'export function defineAction(definition: Record<string, unknown>) {',
        '  return definition;',
        '}',
        '',
        'export function defineModule(definition: Record<string, unknown>) {',
        '  return definition;',
        '}',
        '',
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(
      path.join(moduleDir, 'module.json'),
      `${JSON.stringify({ name: 'bootstrap-self-import-fixture', version: '1.0.0', entry: 'index.mjs' }, null, 2)}\n`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(moduleDir, 'index.mjs'),
      [
        "import { defineAction, defineModule } from 'dispatchkit';",
        '',
        'export default defineModule({',
        "  name: 'bootstrap-self-import-fixture',",
        "  version: '1.0.0',",
        '  actions: {',
        '    ping: defineAction({',
        "      description: 'Ping from self-import fixture.',",
        '      schema: {},',
        "      handler: async () => ({ response: { ok: true }, detail: 'pong' }),",
        '    }),',
        '  },',
        '});',
        '',
      ].join('\n'),
      'utf8',
    );

    const result = runCliIn(workspaceDir, ['module', 'bootstrap'], { HOME: homeDir });

    expect(result.status).toBe(0);
    expect(result.json?.installed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'bootstrap-self-import-fixture',
          version: '1.0.0',
        }),
      ]),
    );
  });

  it('warns about stale legacy home-installed modules instead of loading them', () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-module-validate-test-'));
    const installDir = path.join(homeDir, '.dispatch', 'modules', 'stale-fixture@1.0.0');
    fs.mkdirSync(installDir, { recursive: true });
    fs.writeFileSync(
      path.join(installDir, 'module.json'),
      `${JSON.stringify({ name: 'stale-fixture', version: '1.0.0', entry: 'index.mjs' }, null, 2)}\n`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(installDir, 'index.mjs'),
      [
        "import { defineAction, defineModule } from 'dispatchkit';",
        "import { z } from 'zod';",
        'export default defineModule({',
        "  name: 'stale-fixture',",
        "  version: '1.0.0',",
        '  actions: {',
        '    ping: defineAction({',
        "      description: 'Recovered stale home install.',",
        '      schema: z.object({}),',
        "      handler: async () => ({ response: { ok: true }, detail: 'pong' }),",
        '    }),',
        '  },',
        '});',
      ].join('\n'),
      'utf8',
    );

    const result = runCli(['module', 'list'], { HOME: homeDir });

    expect(result.status).toBe(0);
    expect(result.json?.modules).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'stale-fixture',
        }),
      ]),
    );
    expect(result.json?.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('old non-portable format'),
      ]),
    );
  });

  it('detects unresolved runtime imports in installed artifacts', () => {
    const installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-module-validate-test-'));
    fs.mkdirSync(path.join(installDir, 'dist'), { recursive: true });
    fs.writeFileSync(
      path.join(installDir, 'module.json'),
      `${JSON.stringify({ name: 'unresolved-import-fixture', version: '1.0.0', entry: 'dist/index.mjs' }, null, 2)}\n`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(installDir, 'artifact.json'),
      `${JSON.stringify(
        {
          artifactSchemaVersion: 1,
          moduleName: 'unresolved-import-fixture',
          moduleVersion: '1.0.0',
          sourceEntry: 'index.mjs',
          bundledEntry: 'dist/index.mjs',
          cliVersion: 'test',
          normalizedAt: '2026-03-23T00:00:00.000Z',
          sourceHash: 'fixture',
          bundler: 'test',
          bundlerVersion: '1.0.0',
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    fs.writeFileSync(path.join(installDir, 'dist', 'index.mjs'), "import 'leftpad';\nexport default { name: 'x', version: '1.0.0', actions: {} };\n", 'utf8');

    const inspected = inspectInstalledArtifactDir(installDir);

    expect(inspected.status).toBe('fail');
    expect(inspected.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'unresolved-runtime-import' })]),
    );
  });

  it('detects invalid installed artifact layout when dist/index.mjs is missing', () => {
    const installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-module-validate-test-'));
    fs.writeFileSync(
      path.join(installDir, 'module.json'),
      `${JSON.stringify({ name: 'invalid-layout-fixture', version: '1.0.0', entry: 'dist/index.mjs' }, null, 2)}\n`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(installDir, 'artifact.json'),
      `${JSON.stringify(
        {
          artifactSchemaVersion: 1,
          moduleName: 'invalid-layout-fixture',
          moduleVersion: '1.0.0',
          sourceEntry: 'index.mjs',
          bundledEntry: 'dist/index.mjs',
          cliVersion: 'test',
          normalizedAt: '2026-03-23T00:00:00.000Z',
          sourceHash: 'fixture',
          bundler: 'test',
          bundlerVersion: '1.0.0',
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    const inspected = inspectInstalledArtifactDir(installDir);

    expect(inspected.status).toBe('fail');
    expect(inspected.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'invalid-artifact-layout' })]),
    );
  });

  it('warns when SKILL.md exists for a configured module but no installed skill is recorded', () => {
    const moduleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-module-validate-test-'));
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-module-validate-test-'));
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-module-validate-test-'));
    fs.mkdirSync(path.join(homeDir, '.dispatch'), { recursive: true });
    fs.writeFileSync(
      path.join(homeDir, '.dispatch', 'config.json'),
      `${JSON.stringify(
        {
          modules: {
            'skill-warning-fixture': {
              repo: 'acme/dispatch-skill-warning-fixture',
              version: 'main',
            },
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(moduleDir, 'module.json'),
      `${JSON.stringify(
        {
          name: 'skill-warning-fixture',
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
        'export default defineModule({',
        "  name: 'skill-warning-fixture',",
        "  version: '1.0.0',",
        '  actions: {',
        '    ping: defineAction({',
        "      description: 'Ping action.',",
        '      schema: z.object({}),',
        "      handler: async () => ({ response: { ok: true }, detail: 'pong' }),",
        '    }),',
        '  },',
        '});',
        '',
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(
      path.join(moduleDir, 'SKILL.md'),
      ['---', 'name: skill-warning-guide', '---', '', '# skill warning fixture', ''].join('\n'),
      'utf8',
    );

    const result = runCliHumanIn(runDir, ['module', 'validate', '--path', moduleDir], { HOME: homeDir });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Module valid -> skill-warning-fixture@1.0.0');
    expect(result.stdout).toContain(
      'SKILL.md found but skill does not appear installed. Run: dispatch skill install skill-warning-fixture',
    );
  });

  it('packs only runtime-oriented files by default and allows declared extras', () => {
    const moduleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-module-pack-test-'));
    fs.mkdirSync(path.join(moduleDir, 'dist'), { recursive: true });
    fs.mkdirSync(path.join(moduleDir, 'jobs'), { recursive: true });
    fs.mkdirSync(path.join(moduleDir, 'runtime-extra'), { recursive: true });
    fs.mkdirSync(path.join(moduleDir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(moduleDir, 'module.json'),
      `${JSON.stringify(
        {
          name: 'pack-fixture',
          version: '1.0.0',
          entry: 'dist/index.mjs',
          pack: {
            include: ['runtime-extra/**'],
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(moduleDir, 'dist', 'index.mjs'),
      "export default { name: 'pack-fixture', version: '1.0.0', actions: {} };\n",
      'utf8',
    );
    fs.writeFileSync(path.join(moduleDir, 'jobs', 'example.job.case.json'), '{}\n', 'utf8');
    fs.writeFileSync(path.join(moduleDir, 'README.md'), '# pack fixture\n', 'utf8');
    fs.writeFileSync(path.join(moduleDir, 'runtime-extra', 'cert.pem'), 'fixture-cert\n', 'utf8');
    fs.writeFileSync(path.join(moduleDir, 'src', 'index.ts'), '// authoring source\n', 'utf8');
    fs.writeFileSync(path.join(moduleDir, 'tsconfig.json'), '{}\n', 'utf8');
    fs.writeFileSync(path.join(moduleDir, 'tsup.config.ts'), 'export default {};\n', 'utf8');

    const bundlePath = path.join(moduleDir, 'pack-fixture.dpmod.zip');
    const result = runCliHuman(['module', 'pack', '--path', moduleDir, '--out', bundlePath]);
    const listed = spawnSync('unzip', ['-Z1', bundlePath], { encoding: 'utf8' });
    const files = listed.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    expect(result.status).toBe(0);
    expect(files).toEqual(
      expect.arrayContaining([
        'artifact.json',
        'module.json',
        'dist/index.mjs',
        'jobs/example.job.case.json',
        'assets/runtime-extra/cert.pem',
      ]),
    );
    expect(files).not.toContain('src/index.ts');
    expect(files).not.toContain('tsconfig.json');
    expect(files).not.toContain('tsup.config.ts');
    expect(files).not.toContain('README.md');
  });

  it('installs atomically, replaces stale targets cleanly, and removes stale temp dirs', () => {
    const moduleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-module-pack-test-'));
    fs.mkdirSync(path.join(moduleDir, 'dist'), { recursive: true });
    fs.mkdirSync(path.join(moduleDir, 'jobs'), { recursive: true });
    fs.writeFileSync(
      path.join(moduleDir, 'module.json'),
      `${JSON.stringify(
        {
          name: 'install-fixture',
          version: '1.0.0',
          entry: 'dist/index.mjs',
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(moduleDir, 'dist', 'index.mjs'),
      [
        `import { z } from ${ZOD_IMPORT};`,
        'export default {',
        "  name: 'install-fixture',",
        "  version: '1.0.0',",
        '  actions: {',
        '    ping: {',
        "      description: 'Ping action.',",
        '      schema: z.object({}),',
        '      handler: async () => ({ response: { ok: true } }),',
        '    },',
        '  },',
        '};',
        '',
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(path.join(moduleDir, 'jobs', 'example.job.case.json'), '{}\n', 'utf8');
    const bundlePath = path.join(moduleDir, 'install-fixture.dpmod.zip');
    const packResult = runCliHuman(['module', 'pack', '--path', moduleDir, '--out', bundlePath]);
    expect(packResult.status).toBe(0);

    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-module-pack-test-'));
    const installedRoot = path.join(homeDir, '.dispatch', 'modules');
    const installDir = path.join(installedRoot, 'install-fixture@1.0.0');
    const staleTmp = path.join(installedRoot, '.tmp-install-stale');
    fs.mkdirSync(staleTmp, { recursive: true });
    fs.writeFileSync(path.join(staleTmp, 'ghost.txt'), 'stale temp\n', 'utf8');
    fs.mkdirSync(installDir, { recursive: true });
    fs.writeFileSync(path.join(installDir, 'obsolete.txt'), 'old install\n', 'utf8');

    const result = runCliHuman(['module', 'install', '--bundle', bundlePath], { HOME: homeDir });

    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(installDir, 'module.json'))).toBe(true);
    expect(fs.existsSync(path.join(installDir, 'artifact.json'))).toBe(true);
    expect(fs.existsSync(path.join(installDir, 'dist', 'index.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(installDir, 'jobs', 'example.job.case.json'))).toBe(true);
    expect(fs.existsSync(path.join(installDir, 'obsolete.txt'))).toBe(false);
    expect(fs.existsSync(staleTmp)).toBe(false);
    expect(
      fs
        .readdirSync(installedRoot)
        .some((entry) => entry.startsWith('.tmp-install-') || entry.startsWith('.tmp-backup-')),
    ).toBe(false);
  });
});
