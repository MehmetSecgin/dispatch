import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const SDK_IMPORT = JSON.stringify(pathToFileURL(path.join(REPO_ROOT, 'src', 'index.ts')).href);
const ZOD_IMPORT = JSON.stringify(pathToFileURL(path.join(REPO_ROOT, 'node_modules', 'zod', 'index.js')).href);
const FIXTURE_NAME = `zz-session-fixture-${process.pid}`;
const FIXTURE_DIR = path.join(REPO_ROOT, 'modules', FIXTURE_NAME);

interface RecordedRequest {
  url: string;
  cookie: string | undefined;
}

let server: http.Server;
let baseUrl: string;
const recorded: RecordedRequest[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    recorded.push({ url: req.url ?? '', cookie: req.headers.cookie });
    if (req.url === '/login') {
      res.setHeader('Set-Cookie', 'session=abc; Path=/; HttpOnly');
      res.setHeader('Content-Type', 'application/json');
      res.end('{"ok":true}');
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ saw: req.headers.cookie ?? null }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('failed to bind test server');
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function writeFixture(): void {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(FIXTURE_DIR, 'module.json'),
    `${JSON.stringify({ name: FIXTURE_NAME, version: '1.0.0', entry: 'index.mjs' }, null, 2)}\n`,
    'utf8',
  );
  fs.writeFileSync(
    path.join(FIXTURE_DIR, 'index.mjs'),
    [
      `import { defineAction, defineModule } from ${SDK_IMPORT};`,
      `import { z } from ${ZOD_IMPORT};`,
      'export default defineModule({',
      `  name: '${FIXTURE_NAME}',`,
      "  version: '1.0.0',",
      '  actions: {',
      "    login: defineAction({",
      "      description: 'Hit login endpoint to receive a session cookie.',",
      '      schema: z.object({}),',
      "      handler: async (ctx) => {",
      "        const resp = await ctx.http.get('/login');",
      "        return { response: resp.body, detail: 'ok' };",
      '      },',
      '    }),',
      "    ping: defineAction({",
      "      description: 'Hit a protected endpoint reusing the cookie jar.',",
      '      schema: z.object({}),',
      "      handler: async (ctx) => {",
      "        const resp = await ctx.http.get('/ping');",
      "        return { response: resp.body, detail: 'ok' };",
      '      },',
      '    }),',
      '  },',
      '});',
    ].join('\n'),
    'utf8',
  );
}

async function runCli(args: string[], env: NodeJS.ProcessEnv): Promise<{
  status: number | null;
  stdout: string;
  stderr: string;
  json: any;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'src/cli.ts', '--json', ...args],
      { cwd: REPO_ROOT, env: { ...process.env, ...env } },
    );
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on('data', (d) => stdoutChunks.push(d));
    child.stderr.on('data', (d) => stderrChunks.push(d));
    const timeoutHandle = setTimeout(() => {
      child.kill('SIGKILL');
    }, 20000);
    child.on('error', reject);
    child.on('close', (status) => {
      clearTimeout(timeoutHandle);
      const stdout = Buffer.concat(stdoutChunks).toString('utf8').trim();
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      resolve({
        status,
        stdout,
        stderr,
        json: stdout ? JSON.parse(stdout) : null,
      });
    });
  });
}

afterEach(() => {
  recorded.length = 0;
  fs.rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

describe('dispatch run --session', () => {
  it('persists cookies between invocations and reuses them on the next request', async () => {
    writeFixture();
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-session-'));
    try {
      const login = await runCli(
        ['run', `${FIXTURE_NAME}.login`, '--base-url', baseUrl, '--session', 'test-roundtrip'],
        { DISPATCH_HOME: home },
      );
      expect(login.status).toBe(0);
      expect(login.json?.status).toBe('SUCCESS');

      const jarPath = path.join(home, 'sessions', 'test-roundtrip', 'cookies.json');
      expect(fs.existsSync(jarPath)).toBe(true);
      const dumped = JSON.parse(fs.readFileSync(jarPath, 'utf8'));
      expect(dumped.version).toBe(1);
      expect(dumped.cookies).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'session', value: 'abc' })]),
      );

      const ping = await runCli(
        ['run', `${FIXTURE_NAME}.ping`, '--base-url', baseUrl, '--session', 'test-roundtrip'],
        { DISPATCH_HOME: home },
      );
      expect(ping.status).toBe(0);
      const protectedCall = recorded.find((entry) => entry.url === '/ping');
      expect(protectedCall?.cookie).toBe('session=abc');
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('keeps the jar ephemeral when --session is not passed', async () => {
    writeFixture();
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-session-'));
    try {
      const login = await runCli(['run', `${FIXTURE_NAME}.login`, '--base-url', baseUrl], { DISPATCH_HOME: home });
      expect(login.status).toBe(0);
      expect(fs.existsSync(path.join(home, 'sessions'))).toBe(false);

      const ping = await runCli(['run', `${FIXTURE_NAME}.ping`, '--base-url', baseUrl], { DISPATCH_HOME: home });
      expect(ping.status).toBe(0);
      const protectedCall = recorded.find((entry) => entry.url === '/ping');
      expect(protectedCall?.cookie).toBeUndefined();
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
