import { z } from 'zod';

const StepActionSchema = z
  .string()
  .regex(/^[a-z0-9-]+\.[a-z0-9-]+$/, 'Action must be namespaced: <module>.<action>');

const StepSchema = z
  .object({
    id: z.string().min(1).optional(),
    atRelative: z.string().optional(),
    atAbsolute: z.string().optional(),
    action: StepActionSchema,
    payload: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.atRelative && v.atAbsolute) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Step cannot have both atRelative and atAbsolute' });
    }
  });

export const JobCaseSchema = z.object({
  schemaVersion: z.number().int().min(1),
  jobType: z.string().min(1),
  scenario: z.object({
    steps: z.array(StepSchema).min(1),
  }),
  verification: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type JobCase = z.infer<typeof JobCaseSchema>;
export type JobStep = z.infer<typeof StepSchema> & { id: string };

export function normalizeSteps(job: JobCase): JobStep[] {
  return job.scenario.steps.map((s, idx) => ({ ...s, id: s.id ?? `step_${idx + 1}` }));
}
