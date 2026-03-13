import { z } from 'zod';
import { RuntimeContext } from '../execution/interpolation.js';
import { JobStep } from '../core/schema.js';
import { HttpTransport } from '../transport/http.js';

/**
 * Return value from an action handler.
 */
export interface ActionResult {
  /**
   * Action response payload.
   *
   * Later job steps can reference this value through:
   * `${step.<stepId>.response}` or `${step.<stepId>.response.<field>}`.
   *
   * For HTTP-backed actions this is usually the parsed body returned by
   * `ctx.http.requireOk(...)`.
   */
  response?: unknown;

  /**
   * Workflow exports that are not part of the transport response.
   *
   * Use this for generated or derived values that later steps need, such as
   * generated IDs or normalized names.
   *
   * Later job steps can reference exports through:
   * `${step.<stepId>.exports.<field>}`.
   *
   * Jobs can promote an export into `run.*` via step capture:
   * `"capture": { "workflowId": "exports.generatedId" }`
   */
  exports?: Record<string, unknown>;

  /**
   * Human-readable summary of what the action did.
   *
   * Dispatch records this in activity output and shows it in normal CLI
   * summaries when available.
   */
  detail?: string;

  /**
   * Extra debugging context for run artifacts.
   *
   * This is written to machine-readable run data and is intended for offline
   * inspection rather than normal CLI output.
   */
  diagnostics?: Record<string, unknown>;
}

/**
 * Minimal artifact logger available to action handlers.
 *
 * Dispatch manages the underlying run artifact storage internally. Module
 * authors should only rely on this stable activity logging contract.
 */
export interface Artifacts {
  /**
   * Append one human-readable line to the run activity log.
   *
   * Convention: `<action-name> key=value key=value`.
   */
  appendActivity(line: string): void;
}

/**
 * Public module definition authored by module packages.
 *
 * The runtime entry file referenced by `module.json.entry` must default-export
 * the return value of `defineModule(...)`.
 */
export interface DispatchModule {
  /**
   * Module namespace prefix.
   *
   * If the name is `admin`, an action declared as `login` is resolved as
   * `admin.login`.
   *
   * This must match `module.json.name`.
   */
  name: string;

  /**
   * Module semver version string.
   *
   * This must match `module.json.version` and is used by job dependency checks.
   */
  version: string;

  /**
   * Map of action names to action definitions.
   *
   * Keys are the action suffix only, for example `login` or `update-status`.
   * Dispatch combines them with `name` to form fully qualified action keys.
   */
  actions: Record<string, ModuleAction>;

  /**
   * Optional tooling metadata.
   *
   * Dispatch preserves this for inspection, but does not apply runtime
   * behavior to it.
   */
  metadata?: Record<string, unknown>;
}

/**
 * Definition of one action inside a module.
 */
export interface ModuleAction<T = unknown> {
  /**
   * Human-readable description surfaced by `dispatch module inspect` and
   * `dispatch schema action --print`.
   */
  description: string;

  /**
   * Zod schema for the public action payload.
   *
   * Dispatch validates the step payload against this schema after
   * interpolation and before the handler runs.
   */
  schema: z.ZodSchema<T>;

  /**
   * Optional Zod schema for `ActionResult.exports`.
   *
   * When present, dispatch can surface the available export fields in schema
   * and module inspection output.
   */
  exportsSchema?: z.ZodSchema;

  /**
   * Optional Zod schema for `ctx.credential`.
   *
   * When present, the action expects a job-level credential profile to be
   * bound through the step's `credential` field.
   */
  credentialSchema?: z.ZodSchema;

  /**
   * Async handler that receives the runtime context and validated payload.
   *
   * The handler must return an `ActionResult`.
   */
  handler: {
    bivarianceHack(ctx: ActionContext, payload: T): Promise<ActionResult>;
  }['bivarianceHack'];
}

