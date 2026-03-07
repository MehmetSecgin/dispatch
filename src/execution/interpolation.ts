import { JSONPath } from 'jsonpath-plus';
import { isJsonObject, type JsonObject, type JsonValue } from '../core/json.js';

type RuntimeStepState = { response?: JsonValue | unknown };

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

function interpolateString(s: string, ctx: RuntimeContext): string {
  return s.replace(/\$\{([^}]+)\}/g, (_m, exprRaw: string) => {
    const expr = String(exprRaw).trim();
    if (expr.startsWith('run.')) {
      const v = deepGetByPath(ctx.run, expr.slice(4));
      return v == null ? '' : String(v);
    }
    if (expr.startsWith('step.')) {
      const m = expr.match(/^step\.([^.]+)\.response\.(.+)$/);
      if (!m) return '';
      const stepId = m[1];
      const p = m[2];
      const step = ctx.steps[stepId];
      if (!step || step.response == null) return '';
      const v = deepGetByPath(step.response, p);
      return v == null ? '' : String(v);
    }
    if (expr.startsWith('jsonpath(') && expr.endsWith(')')) {
      const body = expr.slice('jsonpath('.length, -1);
      const [scope, jp] = body.split(',', 2).map((x) => x.trim());
      let target: unknown = null;
      if (scope === 'run') target = ctx.run;
      else if (scope.startsWith('step:')) {
        const id = scope.slice('step:'.length);
        target = ctx.steps[id]?.response;
      }
      if (target == null) return '';
      const found = JSONPath({ path: jp, json: target, wrap: false });
      return found == null ? '' : String(found);
    }
    return '';
  });
}

export function interpolateAny<T>(value: T, ctx: RuntimeContext): T {
  if (typeof value === 'string') return interpolateString(value, ctx) as T;
  if (Array.isArray(value)) return value.map((v) => interpolateAny(v, ctx)) as T;
  if (isJsonObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = interpolateAny(v, ctx);
    return out as T;
  }
  return value;
}
