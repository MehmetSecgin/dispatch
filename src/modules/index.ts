import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ModuleRegistry } from './registry.js';
import { loadModules } from './loader.js';
import { ModuleDefinition } from './internal-types.js';
import { conflictMessage } from './conflicts.js';
import { schemaToJsonSchema } from './schema-contracts.js';

const ACTION_KEY_RE = /^[a-z0-9-]+\.[a-z0-9-]+$/;

export function isNamespacedAction(action: string): boolean {
  return ACTION_KEY_RE.test(action);
}

export async function loadModuleRegistry(): Promise<{ registry: ModuleRegistry; warnings: string[] }> {
  const { modules, warnings } = await loadModules();
  const registry = new ModuleRegistry();
  for (const mod of modules) registry.register(mod);
  const conflictWarnings = registry.listConflicts().map(conflictMessage);
  return { registry, warnings: [...warnings, ...conflictWarnings] };
}

export function moduleInfo(def: ModuleDefinition) {
  return {
    name: def.name,
    version: def.version,
    layer: def.layer,
    sourcePath: def.sourcePath,
    actionCount: Object.keys(def.actions).length,
    jobs: [...(def.jobs ?? [])],
    actions: Object.entries(def.actions).map(([name, a]) => ({
      key: `${def.name}.${name}`,
      description: a.description ?? null,
      exportsSchema: schemaToJsonSchema(a.exportsSchema),
      credentialSchema: schemaToJsonSchema(a.credentialSchema),
    })),
  };
}

export function hashDirectory(dir: string): string {
  const hash = createHash('sha256');
  const files = walkFiles(dir).sort((a, b) => a.localeCompare(b));
  for (const file of files) {
    const rel = path.relative(dir, file);
    hash.update(rel);
    hash.update('\0');
    hash.update(fs.readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      out.push(...walkFiles(full));
    } else if (st.isFile()) {
      out.push(full);
    }
  }
  return out;
}
