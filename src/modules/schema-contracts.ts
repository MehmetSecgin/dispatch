import { z } from 'zod';

type JsonSchemaNode = Record<string, unknown>;

export function schemaToJsonSchema(schema?: z.ZodSchema): JsonSchemaNode | null {
  if (!schema) return null;
  return z.toJSONSchema(schema) as JsonSchemaNode;
}

export function summarizeSchemaProperties(schema?: z.ZodSchema): string | null {
  const jsonSchema = schemaToJsonSchema(schema);
  if (!jsonSchema) return null;

  const properties = jsonSchema.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return 'declared';

  const entries = Object.entries(properties as Record<string, unknown>);
  if (entries.length === 0) return 'declared';

  return entries
    .map(([key, value]) => `${key}:${schemaTypeLabel(value)}`)
    .join(', ');
}

function schemaTypeLabel(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'unknown';
  const node = value as Record<string, unknown>;
  if (typeof node.type === 'string') return node.type;
  if (Array.isArray(node.type)) return node.type.join('|');
  if (Array.isArray(node.enum)) return 'enum';
  if (Array.isArray(node.anyOf) || Array.isArray(node.oneOf)) return 'union';
  if (node.properties && typeof node.properties === 'object') return 'object';
  return 'unknown';
}
