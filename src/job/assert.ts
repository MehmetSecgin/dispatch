import { loadCallLog, readJsonMaybe } from '../data/run-data.js';
import path from 'node:path';
import type { JsonObject } from '../core/json.js';
import type { CallLogEntry } from '../data/run-data.js';

type AssertCheckName = 'no-failed-calls' | 'summary-present' | 'module-resolution-present' | 'calls-count-min';

interface AssertCheckResult {
  name: AssertCheckName;
  status: 'PASS' | 'FAIL';
  reason?: string;
  details?: JsonObject;
}

interface AssertRunResult {
  runId: string;
  runDir: string;
  overall: 'PASS' | 'FAIL';
  passed: number;
  failed: number;
  checks: AssertCheckResult[];
}

const DEFAULT_CHECKS: AssertCheckName[] = ['no-failed-calls', 'summary-present'];

const ALL_CHECKS: AssertCheckName[] = [
  'no-failed-calls',
  'summary-present',
  'module-resolution-present',
  'calls-count-min',
];

export function parseParams(paramFlags: string[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of paramFlags) {
    const idx = raw.indexOf('=');
    if (idx <= 0 || idx === raw.length - 1) {
      throw new Error(`Invalid --param '${raw}', expected key=value`);
    }
    const key = raw.slice(0, idx).trim();
    const value = raw.slice(idx + 1).trim();
    if (!key || !value) {
      throw new Error(`Invalid --param '${raw}', expected key=value`);
    }
    out[key] = value;
  }
  return out;
}

export function resolveChecks(checkFlags: string[] = []): AssertCheckName[] {
  if (checkFlags.length === 0) return [...DEFAULT_CHECKS];
  const unknown = checkFlags.filter((x) => !ALL_CHECKS.includes(x as AssertCheckName));
  if (unknown.length > 0) {
    throw new Error(`Unknown check(s): ${unknown.join(', ')}`);
  }
  const seen = new Set<string>();
  const ordered: AssertCheckName[] = [];
  for (const c of checkFlags as AssertCheckName[]) {
    if (seen.has(c)) continue;
    seen.add(c);
    ordered.push(c);
  }
  return ordered;
}

export function validateParamsForChecks(
  checks: AssertCheckName[],
  params: Record<string, string>,
  strictParams: boolean,
): void {
  if (!strictParams) return;

  const allowed = new Set<string>();
  if (checks.includes('calls-count-min')) allowed.add('min');

  const unknown = Object.keys(params).filter((k) => !allowed.has(k));
  if (unknown.length > 0) {
    throw new Error(`Unknown param(s) for selected checks: ${unknown.join(', ')}`);
  }
}

function pass(name: AssertCheckName, details?: JsonObject): AssertCheckResult {
  return { name, status: 'PASS', details };
}

function fail(name: AssertCheckName, reason: string, details?: JsonObject): AssertCheckResult {
  return { name, status: 'FAIL', reason, details };
}

function checkNoFailedCalls(calls: CallLogEntry[]): AssertCheckResult {
  const failedCount = calls.filter((c) => Number(c.httpCode) < 200 || Number(c.httpCode) > 299).length;
  if (failedCount > 0) return fail('no-failed-calls', `Found ${failedCount} failed call(s)`, { failedCount });
  return pass('no-failed-calls', { failedCount: 0 });
}

function checkSummaryPresent(summary: unknown): AssertCheckResult {
  if (!summary || typeof summary !== 'object') {
    return fail('summary-present', 'summary.json is missing or invalid');
  }
  return pass('summary-present');
}

function checkModuleResolutionPresent(moduleResolution: unknown): AssertCheckResult {
  if (!moduleResolution || typeof moduleResolution !== 'object') {
    return fail('module-resolution-present', 'module_resolution.json is missing or invalid');
  }
  return pass('module-resolution-present');
}

function checkCallsCountMin(calls: CallLogEntry[], minRaw?: string): AssertCheckResult {
  const min = minRaw === undefined ? 1 : Number(minRaw);
  if (!Number.isFinite(min) || Number.isNaN(min) || min < 0) {
    return fail('calls-count-min', `Invalid min param '${minRaw ?? ''}', expected non-negative number`);
  }
  if (calls.length < min) {
    return fail('calls-count-min', `calls count ${calls.length} is below min=${min}`, { count: calls.length, min });
  }
  return pass('calls-count-min', { count: calls.length, min });
}

export function runAssertions(input: {
  runId: string;
  runDir: string;
  checks: AssertCheckName[];
  params: Record<string, string>;
}): AssertRunResult {
  const { runId, runDir, checks, params } = input;
  const calls = loadCallLog(runDir);
  const summary = readJsonMaybe(path.join(runDir, 'summary.json'));
  const moduleResolution = readJsonMaybe(path.join(runDir, 'module_resolution.json'));

  const results: AssertCheckResult[] = checks.map((check) => {
    switch (check) {
      case 'no-failed-calls':
        return checkNoFailedCalls(calls);
      case 'summary-present':
        return checkSummaryPresent(summary);
      case 'module-resolution-present':
        return checkModuleResolutionPresent(moduleResolution);
      case 'calls-count-min':
        return checkCallsCountMin(calls, params.min);
      default:
        return fail(check, 'Unhandled check');
    }
  });

  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.length - passed;

  return {
    runId,
    runDir,
    overall: failed > 0 ? 'FAIL' : 'PASS',
    passed,
    failed,
    checks: results,
  };
}
