import { z } from 'zod';

const ModuleNameSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9-]+$/, 'Module names must match /^[a-z0-9-]+$/');

const MemoryNamespaceSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, 'Memory namespace must match /^[a-z0-9][a-z0-9_-]*$/');

const MemoryKeySchema = z
  .string()
  .min(1)
  .superRefine((value, ctx) => {
    const segments = value.split('.');
    if (segments.some((segment) => segment.trim().length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Memory key segments must be non-empty',
      });
    }
  });

const StepActionSchema = z
  .string()
  .regex(/^[a-z0-9-]+\.[a-z0-9-]+$/, 'Action must be namespaced: <module>.<action>');

const StepCaptureSchema = z.record(z.string(), z.string());
const EnvVarNameSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Environment variable names must match /^[A-Za-z_][A-Za-z0-9_]*$/');

const CredentialProfileSchema = z.object({
  fromEnv: z.record(z.string().min(1), EnvVarNameSchema),
});

const StepSchema = z
  .object({
    id: z.string().min(1).optional(),
    atRelative: z.string().optional(),
    atAbsolute: z.string().optional(),
    action: StepActionSchema,
    payload: z.record(z.string(), z.unknown()).optional(),
    capture: StepCaptureSchema.optional(),
    credential: z.string().min(1).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.atRelative && v.atAbsolute) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Step cannot have both atRelative and atAbsolute' });
    }
  });

const ModuleDependencySchema = z.object({
  name: ModuleNameSchema,
  version: z.string().min(1).optional(),
});

const MemoryDependencyFillSchema = z.object({
  module: ModuleNameSchema,
  job: z.string().min(1),
});

const MemoryDependencySchema = z.object({
  namespace: MemoryNamespaceSchema,
  key: MemoryKeySchema,
  fill: MemoryDependencyFillSchema.optional(),
});

const HttpDependencySchema = z.object({
  required: z.array(z.string().min(1)).optional(),
});

const JobDependenciesSchema = z.object({
  modules: z.array(ModuleDependencySchema).optional(),
  memory: z.array(MemoryDependencySchema).optional(),
  http: HttpDependencySchema.optional(),
});

const JobHttpSchema = z.object({
  baseUrl: z.string().min(1).optional(),
  defaultHeaders: z.record(z.string(), z.string()).optional(),
});

export const JobCaseSchema = z.object({
  schemaVersion: z.number().int().min(1),
  jobType: z.string().min(1),
  http: JobHttpSchema.optional(),
  credentials: z.record(z.string().min(1), CredentialProfileSchema).optional(),
  dependencies: JobDependenciesSchema.optional(),
  scenario: z.object({
    steps: z.array(StepSchema).min(1),
  }),
  verification: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type JobCase = z.infer<typeof JobCaseSchema>;
export type JobStep = z.infer<typeof StepSchema> & { id: string };
export type JobHttpConfig = z.infer<typeof JobHttpSchema>;
export type CredentialProfile = z.infer<typeof CredentialProfileSchema>;
export type JobDependencies = z.infer<typeof JobDependenciesSchema>;
export type ModuleDependency = z.infer<typeof ModuleDependencySchema>;
export type MemoryDependency = z.infer<typeof MemoryDependencySchema>;
export type MemoryDependencyFill = z.infer<typeof MemoryDependencyFillSchema>;
export type MemoryNamespace = z.infer<typeof MemoryNamespaceSchema>;
export type MemoryKey = z.infer<typeof MemoryKeySchema>;
export type HttpDependency = z.infer<typeof HttpDependencySchema>;

export function normalizeSteps(job: JobCase): JobStep[] {
  return job.scenario.steps.map((s, idx) => ({ ...s, id: s.id ?? `step_${idx + 1}` }));
}
