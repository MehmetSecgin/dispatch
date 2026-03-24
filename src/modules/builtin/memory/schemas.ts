import { z } from 'zod';
import { isJsonPathSyntaxValid } from '../../../execution/conditions.js';

export const NamespaceSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, 'namespace must match /^[a-z0-9][a-z0-9_-]*$/');

const MemoryKeySchema = z
  .string()
  .min(1)
  .refine(
    (value) => value.split('.').every((segment) => segment.trim().length > 0),
    'key segments must be non-empty',
  );

const MemoryPrefixSchema = z
  .string()
  .min(1)
  .transform((value) => value.replace(/\.+$/g, ''))
  .refine(
    (value) => value.length > 0 && value.split('.').every((segment) => segment.trim().length > 0),
    'prefix segments must be non-empty',
  );

const JsonPathSchema = z
  .string()
  .min(1)
  .refine((value) => isJsonPathSyntaxValid(value), 'must be a valid JSONPath expression');

export const StoreSchema = z.object({
  namespace: NamespaceSchema,
  key: MemoryKeySchema,
  value: z.unknown(),
});

export const RecallSchema = z.object({
  namespace: NamespaceSchema,
  key: MemoryKeySchema,
  defaultValue: z.unknown().optional(),
});

export const ListSchema = z.object({
  namespace: NamespaceSchema.optional(),
  prefix: MemoryPrefixSchema.optional(),
}).superRefine((value, ctx) => {
  if (value.prefix !== undefined && value.namespace === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['prefix'],
      message: 'prefix requires namespace',
    });
  }
});

export const StoreManySchema = z.object({
  namespace: NamespaceSchema,
  source: z.union([z.array(z.unknown()), z.record(z.string(), z.unknown())]),
  keyJsonPath: JsonPathSchema,
  valueJsonPath: JsonPathSchema.optional().default('$.value'),
  keyPrefix: MemoryKeySchema.optional(),
});

export const RecallManySchema = z.object({
  namespace: NamespaceSchema,
  keys: z.array(MemoryKeySchema).min(1),
  defaultValue: z.unknown().optional(),
});

export const ForgetSchema = z.discriminatedUnion('all', [
  z.object({
    all: z.literal(true),
    namespace: NamespaceSchema,
  }),
  z.object({
    namespace: NamespaceSchema,
    all: z.literal(false).optional().default(false),
    key: MemoryKeySchema,
  }),
]);
