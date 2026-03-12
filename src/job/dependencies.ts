import path from 'node:path';
import satisfies from 'semver/functions/satisfies.js';
import { loadConfig } from '../config/loader.js';
import type { JsonObject } from '../core/json.js';
import type { JobCase, JobHttpConfig, MemoryDependency, ModuleDependency } from '../core/schema.js';
import { loadCase } from '../data/run-data.js';
import { recallMemoryValue } from '../modules/builtin/memory/store.js';
import { resolveModuleJob } from '../modules/jobs.js';
import { loadModuleFromDir } from '../modules/loader.js';
import { fetchModuleFromRegistry } from '../modules/remote.js';
import { ModuleRegistry } from '../modules/registry.js';
import type { ModuleDefinition } from '../modules/types.js';
import { HttpPoolRegistry } from '../services/http-pool.js';
import { executeJobCase, resolveJobHttpConfig } from './runner.js';
import type { NextAction } from './next-actions.js';
import type { RuntimeContext } from '../execution/interpolation.js';

type DependencyIssueCode =
  | 'MISSING_MODULE_DEPENDENCY'
  | 'MODULE_VERSION_MISMATCH'
  | 'MISSING_MEMORY_DEPENDENCY'
  | 'INVALID_FILL_JOB'
  | 'MISSING_HTTP_DEPENDENCY'
  | 'INVALID_HTTP_CONFIG';

export interface DependencyIssue {
  code: DependencyIssueCode;
  dependencyType: 'module' | 'memory' | 'http';
  message: string;
  moduleName?: string;
  requiredVersion?: string;
  actualVersion?: string;
  namespace?: string;
  key?: string;
  httpPath?: string;
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

export interface DeclaredMemoryDependencySummary {
  namespace: string;
  key: string;
  fill?: {
    module: string;
    job: string;
  };
}

export interface DeclaredHttpDependencySummary {
  path: string;
}

export interface EffectiveHttpInspection {
  valid: boolean;
  effectiveHttp?: JobHttpConfig;
  issues: DependencyIssue[];
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
    description: `run seed job to populate ${dep.namespace}.${dep.key}`,
  };
}

function formatModuleSpec(dep: ModuleDependency): string {
  return dep.version ? `${dep.name}@${dep.version}` : dep.name;
}

