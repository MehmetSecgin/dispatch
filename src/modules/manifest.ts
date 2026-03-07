import { z } from 'zod';

const ModuleActionManifestSchema = z.object({
  handler: z.string().min(1),
  description: z.string().min(1),
});

const ACTION_NAME_RE = /^[a-z0-9-]+$/;

export const ModuleManifestSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/),
  version: z.string().min(1),
  entry: z.string().default('index.mjs'),
  metadata: z.record(z.string(), z.unknown()).optional(),
  actions: z.record(z.string(), ModuleActionManifestSchema).superRefine((actions, ctx) => {
    if (Array.isArray(actions)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'actions must be an object map, not an array (array format removed in v0.4)',
      });
      return;
    }
    for (const key of Object.keys(actions)) {
      if (!ACTION_NAME_RE.test(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid action name '${key}': must match /^[a-z0-9-]+$/`,
          path: [key],
        });
      }
    }
  }),
});

export type ModuleManifest = z.infer<typeof ModuleManifestSchema>;
