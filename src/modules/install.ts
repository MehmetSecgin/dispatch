import fs from 'node:fs';
import path from 'node:path';
import { ModuleManifest, ModuleManifestSchema } from './manifest.js';
import { readJson } from '../utils/fs-json.js';
import { defaultUserModulesDir } from '../data/run-data.js';

function ensureModuleSubpath(moduleDir: string, relPath: string): string {
  const normalized = String(relPath || '').replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+/, '');
  const fullPath = path.resolve(moduleDir, normalized);
  const relative = path.relative(moduleDir, fullPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Module entry must stay inside the module directory: ${relPath}`);
  }
  return fullPath;
}

export function basicInstalledModuleValidation(moduleDir: string): ModuleManifest {
  const manifestPath = path.join(moduleDir, 'module.json');
  if (!fs.existsSync(manifestPath)) throw new Error('Bundle missing module.json at root');
  const manifest = ModuleManifestSchema.parse(readJson(manifestPath));
  const entryPath = ensureModuleSubpath(moduleDir, manifest.entry || 'index.mjs');
  if (!fs.existsSync(entryPath) || !fs.statSync(entryPath).isFile()) {
    throw new Error(`Bundle entry file missing: ${manifest.entry || 'index.mjs'}`);
  }
  return manifest;
}

export function cleanupStaleInstallDirs(targetRoot: string): void {
  if (!fs.existsSync(targetRoot)) return;
  for (const entry of fs.readdirSync(targetRoot)) {
    if (!entry.startsWith('.tmp-install-') && !entry.startsWith('.tmp-backup-')) continue;
    fs.rmSync(path.join(targetRoot, entry), { recursive: true, force: true });
  }
}

function uniqueInstallPath(targetRoot: string, prefix: string): string {
  const suffix = `${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2, 8)}`;
  return path.join(targetRoot, `${prefix}${suffix}`);
}

export function installPreparedModuleDir(
  preparedDir: string,
  targetRoot = defaultUserModulesDir(),
): { manifest: ModuleManifest; installDir: string } {
  fs.mkdirSync(targetRoot, { recursive: true });
  const lockDir = path.join(targetRoot, '.install.lock');
  try {
    fs.mkdirSync(lockDir);
  } catch {
    throw new Error('Another module install is already in progress');
  }

  try {
    cleanupStaleInstallDirs(targetRoot);
    const manifest = basicInstalledModuleValidation(preparedDir);
    const installDir = path.join(targetRoot, `${manifest.name}@${manifest.version}`);
    let backupDir: string | null = null;

    if (fs.existsSync(installDir)) {
      backupDir = uniqueInstallPath(targetRoot, '.tmp-backup-');
      fs.renameSync(installDir, backupDir);
    }

    try {
      fs.renameSync(preparedDir, installDir);
    } catch (error) {
      if (backupDir && fs.existsSync(backupDir) && !fs.existsSync(installDir)) {
        fs.renameSync(backupDir, installDir);
        backupDir = null;
      }
      throw error;
    }

    if (backupDir) fs.rmSync(backupDir, { recursive: true, force: true });
    return { manifest, installDir };
  } finally {
    cleanupStaleInstallDirs(targetRoot);
    fs.rmSync(lockDir, { recursive: true, force: true });
  }
}
