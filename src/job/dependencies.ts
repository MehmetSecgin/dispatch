import path from 'node:path';
import satisfies from 'semver/functions/satisfies.js';
import type { JsonObject } from '../core/json.js';
import type { JobCase, MemoryDependency, ModuleDependency } from '../core/schema.js';
import { loadCase } from '../data/run-data.js';
import { recallMemoryValue } from '../modules/builtin/memory/store.js';
import { resolveModuleJob } from '../modules/jobs.js';
import { ModuleRegistry } from '../modules/registry.js';
import type { ModuleDefinition } from '../modules/types.js';
import { HttpPoolRegistry } from '../services/http-pool.js';
import { executeJobCase } from './runner.js';
import type { NextAction } from './next-actions.js';

type DependencyIssueCode =
  | 'MISSING_MODULE_DEPENDENCY'
  | 'MODULE_VERSION_MISMATCH'
  | 'MISSING_MEMORY_DEPENDENCY'
  | 'INVALID_FILL_JOB';

export interface DependencyIssue {
  code: DependencyIssueCode;
  dependencyType: 'module' | 'memory';
  message: string;
  moduleName?: string;
  requiredVersion?: string;
  actualVersion?: string;
  namespace?: string;
  key?: string;
  fill?: {
    module: string;
    job: string;
    path?: string;
  };
}

export interface DependencyCheckResult {
  valid: boolean;
  issues: DependencyIssue[];
  next: NextAction[];
}

interface FillResolution {
  module: ModuleDefinition;
  path: string;
  identity: string;
}

function moduleNameFromAction(action: string): string | null {
  const idx = action.indexOf('.');
  if (idx <= 0) return null;
  return action.slice(0, idx);
}

function preferredModuleForName(registry: ModuleRegistry, moduleName: string): ModuleDefinition | null {
  const matches = registry.listModules().filter((moduleDef) => moduleDef.name === moduleName);
  return matches.length > 0 ? matches[matches.length - 1] : null;
}

function collectInferredModuleNames(job: JobCase): Set<string> {
  const names = new Set<string>();
  for (const step of job.scenario.steps) {
    const directModule = moduleNameFromAction(step.action);
    if (directModule) names.add(directModule);
    if (step.action === 'flow.poll') {
      const pollAction = step.payload && typeof step.payload.action === 'string' ? step.payload.action : null;
      const pollModule = pollAction ? moduleNameFromAction(pollAction) : null;
      if (pollModule) names.add(pollModule);
    }
  }
  return names;
}

function moduleDependencies(job: JobCase): ModuleDependency[] {
  const explicit = job.dependencies?.modules ?? [];
  const inferredNames = collectInferredModuleNames(job);
  for (const dep of explicit) inferredNames.add(dep.name);
  return Array.from(inferredNames)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const explicitDep = explicit.find((dep) => dep.name === name);
      return explicitDep ?? { name };
    });
}

function buildVersionRequirements(job: JobCase): Map<string, string> {
  const requirements = new Map<string, string>();
  for (const dep of job.dependencies?.modules ?? []) {
    if (dep.version) requirements.set(dep.name, dep.version);
  }
  return requirements;
}

function jobCommandPath(filePath: string): string {
  const rel = path.relative(process.cwd(), filePath);
  return rel && !rel.startsWith('..') ? rel : filePath;
}

function nextActionForMemoryFill(dep: MemoryDependency, fillPath: string): NextAction {
  return {
    command: `dispatch job run --case ${jobCommandPath(fillPath)}`,
    description: `populate memory ${dep.namespace}.${dep.key}`,
  };
}

function resolveFillJob(
  dep: MemoryDependency,
  registry: ModuleRegistry,
  versionRequirements: Map<string, string>,
): FillResolution | null {
  if (!dep.fill) return null;
  const moduleDef = preferredModuleForName(registry, dep.fill.module);
  if (!moduleDef) return null;

  const requiredVersion = versionRequirements.get(dep.fill.module);
  if (requiredVersion && !satisfies(moduleDef.version, requiredVersion)) return null;

  const resolvedJob = resolveModuleJob(moduleDef, dep.fill.job);
  if (!resolvedJob) return null;

  return {
    module: moduleDef,
    path: resolvedJob.path,
    identity: `${moduleDef.name}:${dep.fill.job}`,
  };
}

