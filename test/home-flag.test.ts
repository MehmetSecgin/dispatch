import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startRegistryFixture } from './helpers/registry-fixture.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

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
    stdout,
    json: stdout ? JSON.parse(stdout) : null,
  };
}

async function runCliAsync(args: string[], env?: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/cli.ts', '--json', ...args], {
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

  const trimmed = stdout.trim();
  return {
    status,
    stderr,
    stdout: trimmed,
    json: trimmed ? JSON.parse(trimmed) : null,
  };
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

afterEach(() => {
  for (const entry of fs.readdirSync(os.tmpdir())) {
    if (entry.startsWith('dispatch-home-flag-test-')) {
      fs.rmSync(path.join(os.tmpdir(), entry), { recursive: true, force: true });
    }
  }
});

describe('--home flag', () => {
  it('uses the explicit state directory for memory and creates it automatically', () => {
    const envHome = makeTempDir('dispatch-home-flag-test-home-');
    const dispatchHome = path.join(makeTempDir('dispatch-home-flag-test-state-'), 'custom-state');

    expect(fs.existsSync(dispatchHome)).toBe(false);

    const result = runCli(['--home', dispatchHome, 'memory', 'list'], {
      HOME: envHome,
    });

    expect(result.status).toBe(0);
    expect(result.json).toEqual({
      root: path.join(dispatchHome, 'memory'),
      namespaces: [],
    });
    expect(fs.existsSync(dispatchHome)).toBe(true);
    expect(fs.existsSync(path.join(envHome, '.dispatch'))).toBe(false);
  });

  it('writes defaults and runtime overrides under the explicit state directory', () => {
    const envHome = makeTempDir('dispatch-home-flag-test-home-');
    const dispatchHome = makeTempDir('dispatch-home-flag-test-state-');
    const defaultsFile = path.join(dispatchHome, 'payload.json');

    writeJson(defaultsFile, { duration: '1s' });

    const defaultsResult = runCli(
      ['--home', dispatchHome, 'defaults', 'set', '--action', 'flow.sleep', '--file', defaultsFile],
      { HOME: envHome },
    );
    const runtimeResult = runCli(['--home', dispatchHome, 'runtime', 'unset', '--all'], {
      HOME: envHome,
    });

    expect(defaultsResult.status).toBe(0);
    expect(runtimeResult.status).toBe(0);
    expect(fs.existsSync(path.join(dispatchHome, 'action-defaults.json'))).toBe(true);
    expect(fs.existsSync(path.join(dispatchHome, 'runtime-overrides.json'))).toBe(true);
    expect(fs.existsSync(path.join(envHome, '.dispatch', 'action-defaults.json'))).toBe(false);
    expect(fs.existsSync(path.join(envHome, '.dispatch', 'runtime-overrides.json'))).toBe(false);
  });

  it('uses DISPATCH_HOME when no --home flag is passed', () => {
    const envHome = makeTempDir('dispatch-home-flag-test-home-');
    const dispatchHome = makeTempDir('dispatch-home-flag-test-state-');
    const defaultsFile = path.join(dispatchHome, 'payload.json');

    writeJson(defaultsFile, { duration: '2s' });

    const result = runCli(['defaults', 'set', '--action', 'flow.sleep', '--file', defaultsFile], {
      HOME: envHome,
      DISPATCH_HOME: dispatchHome,
    });

    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(dispatchHome, 'action-defaults.json'))).toBe(true);
    expect(fs.existsSync(path.join(envHome, '.dispatch', 'action-defaults.json'))).toBe(false);
  });

  it('loads config.json and installs modules from the explicit state directory before HOME', async () => {
    const fixture = await startRegistryFixture({
      moduleName: `zz-home-flag-fixture-${process.pid}`,
      version: '1.2.3',
      authToken: 'token-123',
    });
    const envHome = makeTempDir('dispatch-home-flag-test-home-');
    const dispatchHome = makeTempDir('dispatch-home-flag-test-state-');

    try {
      writeJson(path.join(dispatchHome, 'config.json'), {
        registry: {
          url: fixture.url,
          scope: '@fixture',
          authToken: '${env.DISPATCH_TEST_REGISTRY_TOKEN}',
        },
      });

      const installResult = await runCliAsync(
        ['--home', dispatchHome, 'module', 'install', '--name', fixture.moduleName, '--version', fixture.version],
        {
          HOME: envHome,
          DISPATCH_TEST_REGISTRY_TOKEN: 'token-123',
        },
      );
      const inspectResult = runCli(['--home', dispatchHome, 'module', 'inspect', fixture.moduleName], {
        HOME: envHome,
      });

      expect(installResult.status).toBe(0);
      expect(inspectResult.status).toBe(0);
      expect(inspectResult.json?.name).toBe(fixture.moduleName);
      expect(fs.existsSync(path.join(dispatchHome, 'modules', `${fixture.moduleName}@${fixture.version}`, 'module.json'))).toBe(true);
      expect(fs.existsSync(path.join(envHome, '.dispatch', 'modules', `${fixture.moduleName}@${fixture.version}`))).toBe(false);
      expect(fixture.authHeaders).toContain('Bearer token-123');
    } finally {
      await fixture.stop();
    }
  });
});
