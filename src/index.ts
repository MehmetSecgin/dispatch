export { defineAction, defineModule } from './modules/types.js';
export type {
  Artifacts,
  ActionContext,
  ActionResult,
  DispatchModule,
  ModuleAction,
  ResolvedAction,
} from './modules/types.js';
export type { JobStep } from './core/schema.js';
export type { RuntimeContext } from './execution/interpolation.js';
export type { HttpTransport, HttpResponse, HttpMethod, HttpRequestOptions } from './transport/types.js';

// authoring helpers
export { appendActivity } from './authoring/activity.js';
export type { ActivityValue } from './authoring/activity.js';
export { requireCredential } from './authoring/credentials.js';
export { resolveLookupValue } from './authoring/lookups.js';
export type { ResolverOptions } from './authoring/lookups.js';
export { normalizePositiveInteger, normalizePositiveIntegerList, resolveAliasValue } from './authoring/inputs.js';
export { NonEmptyStringSchema, PositiveIntegerSchema, PositiveIntegerLikeSchema, PositiveIntegerArraySchema, UuidSchema } from './authoring/schemas.js';
