import { JSONPath } from 'jsonpath-plus';
import { isJsonObject, type JsonObject, type JsonValue } from '../core/json.js';

/**
 * Runtime state recorded for one previously executed step.
 */
interface RuntimeStepState {
  /**
   * Value returned from `ActionResult.response`.
   *
   * Later steps can reference this as `${step.<stepId>.response...}`.
   */
  response?: JsonValue | unknown;

  /**
   * Value returned from `ActionResult.exports`.
   *
   * Later steps can reference this as `${step.<stepId>.exports...}`.
   */
  exports?: JsonObject | Record<string, unknown>;
}
const FULL_EXPR_RE = /^\$\{([^}]+)\}$/;

/**
 * Mutable run-scoped data available during interpolation and action execution.
 */
export interface RuntimeContext {
  /**
   * Absolute dispatch config directory path for the current process.
   */
  configDir: string;

  /**
   * Caller-supplied job inputs resolved before execution begins.
   *
   * Values here become addressable as `${input.<name>}`.
   */
  input: JsonObject;

  /**
   * Workflow-level captured values and run metadata.
   *
   * Values written here become addressable as `${run.<name>}`.
   */
  run: RunContext;

  /**
   * Per-step response and export state accumulated so far in this run.
   */
  steps: Record<string, RuntimeStepState>;
}

/**
 * Workflow-level state shared across the run.
 *
 * Dispatch stores captured values here, alongside a small amount of run
 * metadata such as the CLI version and run start time.
 */
interface RunContext extends JsonObject {
  /** CLI version for the current run, when known. */
  cliVersion?: string;

  /** Run start timestamp in ISO-8601 format, when available. */
  startedAt?: string;
}

function deepGetByPath(obj: unknown, dotPath: string): unknown {
  if (!dotPath) return obj;
  const parts = dotPath.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    if (!isJsonObject(cur)) return undefined;
    cur = cur[p];
  }
  return cur;
}

function evaluateExpression(exprRaw: string, ctx: RuntimeContext): unknown {
  const expr = String(exprRaw).trim();
  if (expr.startsWith('env.')) {
    const envName = expr.slice(4);
    const value = process.env[envName];
    return value == null ? '' : value;
  }
  if (expr.startsWith('input.')) {
    const value = deepGetByPath(ctx.input, expr.slice(6));
    return value == null ? '' : value;
  }
  if (expr.startsWith('run.')) {
    const value = deepGetByPath(ctx.run, expr.slice(4));
    return value == null ? '' : value;
  }
  if (expr.startsWith('step.')) {
    const match = expr.match(/^step\.([^.]+)\.(response|exports)\.(.+)$/);
    if (!match) return '';
    const stepId = match[1];
    const stateKey = match[2] as 'response' | 'exports';
    const dotPath = match[3];
    const step = ctx.steps[stepId];
    const state = step?.[stateKey];
    if (state == null) return '';
    const value = deepGetByPath(state, dotPath);
    return value == null ? '' : value;
  }
  if (expr.startsWith('jsonpath(') && expr.endsWith(')')) {
    const body = expr.slice('jsonpath('.length, -1);
    const [scope, jp] = body.split(',', 2).map((part) => part.trim());
    let target: unknown = null;
    if (scope === 'run') target = ctx.run;
    else if (scope.startsWith('step:')) target = ctx.steps[scope.slice('step:'.length)]?.response;
    if (target == null) return '';
    const found = JSONPath({ path: jp, json: target, wrap: false });
    return found == null ? '' : found;
  }
  return '';
}

function interpolateString(s: string, ctx: RuntimeContext): string {
  return s.replace(/\$\{([^}]+)\}/g, (_match, exprRaw: string) => String(evaluateExpression(exprRaw, ctx)));
}

export function interpolateAny<T>(value: T, ctx: RuntimeContext): T {
  if (typeof value === 'string') {
    const fullExpr = value.match(FULL_EXPR_RE);
    if (fullExpr) return evaluateExpression(fullExpr[1], ctx) as T;
    return interpolateString(value, ctx) as T;
  }
  if (Array.isArray(value)) return value.map((v) => interpolateAny(v, ctx)) as T;
  if (isJsonObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = interpolateAny(v, ctx);
    return out as T;
  }
  return value;
}
