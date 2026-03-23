import fs from 'node:fs';
import path from 'node:path';
import { readJson } from '../utils/fs-json.js';
import { ModuleManifestSchema } from './manifest.js';

export interface WorkspaceModuleCandidate {
  name: string;
  version: string;
  moduleDir: string;
  manifestPath: string;
  workspaceRoot: string;
}

function isDirectory(filePath: string): boolean {
  return fs.existsSync(filePath) && fs.statSync(filePath).isDirectory();
}

export function findWorkspaceRoot(startDir: string): string | null {
  let current = path.resolve(startDir);
  while (true) {
    if (isDirectory(path.join(current, 'modules'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function resolveWorkspaceRoots(startDirs: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const roots: string[] = [];
  for (const startDir of startDirs) {
    if (!startDir) continue;
    const root = findWorkspaceRoot(startDir);
    if (!root) continue;
    const realRoot = fs.realpathSync.native(root);
    if (seen.has(realRoot)) continue;
    seen.add(realRoot);
    roots.push(root);
  }
  return roots;
}

export function listWorkspaceModuleDirs(workspaceRoot: string): string[] {
  const modulesDir = path.join(workspaceRoot, 'modules');
  if (!isDirectory(modulesDir)) return [];
  return fs
    .readdirSync(modulesDir)
    .map((entry) => path.join(modulesDir, entry))
    .filter((moduleDir) => isDirectory(moduleDir) && fs.existsSync(path.join(moduleDir, 'module.json')));
}

export function listWorkspaceModuleCandidates(workspaceRoot: string): WorkspaceModuleCandidate[] {
  return listWorkspaceModuleDirs(workspaceRoot)
    .map((moduleDir) => {
      const manifestPath = path.join(moduleDir, 'module.json');
      try {
        const manifest = ModuleManifestSchema.parse(readJson(manifestPath));
        return {
          name: manifest.name,
          version: manifest.version,
          moduleDir,
          manifestPath,
          workspaceRoot,
        };
      } catch {
        return null;
      }
    })
    .filter((candidate): candidate is WorkspaceModuleCandidate => candidate !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function findLocalModuleCandidate(
  moduleName: string,
  startDirs: Array<string | null | undefined>,
): WorkspaceModuleCandidate | null {
  for (const workspaceRoot of resolveWorkspaceRoots(startDirs)) {
    const candidate = listWorkspaceModuleCandidates(workspaceRoot).find((entry) => entry.name === moduleName);
    if (candidate) return candidate;
  }
  return null;
}
