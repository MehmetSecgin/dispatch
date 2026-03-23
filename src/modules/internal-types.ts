import { ModuleAction } from './types.js';

/**
 * Source layer a loaded module or action came from.
 *
 * Dispatch loads modules in this order: `builtin`, `repo`, then `user`.
 * When the same fully qualified action key appears more than once, the later
 * layer wins, so `user` overrides `repo` and `repo` overrides `builtin`.
 */
export type ModuleLayer = 'builtin' | 'repo' | 'user';

/**
 * Classification for a module-shipped job file.
 *
 * `case` jobs are read-only examples. `seed` jobs are setup jobs that may
 * write durable memory for later workflows.
 */
export type ModuleJobKind = 'seed' | 'case';

/**
 * One job discovered under a module's optional `jobs/` directory.
 */
export interface ModuleJobDefinition {
  /** Stable job identifier derived from the shipped filename. */
  id: string;
  /** Whether the job is a read-only case job or a memory-writing seed job. */
  kind: ModuleJobKind;
  /** Absolute path to the discovered job file on disk. */
  path: string;
}

/**
 * Loaded module definition after dispatch attaches runtime metadata.
 *
 * This is what the registry stores after loading a module from builtin, repo,
 * or user search paths.
 */
export interface ModuleDefinition {
  /** Module namespace prefix. */
  name: string;
  /** Module semver version string. */
  version: string;
  /** Source layer that produced this module. */
  layer: ModuleLayer;
  /** Absolute source directory path, or a builtin pseudo-path. */
  sourcePath: string;
  /**
   * Canonical hash of the source tree that produced this module.
   *
   * For repo-local modules this is the current module directory hash. For
   * installed user modules this is the artifact manifest's `sourceHash`,
   * allowing repo/user mirror detection across different on-disk layouts.
   */
  sourceHash?: string;
  /** Merged metadata from the runtime module and `module.json`. */
  metadata?: Record<string, unknown>;
  /** Action definitions keyed by action suffix. */
  actions: Record<string, ModuleAction>;
  /** Optional jobs discovered under the module's `jobs/` directory. */
  jobs?: ModuleJobDefinition[];
}

/**
 * Override record captured when multiple loaded modules define the same
 * fully qualified action key.
 */
export interface ActionConflict {
  actionKey: string;
  previous: {
    moduleName: string;
    layer: ModuleLayer;
    version: string;
    sourcePath: string;
  };
  winner: {
    moduleName: string;
    layer: ModuleLayer;
    version: string;
    sourcePath: string;
  };
}

/**
 * Result of loading modules from all configured search paths.
 */
export interface ModuleLoadResult {
  /** Successfully loaded module definitions. */
  modules: ModuleDefinition[];
  /** Non-fatal warnings encountered during discovery or loading. */
  warnings: string[];
}
