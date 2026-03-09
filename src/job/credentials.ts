import { z } from 'zod';
import { normalizeSteps, type JobCase, type CredentialProfile, type JobStep } from '../core/schema.js';
import { schemaToJsonSchema } from '../modules/schema-contracts.js';
import type { ModuleAction, ResolvedAction } from '../modules/types.js';
import type { ModuleRegistry } from '../modules/registry.js';

type CredentialIssueCode =
  | 'MISSING_CREDENTIAL_PROFILE'
  | 'ACTION_REQUIRES_CREDENTIAL'
  | 'UNEXPECTED_CREDENTIAL_BINDING'
  | 'MISSING_CREDENTIAL_ENV'
  | 'INVALID_CREDENTIAL_BINDING';

export interface CredentialIssue {
  code: CredentialIssueCode;
  stepId: string;
  path: string;
  message: string;
}

export interface CredentialCheckResult {
  valid: boolean;
  issues: CredentialIssue[];
}

function credentialFieldRequirements(
  action: ModuleAction,
): { requiredFields: string[]; jsonSchema: Record<string, unknown> | null } | null {
  if (!action.credentialSchema) return null;
  const jsonSchema = schemaToJsonSchema(action.credentialSchema);
  if (!jsonSchema) return null;
  const required = Array.isArray(jsonSchema.required)
    ? jsonSchema.required.filter((value): value is string => typeof value === 'string')
    : [];
  return {
    requiredFields: required,
    jsonSchema,
  };
}

function resolvedCredentialFromProfile(profile: CredentialProfile): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [field, envName] of Object.entries(profile.fromEnv)) {
    const value = process.env[envName];
    if (value !== undefined) resolved[field] = value;
  }
  return resolved;
}

export function inspectJobCredentials(
  job: JobCase,
  registry: ModuleRegistry,
  opts?: { requireEnv?: boolean },
): CredentialCheckResult {
  const issues: CredentialIssue[] = [];

  for (const step of normalizeSteps(job)) {
    const resolved = registry.resolve(step.action);
    if (!resolved) continue;

    const credentialInfo = credentialFieldRequirements(resolved.definition);
    const credentialName = step.credential?.trim();
    if (credentialInfo && !credentialName) {
      issues.push({
        code: 'ACTION_REQUIRES_CREDENTIAL',
        stepId: step.id,
        path: 'credential',
        message: `Action '${step.action}' requires a credential profile`,
      });
      continue;
    }

    if (!credentialInfo && credentialName) {
      issues.push({
        code: 'UNEXPECTED_CREDENTIAL_BINDING',
        stepId: step.id,
        path: 'credential',
        message: `Action '${step.action}' does not declare a credential contract`,
      });
      continue;
    }

    if (!credentialInfo || !credentialName) continue;
    const profile = job.credentials?.[credentialName];
    if (!profile) {
      issues.push({
        code: 'MISSING_CREDENTIAL_PROFILE',
        stepId: step.id,
        path: 'credential',
        message: `Missing credential profile '${credentialName}'`,
      });
      continue;
    }

    for (const field of credentialInfo.requiredFields) {
      if (profile.fromEnv[field]) continue;
      issues.push({
        code: 'INVALID_CREDENTIAL_BINDING',
        stepId: step.id,
        path: `credentials.${credentialName}.fromEnv`,
        message: `Credential profile '${credentialName}' must map required field '${field}' for ${step.action}`,
      });
    }

    if (!opts?.requireEnv) continue;

    const resolvedCredential = resolvedCredentialFromProfile(profile);
    for (const [field, envName] of Object.entries(profile.fromEnv)) {
      if (resolvedCredential[field] !== undefined && resolvedCredential[field] !== '') continue;
      issues.push({
        code: 'MISSING_CREDENTIAL_ENV',
        stepId: step.id,
        path: `credentials.${credentialName}.fromEnv.${field}`,
        message: `Missing required environment variable '${envName}' for credential profile '${credentialName}'`,
      });
    }

    if (issues.some((issue) => issue.stepId === step.id && issue.path.startsWith(`credentials.${credentialName}.fromEnv`))) {
      continue;
    }

    const parsed = resolved.definition.credentialSchema?.safeParse(resolvedCredential);
    if (parsed && !parsed.success) {
      const message = parsed.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ');
      issues.push({
        code: 'INVALID_CREDENTIAL_BINDING',
        stepId: step.id,
        path: `credentials.${credentialName}`,
        message: `Credential values are incompatible with ${step.action}: ${message}`,
      });
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

export function resolveStepCredential(job: JobCase, step: JobStep, resolved: ResolvedAction): unknown {
  const credentialName = step.credential?.trim();
  const hasContract = !!resolved.definition.credentialSchema;

  if (!hasContract && !credentialName) return undefined;
  if (!hasContract && credentialName) {
    throw new Error(`Action '${step.action}' does not declare a credential contract`);
  }
  if (hasContract && !credentialName) {
    throw new Error(`Action '${step.action}' requires a credential profile`);
  }

  const profile = credentialName ? job.credentials?.[credentialName] : undefined;
  if (!profile) throw new Error(`Missing credential profile '${credentialName}'`);

  const resolvedCredential = resolvedCredentialFromProfile(profile);
  for (const [field, envName] of Object.entries(profile.fromEnv)) {
    if (resolvedCredential[field] !== undefined && resolvedCredential[field] !== '') continue;
    throw new Error(`Missing required environment variable '${envName}' for credential profile '${credentialName}'`);
  }

  const parsed = resolved.definition.credentialSchema?.safeParse(resolvedCredential);
  if (!parsed?.success) {
    const message = parsed?.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ');
    throw new Error(`Credential validation failed for ${step.action}: ${message}`);
  }

  return parsed.data;
}

export function summarizeCredentialSchemaProperties(schema?: z.ZodSchema): string | null {
  if (!schema) return null;
  const jsonSchema = schemaToJsonSchema(schema);
  if (!jsonSchema) return null;
  const properties = jsonSchema.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return 'declared';
  const entries = Object.entries(properties as Record<string, unknown>);
  if (entries.length === 0) return 'declared';
  return entries
    .map(([key, value]) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return `${key}:unknown`;
      const node = value as Record<string, unknown>;
      const type = typeof node.type === 'string' ? node.type : 'unknown';
      return `${key}:${type}`;
    })
    .join(', ');
}
