import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(THIS_DIR, '..', '..');
const SDK_IMPORT = JSON.stringify(pathToFileURL(path.join(REPO_ROOT, 'src', 'index.ts')).href);
const ZOD_IMPORT = JSON.stringify(pathToFileURL(path.join(REPO_ROOT, 'node_modules', 'zod', 'index.js')).href);

export interface RegistryFixtureServer {
  homeDir: string;
  moduleName: string;
  version: string;
  url: string;
  authHeaders: string[];
  stop(): Promise<void>;
}

function packageName(scope: string, moduleName: string): string {
  return `${scope}/dispatch-module-${moduleName}`;
}

function writeRegistryModulePackage(rootDir: string, moduleName: string, version: string, actionName: string): void {
  const packageDir = path.join(rootDir, 'package');
  fs.mkdirSync(packageDir, { recursive: true });
  fs.writeFileSync(
    path.join(packageDir, 'module.json'),
    `${JSON.stringify(
      {
        name: moduleName,
        version,
        entry: 'index.mjs',
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  fs.writeFileSync(
    path.join(packageDir, 'index.mjs'),
    [
      `import { z } from ${ZOD_IMPORT};`,
      `import { defineAction, defineModule } from ${SDK_IMPORT};`,
      '',
      'export default defineModule({',
      `  name: '${moduleName}',`,
      `  version: '${version}',`,
      '  actions: {',
      `    '${actionName}': defineAction({`,
      "      description: 'Remote registry fixture action.',",
      '      schema: z.object({}).strict(),',
      "      handler: async () => ({ response: { ok: true }, detail: 'remote-ok' }),",
      '    }),',
      '  },',
      '});',
      '',
    ].join('\n'),
    'utf8',
  );
}

function createTarball(rootDir: string, tarballName: string): string {
  const tarballPath = path.join(rootDir, tarballName);
  const result = spawnSync('tar', ['-czf', tarballPath, 'package'], {
    cwd: rootDir,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`failed to create registry fixture tarball: ${result.stderr || result.stdout}`);
  }
  return tarballPath;
}

export async function startRegistryFixture(opts: {
  scope?: string;
  moduleName: string;
  version: string;
  authToken?: string;
  actionName?: string;
}): Promise<RegistryFixtureServer> {
  const scope = opts.scope ?? '@fixture';
  const actionName = opts.actionName ?? 'ping';
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-registry-fixture-'));
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-registry-home-'));
  const tarballFile = `dispatch-module-${opts.moduleName}-${opts.version}.tgz`;
  writeRegistryModulePackage(workDir, opts.moduleName, opts.version, actionName);
  const tarballPath = createTarball(workDir, tarballFile);
  const packageId = packageName(scope, opts.moduleName);
  const authHeaders: string[] = [];

  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
    const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
    authHeaders.push(authHeader);
    if (requestUrl.pathname.startsWith('/registry/')) {
      const requested = decodeURIComponent(requestUrl.pathname.slice('/registry/'.length));
      if (requested === packageId) {
        res.writeHead(200, { 'content-type': 'application/json', connection: 'close' });
        res.end(
          JSON.stringify({
            name: packageId,
            versions: {
              [opts.version]: {
                dist: {
                  tarball: `${baseUrl}/tarballs/${tarballFile}`,
                },
              },
            },
          }),
        );
        return;
      }
    }
    if (requestUrl.pathname === `/tarballs/${tarballFile}`) {
      if (opts.authToken && authHeader !== `Bearer ${opts.authToken}`) {
        res.writeHead(401, { 'content-type': 'text/plain', connection: 'close' });
        res.end('unauthorized');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/octet-stream', connection: 'close' });
      res.end(fs.readFileSync(tarballPath));
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain', connection: 'close' });
    res.end('not found');
  });
  server.keepAliveTimeout = 0;

  const baseUrl = await new Promise<string>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('failed to start registry fixture server'));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
    server.on('error', reject);
  });

  fs.mkdirSync(path.join(homeDir, '.dispatch'), { recursive: true });
  fs.writeFileSync(
    path.join(homeDir, '.dispatch', 'config.json'),
    `${JSON.stringify(
      {
        registry: {
          url: `${baseUrl}/registry`,
          scope,
          ...(opts.authToken ? { authToken: '${env.DISPATCH_TEST_REGISTRY_TOKEN}' } : {}),
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  return {
    homeDir,
    moduleName: opts.moduleName,
    version: opts.version,
    url: `${baseUrl}/registry`,
    authHeaders,
    async stop() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      fs.rmSync(workDir, { recursive: true, force: true });
      fs.rmSync(homeDir, { recursive: true, force: true });
    },
  };
}
