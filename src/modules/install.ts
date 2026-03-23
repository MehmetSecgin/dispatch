import fs from 'node:fs';
import path from 'node:path';
import { ModuleManifest } from './manifest.js';
import { defaultUserModulesDir } from '../data/run-data.js';
import { inspectInstalledArtifactDir } from './artifact.js';

export function basicInstalledModuleValidation(moduleDir: string): ModuleManifest {
  const inspected = inspectInstalledArtifactDir(moduleDir);
  if (inspected.status !== 'pass' || !inspected.manifest) {
    const first = inspected.errors[0];
    throw new Error(first?.message ?? 'Installed artifact validation failed');
  }
  return {
    name: inspected.manifest.moduleName,
    version: inspected.manifest.moduleVersion,
    entry: inspected.manifest.bundledEntry,
  };
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
