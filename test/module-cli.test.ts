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
    expect(result.json?.details?.jobIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: expect.stringContaining('bad-memory'),
          message: expect.stringContaining('only allowed in seed jobs'),
        }),
      ]),
    );
  });

  it('fails module validate when a shipped job is missing required http config', () => {
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

    expect(result.status).toBe(2);
    expect(result.json?.details?.jobIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: expect.stringContaining('requires-http:http.'),
          message: expect.stringContaining('Missing required HTTP config'),
        }),
      ]),
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
        'module.json',
        'dist/index.mjs',
        'jobs/example.job.case.json',
        'README.md',
        'runtime-extra/cert.pem',
      ]),
    );
    expect(files).not.toContain('src/index.ts');
    expect(files).not.toContain('tsconfig.json');
    expect(files).not.toContain('tsup.config.ts');
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
