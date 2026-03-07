import { isDeepStrictEqual } from 'node:util';
import { JSONPath } from 'jsonpath-plus';
import type { JsonValue } from '../core/json.js';

type ConditionOperator =
  | 'exists'
  | 'not_exists'
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'not_in'
  | 'contains'
  | 'regex';

export interface ConditionRule {
  path: string;
  op: ConditionOperator;
  value?: JsonValue;
}

export interface ConditionGroup {
  mode: 'ALL' | 'ANY';
  rules: Array<ConditionRule | ConditionGroup>;
}

type JsonPathInput = string | number | boolean | object | unknown[] | null;

export function pickJsonPath(path: string, data: unknown): unknown {
  return JSONPath({ path, json: data as JsonPathInput, wrap: false });
}

function hasValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function asNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function evaluateRule(rule: ConditionRule, data: unknown): { matched: boolean; summary: string } {
  const actual = pickJsonPath(rule.path, data);
  let matched = false;

  switch (rule.op) {
    case 'exists':
      matched = hasValue(actual);
      break;
    case 'not_exists':
      matched = !hasValue(actual);
      break;
    case 'eq':
      matched = isDeepStrictEqual(actual, rule.value);
      break;
    case 'neq':
      matched = !isDeepStrictEqual(actual, rule.value);
      break;
    case 'gt': {
      const a = asNumber(actual);
      const b = asNumber(rule.value);
      matched = a !== null && b !== null && a > b;
      break;
    }
    case 'gte': {
      const a = asNumber(actual);
      const b = asNumber(rule.value);
      matched = a !== null && b !== null && a >= b;
      break;
    }
    case 'lt': {
      const a = asNumber(actual);
      const b = asNumber(rule.value);
      matched = a !== null && b !== null && a < b;
      break;
    }
    case 'lte': {
      const a = asNumber(actual);
      const b = asNumber(rule.value);
      matched = a !== null && b !== null && a <= b;
      break;
    }
    case 'in':
      matched = Array.isArray(rule.value) ? rule.value.some((v) => isDeepStrictEqual(v, actual)) : false;
      break;
    case 'not_in':
      matched = Array.isArray(rule.value) ? !rule.value.some((v) => isDeepStrictEqual(v, actual)) : false;
      break;
    case 'contains':
      if (typeof actual === 'string') matched = actual.includes(String(rule.value ?? ''));
      else if (Array.isArray(actual)) matched = actual.some((v) => isDeepStrictEqual(v, rule.value));
      else matched = false;
      break;
    case 'regex':
      matched = typeof actual === 'string' ? new RegExp(String(rule.value ?? '')).test(actual) : false;
      break;
  }

  return { matched, summary: `${rule.path} ${rule.op} => ${matched}` };
}

export function evaluateConditionGroup(
  group: ConditionGroup,
  data: unknown,
): { matched: boolean; summaries: string[] } {
  const results = group.rules.map((rule) => {
    if ('mode' in rule) return evaluateConditionGroup(rule, data);
    const result = evaluateRule(rule, data);
    return { matched: result.matched, summaries: [result.summary] };
  });

  const matched =
    group.mode === 'ALL' ? results.every((result) => result.matched) : results.some((result) => result.matched);
  const summaries = results.flatMap((result) => result.summaries);
  return { matched, summaries };
}

export function isJsonPathSyntaxValid(path: string): boolean {
  try {
    JSONPath({ path, json: {}, wrap: false });
    return true;
  } catch {
    return false;
  }
}
