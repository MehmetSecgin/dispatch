import type { JsonObject } from '../core/json.js';
import type { JobCase, JobInputType } from '../core/schema.js';

export interface JobInputIssue {
  path: string;
  message: string;
}

interface ResolvedJobInputsResult {
  valid: boolean;
  issues: JobInputIssue[];
  values: JsonObject;
}

function parseRawInputs(rawInputs: string[]): { values: Record<string, string>; issues: JobInputIssue[] } {
  const values: Record<string, string> = {};
  const issues: JobInputIssue[] = [];

  for (const raw of rawInputs) {
    const trimmed = String(raw ?? '').trim();
    const eqIndex = trimmed.indexOf('=');
    if (!trimmed || eqIndex <= 0) {
      issues.push({
        path: 'inputs',
        message: `Input '${raw}' must use key=value format`,
      });
      continue;
    }

    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1);
    if (!key) {
      issues.push({
        path: 'inputs',
        message: `Input '${raw}' must include a non-empty key`,
      });
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      issues.push({
        path: `inputs.${key}`,
        message: `Input '${key}' was provided more than once`,
      });
      continue;
    }
    values[key] = value;
  }

  return { values, issues };
}

function parseTypedValue(key: string, rawValue: string, type: JobInputType): { ok: true; value: unknown } | { ok: false; issue: JobInputIssue } {
  if (type === 'string') return { ok: true, value: rawValue };

  if (type === 'number') {
    const value = Number(rawValue);
    if (!Number.isFinite(value)) {
      return {
        ok: false,
        issue: {
          path: `inputs.${key}`,
          message: `Input '${key}' must be a finite number`,
        },
      };
    }
    return { ok: true, value };
  }

  if (rawValue === 'true') return { ok: true, value: true };
  if (rawValue === 'false') return { ok: true, value: false };
  return {
    ok: false,
    issue: {
      path: `inputs.${key}`,
      message: `Input '${key}' must be 'true' or 'false'`,
    },
  };
}

export function resolveJobInputs(job: JobCase, rawInputs: string | string[] | undefined = []): ResolvedJobInputsResult {
  const declared = job.inputs ?? {};
  const issues: JobInputIssue[] = [];
  const values: JsonObject = {};
  const normalizedInputs = Array.isArray(rawInputs) ? rawInputs : rawInputs ? [rawInputs] : [];
  const parsed = parseRawInputs(normalizedInputs);
  issues.push(...parsed.issues);

  for (const key of Object.keys(parsed.values)) {
    if (!Object.prototype.hasOwnProperty.call(declared, key)) {
      issues.push({
        path: `inputs.${key}`,
        message: `Input '${key}' is not declared by this job`,
      });
    }
  }

  for (const [key, spec] of Object.entries(declared)) {
    const hasRaw = Object.prototype.hasOwnProperty.call(parsed.values, key);
    if (!hasRaw) {
      if (spec.required) {
        issues.push({
          path: `inputs.${key}`,
          message: `Required input '${key}' was not provided`,
        });
      }
      continue;
    }

    const parsedValue = parseTypedValue(key, parsed.values[key], spec.type);
    if (!parsedValue.ok) {
      issues.push(parsedValue.issue);
      continue;
    }
    values[key] = parsedValue.value;
  }

  return {
    valid: issues.length === 0,
    issues,
    values,
  };
}
