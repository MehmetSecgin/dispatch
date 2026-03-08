import { z } from 'zod';

export const ModuleManifestSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/),
  version: z.string().min(1),
  entry: z.string().default('index.mjs'),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type ModuleManifest = z.infer<typeof ModuleManifestSchema>;