export function inspectJobDependencies(
  job: JobCase,
  opts: {
    registry: ModuleRegistry;
    configDir: string;
  },
): DependencyCheckResult {
  const issues: DependencyIssue[] = [];
  const next: NextAction[] = [];
  const versionRequirements = buildVersionRequirements(job);

  for (const dep of moduleDependencies(job)) {
    const moduleDef = preferredModuleForName(opts.registry, dep.name);
    if (!moduleDef) {
      issues.push({
        code: 'MISSING_MODULE_DEPENDENCY',
        dependencyType: 'module',
        moduleName: dep.name,
        requiredVersion: dep.version,
        message: dep.version
          ? `Required module '${dep.name}' (${dep.version}) is not loaded`
          : `Required module '${dep.name}' is not loaded`,
      });
      continue;
    }

    if (dep.version && !satisfies(moduleDef.version, dep.version)) {
      issues.push({
        code: 'MODULE_VERSION_MISMATCH',
        dependencyType: 'module',
        moduleName: dep.name,
        requiredVersion: dep.version,
        actualVersion: moduleDef.version,
        message: `Module '${dep.name}' version ${moduleDef.version} does not satisfy ${dep.version}`,
      });
    }
  }

  for (const dep of job.dependencies?.memory ?? []) {
    const recalled = recallMemoryValue(opts.configDir, dep.namespace, dep.key);
    if (recalled.found) continue;

    const resolvedFill = resolveFillJob(dep, opts.registry, versionRequirements);
    if (dep.fill && !resolvedFill) {
      issues.push({
        code: 'INVALID_FILL_JOB',
        dependencyType: 'memory',
        namespace: dep.namespace,
        key: dep.key,
        fill: {
          module: dep.fill.module,
          job: dep.fill.job,
        },
        message: `Missing fill job '${dep.fill.module}:${dep.fill.job}' for memory dependency ${dep.namespace}.${dep.key}`,
      });
      continue;
    }

    issues.push({
      code: 'MISSING_MEMORY_DEPENDENCY',
      dependencyType: 'memory',
      namespace: dep.namespace,
      key: dep.key,
      fill: dep.fill
        ? {
            module: dep.fill.module,
            job: dep.fill.job,
            path: resolvedFill?.path,
          }
        : undefined,
      message: `Missing memory dependency ${dep.namespace}.${dep.key}`,
    });

    if (resolvedFill) next.push(nextActionForMemoryFill(dep, resolvedFill.path));
  }

  return {
    valid: issues.length === 0,
    issues,
    next,
  };
}

export async function resolveJobDependencies(
  job: JobCase,
  opts: {
    registry: ModuleRegistry;
    configDir: string;
    cliVersion: string;
    runtimeOverrides?: JsonObject;
    poolRegistry?: HttpPoolRegistry;
    stack?: string[];
  },
): Promise<DependencyCheckResult> {
  const stack = opts.stack ?? [];
  const versionRequirements = buildVersionRequirements(job);

  for (const dep of job.dependencies?.memory ?? []) {
    const recalled = recallMemoryValue(opts.configDir, dep.namespace, dep.key);
    if (recalled.found || !dep.fill) continue;

    const resolvedFill = resolveFillJob(dep, opts.registry, versionRequirements);
    if (!resolvedFill) continue;
    if (stack.includes(resolvedFill.identity)) {
      throw new Error(`Dependency cycle detected: ${[...stack, resolvedFill.identity].join(' -> ')}`);
    }

    const fillJob = loadCase(resolvedFill.path);
    const fillDeps = await resolveJobDependencies(fillJob, {
      ...opts,
      stack: [...stack, resolvedFill.identity],
    });
    if (!fillDeps.valid) return inspectJobDependencies(job, opts);

    await executeJobCase(fillJob, {
      json: true,
      label: 'job-dependency-fill',
      cliVersion: opts.cliVersion,
      color: false,
      runtimeOverrides: opts.runtimeOverrides,
      poolRegistry: opts.poolRegistry,
    });
  }

  return inspectJobDependencies(job, opts);
}
