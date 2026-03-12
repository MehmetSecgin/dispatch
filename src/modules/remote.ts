import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import type { RegistryConfig } from '../config/schema.js';
import { defaultUserModulesDir } from '../data/run-data.js';
import { installPreparedModuleDir } from './install.js';

interface RegistryPackageVersion {
  dist?: {
    tarball?: string;
  };
}

interface RegistryPackageMetadata {
  versions?: Record<string, RegistryPackageVersion>;
}

function resolveMetadataUrl(registryUrl: string, packageName: string): string {
  const base = registryUrl.replace(/\/+$/, '');
  const encodedName = packageName.replace('/', '%2F');
  return `${base}/${encodedName}`;
}

function selectTarballUrl(metadata: RegistryPackageMetadata, version: string, registryUrl: string): string {
  const tarball = metadata.versions?.[version]?.dist?.tarball;
  if (!tarball) {
    throw new Error(`Registry package metadata did not include a tarball for version ${version}`);
  }
  return new URL(tarball, registryUrl).toString();
}

function requestHeaders(authToken?: string): Record<string, string> {
  return authToken && authToken.trim()
    ? {
        'User-Agent': 'dispatch-cli',
        Authorization: `Bearer ${authToken}`,
        Connection: 'close',
      }
    : {
        'User-Agent': 'dispatch-cli',
        Connection: 'close',
      };
}

function requestBuffer(url: string, authToken?: string, redirectCount = 0): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const client = target.protocol === 'http:' ? http : https;
    const req = client.get(
      target,
      {
        agent: false,
        headers: requestHeaders(authToken),
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
          if (redirectCount >= 5) {
            res.resume();
            reject(new Error(`Registry fetch failed: too many redirects for ${url}`));
            return;
          }
          const nextUrl = new URL(res.headers.location, target).toString();
          res.resume();
          requestBuffer(nextUrl, authToken, redirectCount + 1).then(resolve, reject);
          return;
        }
        if (status < 200 || status >= 300) {
          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
          res.on('end', () => {
            const suffix = chunks.length > 0 ? `: ${Buffer.concat(chunks).toString('utf8').trim()}` : '';
            reject(new Error(`Registry fetch failed: HTTP ${status} for ${url}${suffix}`));
          });
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      },
    );
    req.on('error', reject);
  });
}

async function fetchJson(url: string, authToken?: string): Promise<RegistryPackageMetadata> {
  return JSON.parse((await requestBuffer(url, authToken)).toString('utf8')) as RegistryPackageMetadata;
}

async function downloadFile(url: string, destination: string, authToken?: string): Promise<void> {
  fs.writeFileSync(destination, await requestBuffer(url, authToken));
}

function extractTarball(tarballPath: string, destination: string): void {
  const result = spawnSync('tar', ['-xzf', tarballPath, '-C', destination], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`tar extraction failed: ${result.stderr || result.stdout}`.trim());
  }
}

export function getCachedModulePath(name: string, version: string): string | null {
  const installPath = path.join(defaultUserModulesDir(), `${name}@${version}`);
  return fs.existsSync(installPath) ? installPath : null;
}

export async function fetchModuleFromRegistry(name: string, version: string, registry: RegistryConfig): Promise<string> {
  const cachedPath = getCachedModulePath(name, version);
  if (cachedPath) return cachedPath;

  const packageName = `${registry.scope}/dispatch-module-${name}`;
  const metadataUrl = resolveMetadataUrl(registry.url, packageName);
  const metadata = await fetchJson(metadataUrl, registry.authToken);
  const tarballUrl = selectTarballUrl(metadata, version, registry.url);
  const targetRoot = defaultUserModulesDir();
  const tarballPath = path.join(os.tmpdir(), `dispatch-module-${name}-${version}-${Date.now()}.tgz`);
  const extractRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-module-extract-'));

  try {
    await downloadFile(tarballUrl, tarballPath, registry.authToken);
    fs.mkdirSync(extractRoot, { recursive: true });
    extractTarball(tarballPath, extractRoot);
    const packageDir = path.join(extractRoot, 'package');
    if (!fs.existsSync(packageDir) || !fs.statSync(packageDir).isDirectory()) {
      throw new Error('Unexpected tarball structure: missing package/ directory');
    }

    const preparedDir = path.join(extractRoot, '.prepared-install');
    fs.renameSync(packageDir, preparedDir);
    return installPreparedModuleDir(preparedDir, targetRoot).installDir;
  } finally {
    fs.rmSync(tarballPath, { force: true });
    fs.rmSync(extractRoot, { recursive: true, force: true });
  }
}
