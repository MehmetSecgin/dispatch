import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const CLI_ENTRY = path.join(REPO_ROOT, 'src', 'cli.ts');

function runCliHuman(args: string[], env?: NodeJS.ProcessEnv) {
  const out = spawnSync(process.execPath, ['--import', 'tsx', CLI_ENTRY, ...args], {
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
    if (entry.startsWith('dispatch-skill-cli-test-')) {
      fs.rmSync(path.join(os.tmpdir(), entry), { recursive: true, force: true });
    }
  }
});

function writeUserConfig(homeDir: string, payload: unknown): void {
  const configDir = path.join(homeDir, '.dispatch');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'config.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function installMockNpx(binDir: string, argsFile: string): string {
  const scriptPath = path.join(binDir, 'npx');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(
    scriptPath,
    [
      '#!/bin/sh',
      'printf "%s\\n" "$@" > "$MOCK_NPX_ARGS_FILE"',
      'printf "mock npx %s\\n" "$*"',
      'exit 0',
      '',
    ].join('\n'),
    'utf8',
  );
  fs.chmodSync(scriptPath, 0o755);
  return scriptPath;
}

describe('skill CLI', () => {
  it('fails clearly when no modules config is present', () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-skill-cli-test-'));

    const result = runCliHuman(['skill', 'install', '--all'], { HOME: homeDir });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      'Error: No modules configured. Add a modules map to dispatch.config.json or ~/.dispatch/config.json.',
    );
  });

  it('installs one configured module skill via npx skills add with env-interpolated repo and version pin', () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-skill-cli-test-'));
    const binDir = path.join(homeDir, 'bin');
    const argsFile = path.join(homeDir, 'npx-args.txt');
    installMockNpx(binDir, argsFile);
    writeUserConfig(homeDir, {
      modules: {
        payments: {
          repo: '${env.DISPATCH_TEST_SKILL_REPO}',
          version: 'main',
        },
      },
    });

    const result = runCliHuman(['skill', 'install', 'payments'], {
      HOME: homeDir,
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
      MOCK_NPX_ARGS_FILE: argsFile,
      DISPATCH_TEST_SKILL_REPO: 'vercel-labs/agent-skills',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('mock npx --yes skills add vercel-labs/agent-skills@main -y');
    expect(fs.readFileSync(argsFile, 'utf8').trim().split('\n')).toEqual([
      '--yes',
      'skills',
      'add',
      'vercel-labs/agent-skills@main',
      '-y',
    ]);
  });

  it('updates all configured module skills via npx skills update', () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-skill-cli-test-'));
    const binDir = path.join(homeDir, 'bin');
    const argsFile = path.join(homeDir, 'npx-args.txt');
    installMockNpx(binDir, argsFile);
    writeUserConfig(homeDir, {
      modules: {
        payments: {
          repo: 'vercel-labs/agent-skills',
          version: 'main',
        },
        records: {
          repo: 'acme/records-skills',
          version: 'v1.2.3',
        },
      },
    });

    const result = runCliHuman(['skill', 'update', '--all'], {
      HOME: homeDir,
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
      MOCK_NPX_ARGS_FILE: argsFile,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('mock npx --yes skills update');
    expect(fs.readFileSync(argsFile, 'utf8').trim().split('\n')).toEqual(['--yes', 'skills', 'update']);
  });
});