/**
 * Define a dispatch module.
 *
 * A module is a named collection of actions that wrap an API surface.
 * The default export of a module's runtime entry file should be the return
 * value of this function.
 *
 * @example
 * ```ts
 * import { defineAction, defineModule } from 'dispatchkit';
 * import { z } from 'zod';
 *
 * export default defineModule({
 *   name: 'my-service',
 *   version: '0.1.0',
 *   actions: {
 *     ping: defineAction({
 *       description: 'Health check action.',
 *       schema: z.object({}),
 *       handler: async () => ({
 *         response: { ok: true },
 *         detail: 'pong',
 *       }),
 *     }),
 *   },
 * });
 * ```
 */
export function defineModule(def: DispatchModule): DispatchModule {
  return def;
}

/**
 * Define one action inside a module.
 *
 * @param opts.description Human-readable description shown by module and
 * schema inspection commands.
 * @param opts.schema Zod schema for the public action payload. Dispatch
 * validates the step payload against this schema after interpolation.
 * @param opts.exportsSchema Optional Zod schema for `ActionResult.exports`.
 * Declared exports are visible to `dispatch schema action --print` and can be
 * referenced from step capture into `run.*`.
 * @param opts.credentialSchema Optional Zod schema for the resolved credential
 * object. When present, jobs should bind a credential profile through the
 * step's `credential` field and handlers read the resolved value from
 * `ctx.credential`.
 * @param opts.handler Async handler that receives `ActionContext` and the
 * validated payload and returns an `ActionResult`.
 */
export function defineAction<T>(opts: {
  description: string;
  schema: z.ZodSchema<T>;
  exportsSchema?: z.ZodSchema;
  credentialSchema?: z.ZodSchema;
  handler: (ctx: ActionContext, payload: T) => Promise<ActionResult>;
}): ModuleAction<T> {
  return opts;
}

/**
 * Context passed to every action handler.
 *
 * The context is scoped to one action invocation inside one job run.
 */
export interface ActionContext {
  /**
   * Shared HTTP transport for the current run.
   *
   * It is preconfigured from the job's top-level `http` block and keeps a
   * shared cookie jar across all actions in the same run.
   */
  http: HttpTransport;

  /**
   * Run artifact logger for the current run.
   *
   * Module authors usually use `appendActivity(...)` to log significant action
   * events. Dispatch records the underlying request and response artifacts
   * automatically.
   */
  artifacts: Artifacts;

  /**
   * Runtime state accumulated so far in the current run.
   *
   * `runtime.steps` exposes previous step responses and exports.
   * `runtime.run` exposes captured workflow values and run metadata.
   */
  runtime: RuntimeContext;

  /**
   * Normalized job step being executed right now.
   *
   * This includes the step id, fully qualified action key, raw payload, and
   * optional capture and credential bindings from the job file.
   */
  step: JobStep;

  /**
   * Resolved credential object for this step, when a job binds one.
   *
   * Lifecycle:
   * 1. The job declares `credentials.<name>.fromEnv`
   * 2. The step binds `"credential": "<name>"`
   * 3. Dispatch resolves those env vars into a plain object
   * 4. The handler reads the result here
   *
   * Handlers should cast this to the shape implied by `credentialSchema`.
   */
  credential?: unknown;

  /**
   * Resolve another action by its fully qualified key, such as
   * `flow.poll` or `admin.login`.
   *
   * Returns `null` when no loaded module provides that action.
   */
  resolve: (actionKey: string) => ResolvedAction | null;

  /**
   * Optional progress callback for long-running work.
   *
   * When present, handlers can call it with short human-readable messages to
   * update CLI progress output.
   */
  progress?: (message: string) => void;
}

/**
 * Fully resolved action metadata returned by the registry.
 *
 * When duplicate action keys exist, this represents the winning definition
 * after layer precedence is applied.
 */
export interface ResolvedAction {
  /** Fully qualified action key, for example `admin.login`. */
  actionKey: string;
  /** Module namespace that owns the action. */
  moduleName: string;
  /** Action suffix inside the module, for example `login`. */
  actionName: string;
  /** Source layer that supplied the winning action. */
  layer: 'builtin' | 'repo' | 'user';
  /** Module version for the winning action. */
  version: string;
  /** Absolute source directory path, or a builtin pseudo-path. */
  sourcePath: string;
  /** Action definition that will actually run. */
  definition: ModuleAction;
}
