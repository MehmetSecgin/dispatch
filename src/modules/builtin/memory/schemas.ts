import { z } from 'zod';

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
