import { JSONPath } from 'jsonpath-plus';
import { isJsonObject, type JsonObject, type JsonValue } from '../core/json.js';

type RuntimeStepState = { response?: JsonValue | unknown };
const FULL_EXPR_RE = /^\$\{([^}]+)\}$/;

export interface RuntimeContext {
  configDir: string;
  run: RunContext;
  steps: Record<string, RuntimeStepState>;
}

interface RunContext extends JsonObject {
  cliVersion?: string;
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
  if (expr.startsWith('run.')) {
    const value = deepGetByPath(ctx.run, expr.slice(4));
    return value == null ? '' : value;
  }
  if (expr.startsWith('step.')) {
    const match = expr.match(/^step\.([^.]+)\.response\.(.+)$/);
    if (!match) return '';
    const stepId = match[1];
    const dotPath = match[2];
    const step = ctx.steps[stepId];
    if (!step || step.response == null) return '';
    const value = deepGetByPath(step.response, dotPath);
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
