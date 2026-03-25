import { z } from 'zod';
import { schemaToJsonSchema } from '../modules/schema-contracts.js';

type JsonSchemaNode = Record<string, unknown>;

export interface SchemaCoerceIssue {
  path: string;
  message: string;
}

type EffectiveType = 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object' | 'unknown';

export function coerceInputsFromSchema(
  rawInputs: Record<string, string>,
  schema: z.ZodSchema,
): { payload: Record<string, unknown>; issues: SchemaCoerceIssue[] } {
  const payload: Record<string, unknown> = {};
  const issues: SchemaCoerceIssue[] = [];
  const jsonSchema = schemaToJsonSchema(schema);
  const properties = isJsonObject(jsonSchema?.properties) ? (jsonSchema.properties as Record<string, unknown>) : {};

  for (const [key, rawValue] of Object.entries(rawInputs)) {
    const propertySchema = isJsonObject(properties[key]) ? (properties[key] as JsonSchemaNode) : null;
    const type = resolveEffectiveType(propertySchema);

    if (type === 'string') {
      payload[key] = rawValue;
      continue;
    }

    if (type === 'number' || type === 'integer') {
      const value = Number(rawValue);
      if (!Number.isFinite(value)) {
        issues.push({
          path: `inputs.${key}`,
          message: `Input '${key}' must be a finite ${type === 'integer' ? 'integer' : 'number'}`,
        });
        continue;
      }
      payload[key] = type === 'integer' ? Math.trunc(value) : value;
      if (type === 'integer' && !Number.isInteger(value)) {
        issues.push({
          path: `inputs.${key}`,
          message: `Input '${key}' must be an integer`,
        });
        delete payload[key];
      }
      continue;
    }

    if (type === 'boolean') {
      if (rawValue === 'true') {
        payload[key] = true;
        continue;
      }
      if (rawValue === 'false') {
        payload[key] = false;
        continue;
      }
      issues.push({
        path: `inputs.${key}`,
        message: `Input '${key}' must be 'true' or 'false'`,
      });
      continue;
    }

    if (type === 'array' || type === 'object') {
      const parsed = parseJsonInput(key, rawValue, type);
      if (!parsed.ok) {
        issues.push(parsed.issue);
        continue;
      }
      payload[key] = parsed.value;
      continue;
    }

    payload[key] = parseUnknownInput(rawValue);
  }

  return { payload, issues };
}

export function resolveEffectiveType(node: JsonSchemaNode | null | undefined): EffectiveType {
  if (!isJsonObject(node)) return 'unknown';

  if (typeof node.type === 'string') return normalizeType(node.type);
  if (Array.isArray(node.type)) {
    const types = node.type.map((value) => normalizeType(value)).filter((value) => value !== 'unknown');
    return types.length === 1 ? types[0] : 'unknown';
  }

  if (Array.isArray(node.enum) && node.enum.length > 0) {
    if (node.enum.every((value) => typeof value === 'number')) return 'number';
    if (node.enum.every((value) => typeof value === 'boolean')) return 'boolean';
    return 'string';
  }

  if (Object.prototype.hasOwnProperty.call(node, 'const')) {
    return normalizeConstType(node.const);
  }

  for (const key of ['anyOf', 'oneOf'] as const) {
    const variants = Array.isArray(node[key]) ? node[key].filter((value) => !isOptionalSentinel(value)) : [];
    if (variants.length !== 1 || !isJsonObject(variants[0])) continue;
    return resolveEffectiveType(variants[0] as JsonSchemaNode);
  }

  return 'unknown';
}

function parseJsonInput(
  key: string,
  rawValue: string,
  expectedType: 'array' | 'object',
): { ok: true; value: unknown } | { ok: false; issue: SchemaCoerceIssue } {
  try {
    const parsed = JSON.parse(rawValue);
    const typeMatches =
      (expectedType === 'array' && Array.isArray(parsed)) ||
      (expectedType === 'object' && !!parsed && typeof parsed === 'object' && !Array.isArray(parsed));
    if (!typeMatches) {
      return {
        ok: false,
        issue: {
          path: `inputs.${key}`,
          message: `Input '${key}' must be valid JSON ${expectedType}`,
        },
      };
    }
    return { ok: true, value: parsed };
  } catch {
    return {
      ok: false,
      issue: {
        path: `inputs.${key}`,
        message: `Input '${key}' must be valid JSON ${expectedType}`,
      },
    };
  }
}

function parseUnknownInput(rawValue: string): unknown {
  try {
    return JSON.parse(rawValue);
  } catch {
    return rawValue;
  }
}

function normalizeType(value: unknown): EffectiveType {
  if (value === 'string' || value === 'number' || value === 'integer' || value === 'boolean' || value === 'array' || value === 'object') {
    return value;
  }
  return 'unknown';
}

function normalizeConstType(value: unknown): EffectiveType {
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) return 'array';
  if (value && typeof value === 'object') return 'object';
  return 'unknown';
}

function isOptionalSentinel(value: unknown): boolean {
  return isJsonObject(value) && isJsonObject(value.not) && Object.keys(value.not).length === 0;
}

function isJsonObject(value: unknown): value is JsonSchemaNode {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
