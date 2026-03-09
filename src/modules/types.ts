import { z } from 'zod';
import { RunArtifacts } from '../artifacts/run-artifacts.js';
import { RuntimeContext } from '../execution/interpolation.js';
import { JobStep } from '../core/schema.js';
import { HttpTransport } from '../transport/http.js';

export type ModuleLayer = 'builtin' | 'repo' | 'user';
export type ModuleJobKind = 'seed' | 'case';

export interface ModuleJobDefinition {
  id: string;
  kind: ModuleJobKind;
  path: string;
}

export interface ActionResult {
  response?: unknown;
  exports?: Record<string, unknown>;
  detail?: string;
  diagnostics?: Record<string, unknown>;
}

// PUBLIC SDK CONTRACT — what module authors implement
export interface DispatchModule {
  name: string;
  version: string;
  actions: Record<string, ModuleAction>;
  metadata?: Record<string, unknown>;
}

type ActionHandler<T> = {
  bivarianceHack(ctx: ActionContext, payload: T): Promise<ActionResult>;
}['bivarianceHack'];

// Action definition — generic for type-safe authoring
export interface ModuleAction<T = unknown> {
  description: string;
  schema: z.ZodSchema<T>;
  handler: ActionHandler<T>;
}

// Type-safe helpers — the public authoring surface
export function defineModule(def: DispatchModule): DispatchModule {
  return def;
}

export function defineAction<T>(opts: {
  description: string;
  schema: z.ZodSchema<T>;
  handler: (ctx: ActionContext, payload: T) => Promise<ActionResult>;
}): ModuleAction<T> {
  return opts;
}

// Renamed from ModuleContext
export interface ActionContext {
  http: HttpTransport;
  artifacts: RunArtifacts;
  runtime: RuntimeContext;
  step: JobStep;
  resolve: (actionKey: string) => ResolvedAction | null;
  progress?: (message: string) => void;
}

// INTERNAL — runner adds layer/sourcePath
export interface ModuleDefinition {
  name: string;
  version: string;
  layer: ModuleLayer;
  sourcePath: string;
  metadata?: Record<string, unknown>;
  actions: Record<string, ModuleAction>;
  jobs?: ModuleJobDefinition[];
}

export interface ResolvedAction {
  actionKey: string;
  moduleName: string;
  actionName: string;
  layer: ModuleLayer;
  version: string;
  sourcePath: string;
  definition: ModuleAction;
}

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

export interface ModuleLoadResult {
  modules: ModuleDefinition[];
  warnings: string[];
}
