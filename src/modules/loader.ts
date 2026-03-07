import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { ROOT_DIR } from '../data/paths.js';
import { readJson } from '../utils/fs-json.js';
import { ModuleManifest, ModuleManifestSchema } from './manifest.js';
import { loadBuiltinModules } from './builtin/index.js';
import { ModuleAction, ModuleDefinition, ModuleLoadResult, ModuleLayer } from './types.js';

function isZodSchema(value: unknown): value is z.ZodSchema {
  return !!value && typeof value === 'object' && 'safeParse' in value && typeof value.safeParse === 'function';
}

function listModuleDirs(baseDir: string): string[] {
  if (!fs.existsSync(baseDir) || !fs.statSync(baseDir).isDirectory()) return [];
  return fs
    .readdirSync(baseDir)
    .map((n) => path.join(baseDir, n))
    .filter((p) => fs.existsSync(path.join(p, 'module.json')) && fs.statSync(p).isDirectory());
}

async function loadExternalModule(dir: string, layer: ModuleLayer): Promise<ModuleDefinition> {
  const rawManifest = readJson(path.join(dir, 'module.json'));
  const manifest: ModuleManifest = ModuleManifestSchema.parse(rawManifest);
  const entryPath = path.resolve(dir, manifest.entry ?? 'index.mjs');
  if (!fs.existsSync(entryPath)) throw new Error(`Missing module entry: ${entryPath}`);

  const mod = await import(pathToFileURL(entryPath).href);

  const actions: Record<string, ModuleAction> = {};
  for (const [actionName, actionManifest] of Object.entries(manifest.actions)) {
    const fn = mod[actionManifest.handler];
    if (typeof fn !== 'function') {
      throw new Error(`Module '${manifest.name}' handler '${actionManifest.handler}' is not a function`);
    }
    actions[actionName] = {
      description: actionManifest.description,
      schema: z.unknown(),
      handler: fn,
    };
  }

  // Optional: pick up schemas exported from module entry
  // Structural guard — avoids brittle instanceof across bundle boundaries
  if (mod.schemas && typeof mod.schemas === 'object') {
    for (const [name, schema] of Object.entries(mod.schemas)) {
      if (actions[name] && isZodSchema(schema)) {
        actions[name] = { ...actions[name], schema };
      }
    }
  }

  return {
    name: manifest.name,
    version: manifest.version,
    layer,
    sourcePath: dir,
    metadata: manifest.metadata as Record<string, unknown> | undefined,
    actions,
  };
}

export async function loadModules(): Promise<ModuleLoadResult> {
  const modules: ModuleDefinition[] = [];
  const warnings: string[] = [];

  modules.push(...loadBuiltinModules());

  const repoModulesDir = path.join(ROOT_DIR, 'modules');
  for (const dir of listModuleDirs(repoModulesDir)) {
    try {
      modules.push(await loadExternalModule(dir, 'repo'));
    } catch (e) {
      warnings.push(`Failed loading repo module '${dir}': ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const userModulesDir = path.join(os.homedir(), '.dispatch', 'modules');
  for (const dir of listModuleDirs(userModulesDir)) {
    try {
      modules.push(await loadExternalModule(dir, 'user'));
    } catch (e) {
      warnings.push(`Failed loading user module '${dir}': ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { modules, warnings };
}
