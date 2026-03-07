import { z } from 'zod';
import type { ConditionGroup, ConditionRule } from '../../../execution/conditions.js';

export const FlowSleepSchema = z.object({
  duration: z.string().min(1),
}).strict();

const FlowPollOperatorSchema = z.enum([
  'exists',
  'not_exists',
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'not_in',
  'contains',
  'regex',
]);

const comparatorNeedsValue = new Set([
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'not_in',
  'contains',
  'regex',
]);

const FlowPollConditionRuleSchema = z.object({
  path: z.string().min(1),
  op: FlowPollOperatorSchema,
  value: z.any().optional(),
}).strict().superRefine((rule, ctx) => {
  if (comparatorNeedsValue.has(rule.op) && rule.value === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: `value is required for op '${rule.op}'` });
  }
});

const FlowPollConditionGroupSchema: z.ZodType<ConditionGroup> = z.object({
  mode: z.enum(['ALL', 'ANY']),
  rules: z.array(z.union([
    FlowPollConditionRuleSchema,
    z.lazy(() => FlowPollConditionGroupSchema),
  ])).min(1),
}).strict();

export const FlowPollPayloadSchema = z.object({
  action: z.string().regex(/^[a-z0-9-]+\.[a-z0-9-]+$/),
  payload: z.record(z.string(), z.any()).optional().default({}),
  intervalMs: z.number().int().min(250).max(5000).optional().default(1000),
  maxDurationMs: z.number().int().min(1000).max(180000).optional().default(45000),
  maxAttempts: z.number().int().min(1).max(120).optional(),
  minSuccessAttempts: z.number().int().min(1).max(120).optional().default(1),
  conditions: FlowPollConditionGroupSchema,
  store: z.record(z.string(), z.string().min(1)).optional().default({}),
  continueOnActionError: z.boolean().optional().default(true),
}).strict().superRefine((value, ctx) => {
  if (value.maxAttempts !== undefined && value.minSuccessAttempts > value.maxAttempts) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['minSuccessAttempts'],
      message: 'minSuccessAttempts must be <= maxAttempts when maxAttempts is set',
    });
  }
});

export type FlowPollPayload = z.infer<typeof FlowPollPayloadSchema>;
