import { z } from 'zod';

export const StoreSchema = z.object({
  key: z.string().min(1),
  value: z.any(),
});

export const RecallSchema = z.object({
  key: z.string().min(1),
  defaultValue: z.any().optional(),
});

export const ForgetSchema = z.discriminatedUnion('all', [
  z.object({ all: z.literal(true) }),
  z.object({
    all: z.literal(false).optional().default(false),
    key: z.string().min(1),
  }),
]);
