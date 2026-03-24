import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { loadModules } from '../src/modules/loader.ts';
import { normalizeModuleToArtifact } from '../src/modules/artifact.ts';
import { installPreparedModuleDir } from '../src/modules/install.ts';
import { setDispatchHomeOverride } from '../src/state/home.ts';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const TSX_LOADER = path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'loader.mjs');
const SDK_IMPORT = JSON.stringify(pathToFileURL(path.join(REPO_ROOT, 'src', 'index.ts')).href);
const ZOD_IMPORT = JSON.stringify(pathToFileURL(path.join(REPO_ROOT, 'node_modules', 'zod', 'index.js')).href);

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runCliIn(cwd: string, args: string[], env?: NodeJS.ProcessEnv) {
  const out = spawnSync(
    process.execPath,
    ['--import', TSX_LOADER, path.join(REPO_ROOT, 'src', 'cli.ts'), '--json', ...args],
    {
      cwd,
      encoding: 'utf8',
      timeout: 15000,
      env: {
        ...process.env,
        ...env,
      },
    },
  );

  const stdout = out.stdout.trim();
  return {
    status: out.status,
    stdout,
    stderr: out.stderr,
    json: stdout ? JSON.parse(stdout) : null,
  };
}

function runCliHumanIn(cwd: string, args: string[], env?: NodeJS.ProcessEnv) {
  const out = spawnSync(process.execPath, ['--import', TSX_LOADER, path.join(REPO_ROOT, 'src', 'cli.ts'), ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15000,
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

function writeModule(opts: {
  workspaceDir: string;
  name: string;
  version: string;
  actionNames: string[];
  marker: string;
}) {
  const moduleDir = path.join(opts.workspaceDir, 'modules', opts.name);
  fs.mkdirSync(moduleDir, { recursive: true });
  fs.writeFileSync(
    path.join(moduleDir, 'module.json'),
    `${JSON.stringify({ name: opts.name, version: opts.version, entry: 'index.mjs' }, null, 2)}\n`,
    'utf8',
  );

  const actionBlocks = opts.actionNames
    .map(
      (actionName) => [
        `    ${JSON.stringify(actionName)}: defineAction({`,
        `      description: ${JSON.stringify(`${opts.marker}:${actionName}`)},`,
        '      schema: z.object({}).strict(),',
        `      handler: async () => ({ response: { ok: true, action: ${JSON.stringify(actionName)}, marker: ${JSON.stringify(opts.marker)} }, detail: ${JSON.stringify(`${opts.marker}:${actionName}`)} }),`,
        '    }),',
      ].join('\n'),
    )
    .join('\n');

  fs.writeFileSync(
    path.join(moduleDir, 'index.mjs'),
    [
      `import { defineAction, defineModule } from ${SDK_IMPORT};`,
      `import { z } from ${ZOD_IMPORT};`,
      '',
      'export default defineModule({',
      `  name: ${JSON.stringify(opts.name)},`,
      `  version: ${JSON.stringify(opts.version)},`,
      '  actions: {',
      actionBlocks,
      '  },',
      '});',
      '',
    ].join('\n'),
    'utf8',
  );

  return moduleDir;
}

async function installBootstrappedCopy(moduleDir: string, dispatchHome: string) {
  const artifactDir = tmpDir('dispatch-module-artifact-');
  await normalizeModuleToArtifact(moduleDir, artifactDir, { cliVersion: 'test' });
  installPreparedModuleDir(artifactDir, path.join(dispatchHome, 'modules'));
}

function writeJobCase(workspaceDir: string, moduleName: string): string {
  const casePath = path.join(workspaceDir, 'jobs', `${moduleName}.job.case.json`);
  fs.mkdirSync(path.dirname(casePath), { recursive: true });
  fs.writeFileSync(
    casePath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        jobType: `${moduleName}-job`,
        scenario: {
          steps: [
            {
              id: 'ping',
              action: `${moduleName}.ping`,
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
  return casePath;
}

afterEach(() => {
  setDispatchHomeOverride(null);
  for (const entry of fs.readdirSync(os.tmpdir())) {
    if (entry.startsWith('dispatch-module-mirror-') || entry.startsWith('dispatch-module-artifact-')) {
      fs.rmSync(path.join(os.tmpdir(), entry), { recursive: true, force: true });
    }
  }
});

describe('module mirror de-duplication', () => {
  it('loads repo-only modules without creating duplicate records', async () => {
    const workspaceDir = tmpDir('dispatch-module-mirror-');
    const dispatchHome = tmpDir('dispatch-module-mirror-');
    const moduleName = `mirror-repo-only-${process.pid}`;
    writeModule({
      workspaceDir,
      name: moduleName,
      version: '1.0.0',
      actionNames: ['ping'],
      marker: 'repo-only',
    });

    setDispatchHomeOverride(dispatchHome);
    const loaded = await loadModules({ searchFrom: [workspaceDir] });
    const matches = loaded.modules.filter((mod) => mod.name === moduleName);

    expect(matches).toHaveLength(1);
    expect(matches[0]?.layer).toBe('repo');
  });

  it('loads user-only modules without creating duplicate records', async () => {
    const workspaceDir = tmpDir('dispatch-module-mirror-');
    const dispatchHome = tmpDir('dispatch-module-mirror-');
    const moduleName = `mirror-user-only-${process.pid}`;
    const moduleDir = writeModule({
      workspaceDir,
      name: moduleName,
      version: '1.0.0',
      actionNames: ['ping'],
      marker: 'user-only',
    });

    await installBootstrappedCopy(moduleDir, dispatchHome);
    fs.rmSync(workspaceDir, { recursive: true, force: true });

    setDispatchHomeOverride(dispatchHome);
    const loaded = await loadModules({ searchFrom: [workspaceDir] });
    const matches = loaded.modules.filter((mod) => mod.name === moduleName);

    expect(matches).toHaveLength(1);
    expect(matches[0]?.layer).toBe('user');
  });

  it(
    'suppresses harmless repo/user mirror warnings across list, inspect, schema, validate, and run',
    async () => {
      const workspaceDir = tmpDir('dispatch-module-mirror-');
      const dispatchHome = tmpDir('dispatch-module-mirror-');
      const moduleName = `mirror-clean-${process.pid}`;
      const moduleDir = writeModule({
        workspaceDir,
        name: moduleName,
        version: '1.0.0',
        actionNames: ['ping'],
        marker: 'shared-v1',
      });
      await installBootstrappedCopy(moduleDir, dispatchHome);
      const casePath = writeJobCase(workspaceDir, moduleName);

      setDispatchHomeOverride(dispatchHome);
      const loaded = await loadModules({ searchFrom: [workspaceDir] });
      const matches = loaded.modules.filter((mod) => mod.name === moduleName);
      expect(matches).toHaveLength(1);
      expect(matches[0]?.layer).toBe('user');

      const env = { DISPATCH_HOME: dispatchHome };
      const listResult = runCliIn(workspaceDir, ['module', 'list'], env);
      const inspectResult = runCliIn(workspaceDir, ['module', 'inspect', moduleName], env);
      const schemaResult = runCliIn(workspaceDir, ['schema', 'action', '--name', `${moduleName}.ping`, '--print'], env);
      const validateResult = runCliIn(workspaceDir, ['job', 'validate', '--case', casePath], env);
      const runResult = runCliHumanIn(workspaceDir, ['job', 'run', '--case', casePath], env);

      expect(listResult.status).toBe(0);
      expect(listResult.json?.conflicts).toEqual([]);
      expect(listResult.json?.warnings).toEqual([]);
      expect(listResult.json?.modules.filter((mod: { name: string }) => mod.name === moduleName)).toHaveLength(1);

      expect(inspectResult.status).toBe(0);
      expect(inspectResult.json?.name).toBe(moduleName);
      expect(inspectResult.json?.layer).toBe('user');

      expect(schemaResult.status).toBe(0);
      expect(schemaResult.json?.action).toBe(`${moduleName}.ping`);

      expect(validateResult.status).toBe(0);
      expect(validateResult.json).toEqual(expect.objectContaining({ valid: true, warnings: [] }));

      expect(runResult.status).toBe(0);
      expect(runResult.stdout).not.toContain('override');
      expect(runResult.stdout).not.toContain('overridden');
    },
    15_000,
  );

  it('keeps override warnings when repo/user duplicates use different versions', async () => {
    const workspaceDir = tmpDir('dispatch-module-mirror-');
    const dispatchHome = tmpDir('dispatch-module-mirror-');
    const moduleName = `mirror-version-drift-${process.pid}`;
    const moduleDir = writeModule({
      workspaceDir,
      name: moduleName,
      version: '1.0.0',
      actionNames: ['ping'],
      marker: 'user-v1',
    });
    await installBootstrappedCopy(moduleDir, dispatchHome);
    writeModule({
      workspaceDir,
      name: moduleName,
      version: '1.1.0',
      actionNames: ['ping'],
      marker: 'repo-v1-1',
    });
    const casePath = writeJobCase(workspaceDir, moduleName);
    const env = { DISPATCH_HOME: dispatchHome };

    const listResult = runCliIn(workspaceDir, ['module', 'list'], env);
    const validateResult = runCliIn(workspaceDir, ['job', 'validate', '--case', casePath], env);

    expect(listResult.status).toBe(0);
    expect(listResult.json?.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionKey: `${moduleName}.ping`,
          previous: expect.objectContaining({ version: '1.1.0', layer: 'repo' }),
          winner: expect.objectContaining({ version: '1.0.0', layer: 'user' }),
        }),
      ]),
    );
    expect(validateResult.status).toBe(0);
    expect(validateResult.json?.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining(`override: ${moduleName}.ping winner=${moduleName}@1.0.0 replaced=${moduleName}@1.1.0`)]),
    );
  });

  it('keeps override warnings when same-name same-version repo modules drift from the bootstrapped action surface', async () => {
    const workspaceDir = tmpDir('dispatch-module-mirror-');
    const dispatchHome = tmpDir('dispatch-module-mirror-');
    const moduleName = `mirror-surface-drift-${process.pid}`;
    const moduleDir = writeModule({
      workspaceDir,
      name: moduleName,
      version: '1.0.0',
      actionNames: ['ping'],
      marker: 'user-v1',
    });
    await installBootstrappedCopy(moduleDir, dispatchHome);
    writeModule({
      workspaceDir,
      name: moduleName,
      version: '1.0.0',
      actionNames: ['ping', 'pong'],
      marker: 'repo-drift',
    });
    const casePath = writeJobCase(workspaceDir, moduleName);
    const env = { DISPATCH_HOME: dispatchHome };

    const listResult = runCliIn(workspaceDir, ['module', 'list'], env);
    const validateResult = runCliIn(workspaceDir, ['job', 'validate', '--case', casePath], env);

    expect(listResult.status).toBe(0);
    expect(listResult.json?.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionKey: `${moduleName}.ping`,
          previous: expect.objectContaining({ version: '1.0.0', layer: 'repo' }),
          winner: expect.objectContaining({ version: '1.0.0', layer: 'user' }),
        }),
      ]),
    );
    expect(validateResult.status).toBe(0);
    expect(validateResult.json?.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining(`override: ${moduleName}.ping winner=${moduleName}@1.0.0 replaced=${moduleName}@1.0.0`)]),
    );
  });
});
