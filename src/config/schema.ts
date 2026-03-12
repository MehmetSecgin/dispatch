import { z } from 'zod';

export const RegistryConfigSchema = z
  .object({
    url: z.string().url(),
    scope: z.string().regex(/^@[a-z0-9-]+$/, 'scope must be @org-name format'),
    authToken: z.string().optional(),
  })
  .strict();

export const DispatchConfigSchema = z
  .object({
    registry: RegistryConfigSchema.optional(),
  })
  .strict();

export type DispatchConfig = z.infer<typeof DispatchConfigSchema>;
export type RegistryConfig = z.infer<typeof RegistryConfigSchema>;
