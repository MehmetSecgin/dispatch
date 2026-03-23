import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { ROOT_DIR } from '../data/paths.js';
import { defaultUserModulesDir } from '../data/run-data.js';
import { readJson } from '../utils/fs-json.js';
import { ModuleManifest, ModuleManifestSchema } from './manifest.js';
import { loadBuiltinModules } from './builtin/index.js';
import { discoverModuleJobs } from './jobs.js';
import { inspectInstalledArtifactDir } from './artifact.js';
import { resolveWorkspaceRoots } from './workspace.js';
import { DispatchModule, ModuleAction } from './types.js';
import { ModuleDefinition, ModuleLoadResult, ModuleLayer } from './internal-types.js';

function isZodSchema(value: unknown): value is z.ZodSchema {
  return !!value && typeof value === 'object' && 'safeParse' in value && typeof value.safeParse === 'function';
}

function isModuleAction(value: unknown): value is ModuleAction {
  return (
    !!value &&
    typeof value === 'object' &&
    'description' in value &&
    'schema' in value &&
    'handler' in value &&
    isZodSchema((value as ModuleAction).schema) &&
    (!('exportsSchema' in value) || (value as ModuleAction).exportsSchema === undefined || isZodSchema((value as ModuleAction).exportsSchema)) &&
    (!('credentialSchema' in value) ||
      (value as ModuleAction).credentialSchema === undefined ||
      isZodSchema((value as ModuleAction).credentialSchema))
  );
}

function isDispatchModule(value: unknown): value is DispatchModule {
  if (!value || typeof value !== 'object') return false;
  if (!('name' in value) || typeof value.name !== 'string') return false;
  if (!('version' in value) || typeof value.version !== 'string') return false;
  if (!('actions' in value) || !value.actions || typeof value.actions !== 'object') return false;
  return Object.values(value.actions).every((action) => isModuleAction(action));
}

function listModuleDirs(baseDir: string): string[] {
  if (!fs.existsSync(baseDir) || !fs.statSync(baseDir).isDirectory()) return [];
  return fs
    .readdirSync(baseDir)
    .map((n) => path.join(baseDir, n))
    .filter((p) => fs.existsSync(path.join(p, 'module.json')) && fs.statSync(p).isDirectory());
}

export async function loadModuleFromDir(dir: string, layer: ModuleLayer): Promise<ModuleDefinition> {
  if (layer === 'user') {
    const checked = inspectInstalledArtifactDir(dir);
    if (checked.status !== 'pass') {
      const first = checked.errors[0];
      throw new Error(first?.message ?? 'Installed module artifact validation failed');
    }
  }
  const rawManifest = readJson(path.join(dir, 'module.json'));
  const manifest: ModuleManifest = ModuleManifestSchema.parse(rawManifest);
  const entryPath = path.resolve(dir, manifest.entry ?? 'index.mjs');
  if (!fs.existsSync(entryPath)) throw new Error(`Missing module entry: ${entryPath}`);

  const mod = await import(pathToFileURL(entryPath).href);
  if (isDispatchModule(mod.default)) {
    if (mod.default.name !== manifest.name) {
      throw new Error(`Module name mismatch: module.json=${manifest.name} entry=${mod.default.name}`);
    }
    if (mod.default.version !== manifest.version) {
      throw new Error(`Module version mismatch: module.json=${manifest.version} entry=${mod.default.version}`);
    }

    return {
      ...mod.default,
      layer,
      sourcePath: dir,
      metadata: {
        ...(mod.default.metadata ?? {}),
        ...(manifest.metadata ?? {}),
      },
      jobs: discoverModuleJobs(dir),
    };
  }

  throw new Error(`Module '${manifest.name}' must default export a DispatchModule (defineModule(...))`);
}

export async function loadModules(opts?: { searchFrom?: Array<string | null | undefined> }): Promise<ModuleLoadResult> {
  const modules: ModuleDefinition[] = [];
  const warnings: string[] = [];

  modules.push(...loadBuiltinModules());

  for (const workspaceRoot of resolveWorkspaceRoots([...(opts?.searchFrom ?? []), process.cwd(), ROOT_DIR])) {
    const repoModulesDir = path.join(workspaceRoot, 'modules');
    for (const dir of listModuleDirs(repoModulesDir)) {
      try {
        modules.push(await loadModuleFromDir(dir, 'repo'));
      } catch (e) {
        warnings.push(`Failed loading repo module '${dir}': ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  const userModulesDir = defaultUserModulesDir();
  for (const dir of listModuleDirs(userModulesDir)) {
    try {
      modules.push(await loadModuleFromDir(dir, 'user'));
    } catch (e) {
      warnings.push(`Failed loading user module '${dir}': ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { modules, warnings };
}