function nextActionForModuleInstall(dep: ModuleDependency): NextAction | null {
  if (!dep.version) return null;
  return {
    command: `dispatch module install --name ${dep.name} --version ${dep.version}`,
    description: `install required module ${dep.name}@${dep.version}`,
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

function hasOwnPath(obj: unknown, pathSpec: string): boolean {
  if (!obj || typeof obj !== 'object') return false;
  if (!pathSpec) return false;
  const segments = pathSpec.split('.');
  let current: unknown = obj;
  for (const segment of segments) {
    if (!segment) return false;
    if (!current || typeof current !== 'object') return false;
    const record = current as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(record, segment)) return false;
    current = record[segment];
  }
  return true;
}

export function inspectHttpDependencies(
  job: JobCase,
  effectiveHttp?: JobHttpConfig,
): Pick<DependencyCheckResult, 'issues' | 'valid'> {
  const issues: DependencyIssue[] = [];
  const requiredPaths = job.dependencies?.http?.required ?? [];
  const resolvedHttp = effectiveHttp ?? job.http;
  for (const pathSpec of requiredPaths) {
    if (hasOwnPath(resolvedHttp, pathSpec)) continue;
    issues.push({
      code: 'MISSING_HTTP_DEPENDENCY',
      dependencyType: 'http',
      httpPath: pathSpec,
      message: `Missing required HTTP config http.${pathSpec}`,
    });
  }
  return {
    valid: issues.length === 0,
    issues,
  };
}

export function resolveEffectiveJobHttpConfig(
  job: JobCase,
  runtime?: RuntimeContext,
): JobHttpConfig | undefined {
  if (!runtime) return job.http;
  return resolveJobHttpConfig(job.http, runtime);
}

function httpConfigIssueFromError(error: unknown): DependencyIssue {
  const message = error instanceof Error ? error.message : String(error);
  const pathMatch = message.match(/^Job http\.([A-Za-z0-9_.-]+) must (.+)$/);
  if (pathMatch) {
    return {
      code: 'INVALID_HTTP_CONFIG',
      dependencyType: 'http',
      httpPath: pathMatch[1],
      message: `must ${pathMatch[2]}`,
    };
  }
  const defaultHeadersMatch = message.match(/^Job http\.defaultHeaders must (.+)$/);
  if (defaultHeadersMatch) {
    return {
      code: 'INVALID_HTTP_CONFIG',
      dependencyType: 'http',
      httpPath: 'defaultHeaders',
      message: `must ${defaultHeadersMatch[1]}`,
    };
  }
  return {
    code: 'INVALID_HTTP_CONFIG',
    dependencyType: 'http',
    message,
  };
}

export function inspectEffectiveJobHttpConfig(
  job: JobCase,
  runtime?: RuntimeContext,
): EffectiveHttpInspection {
  try {
    return {
      valid: true,
      effectiveHttp: resolveEffectiveJobHttpConfig(job, runtime),
      issues: [],
    };
  } catch (error) {
    return {
      valid: false,
      issues: [httpConfigIssueFromError(error)],
    };
  }
}

export function inspectJobDependencies(
  job: JobCase,
  opts: {
    registry: ModuleRegistry;
    configDir: string;
    effectiveHttp?: JobHttpConfig;
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
        message: `Missing seed job '${dep.fill.module}:${dep.fill.job}' for required memory ${dep.namespace}.${dep.key}`,
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
      message: dep.fill
        ? `Missing required memory ${dep.namespace}.${dep.key}; seed with ${dep.fill.module}:${dep.fill.job}`
        : `Missing required memory ${dep.namespace}.${dep.key}`,
    });

    if (resolvedFill) next.push(nextActionForMemoryFill(dep, resolvedFill.path));
  }

  issues.push(...inspectHttpDependencies(job, opts.effectiveHttp).issues);

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
    resolveRemote?: boolean;
    runtimeOverrides?: JsonObject;
    poolRegistry?: HttpPoolRegistry;
    stack?: string[];
  },
): Promise<DependencyCheckResult> {
  const stack = opts.stack ?? [];
  const versionRequirements = buildVersionRequirements(job);

  for (const dep of moduleDependencies(job)) {
    const existing = preferredModuleForName(opts.registry, dep.name);
    if (existing) {
      if (dep.version && !satisfies(existing.version, dep.version)) {
        return inspectJobDependencies(job, opts);
      }
      continue;
    }
    if (!opts.resolveRemote) continue;
    if (!dep.version) {
      return {
        valid: false,
        issues: [
          {
            code: 'MISSING_MODULE_DEPENDENCY',
            dependencyType: 'module',
            moduleName: dep.name,
            message: `Required module '${dep.name}' is not loaded and cannot be fetched automatically without a pinned dependencies.modules version.`,
          },
        ],
        next: [],
      };
    }

    const { config } = loadConfig();
    if (!config.registry) {
      const next = nextActionForModuleInstall(dep);
      return {
        valid: false,
        issues: [
          {
            code: 'MISSING_MODULE_DEPENDENCY',
            dependencyType: 'module',
            moduleName: dep.name,
            requiredVersion: dep.version,
            message: `Module '${formatModuleSpec(dep)}' not found locally and no registry is configured. Run 'dispatch module install --name ${dep.name} --version ${dep.version}' or add a registry to your dispatch config.`,
          },
        ],
        next: next ? [next] : [],
      };
    }

    const installedDir = await fetchModuleFromRegistry(dep.name, dep.version, config.registry);
    const loadedModule = await loadModuleFromDir(installedDir, 'user');
    opts.registry.register(loadedModule);
  }

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

export function summarizeDeclaredMemoryDependencies(job: JobCase): DeclaredMemoryDependencySummary[] {
  return (job.dependencies?.memory ?? []).map((dep) => ({
    namespace: dep.namespace,
    key: dep.key,
    fill: dep.fill
      ? {
          module: dep.fill.module,
          job: dep.fill.job,
        }
      : undefined,
  }));
}

export function summarizeDeclaredHttpDependencies(job: JobCase): DeclaredHttpDependencySummary[] {
  return (job.dependencies?.http?.required ?? []).map((path) => ({ path }));
}
