import { JobCase, normalizeSteps } from '../core/schema.js';
import { parseDurationMs } from '../core/time.js';
import { ModuleRegistry } from '../modules/registry.js';
import { isNamespacedAction } from '../modules/index.js';
import { isJsonPathSyntaxValid } from '../execution/conditions.js';
import type { ConditionGroup, ConditionRule } from '../execution/conditions.js';
import { FlowPollPayloadSchema } from '../modules/builtin/flow/schemas.js';
import { ActionDefaultsMap, applyActionDefaults } from '../execution/action-defaults.js';
import type { JobFileKind } from '../data/run-data.js';
import type { ZodIssue } from 'zod';

export interface ValidationIssue {
  code:
    | 'DUPLICATE_STEP_ID'
    | 'INVALID_AT_RELATIVE'
    | 'INVALID_AT_ABSOLUTE'
    | 'UNKNOWN_STEP_REFERENCE'
    | 'FORWARD_STEP_REFERENCE'
    | 'INVALID_INTERPOLATION'
    | 'MALFORMED_INTERPOLATION'
    | 'INVALID_ACTION_FORMAT'
    | 'UNKNOWN_ACTION'
    | 'MODULE_VALIDATION_ERROR'
    | 'FLOW_POLL_VALIDATION_ERROR'
    | 'DISALLOWED_MEMORY_MUTATION'
    | 'INVALID_CAPTURE';
  message: string;
  stepId?: string;
  path?: string;
}

interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  warnings: string[];
}

const EXPR_RE = /\$\{([^}]+)\}/g;
const ENV_VAR_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const FULL_INTERPOLATION_RE = /^\$\{([^}]+)\}$/;
const INPUT_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function extractExpressions(s: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = EXPR_RE.exec(s)) !== null) {
    out.push(String(m[1]).trim());
  }
  return out;
}

function traverseStrings(value: unknown, onString: (s: string, path: string) => void, path = 'payload'): void {
  if (typeof value === 'string') {
    onString(value, path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => traverseStrings(v, onString, `${path}[${i}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      traverseStrings(v, onString, `${path}.${k}`);
    }
  }
}

function getValueAtIssuePath(value: unknown, path: Array<string | number>): unknown {
  let current = value;
  for (const segment of path) {
    if (current == null) return undefined;
    if (typeof segment === 'number') {
      if (!Array.isArray(current)) return undefined;
      current = current[segment];
      continue;
    }
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function isDeferredInterpolationValue(value: unknown): boolean {
  return typeof value === 'string' && FULL_INTERPOLATION_RE.test(value.trim());
}

function toValidationIssues(
  parseIssues: ZodIssue[],
  payload: unknown,
  stepId: string,
  code: 'MODULE_VALIDATION_ERROR' | 'FLOW_POLL_VALIDATION_ERROR',
  messagePrefix?: string,
): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  for (const issue of parseIssues) {
    const rawValue = getValueAtIssuePath(payload, issue.path as Array<string | number>);
    if (isDeferredInterpolationValue(rawValue)) continue;
    out.push({
      code,
      stepId,
      path: `payload.${issue.path.join('.') || '<root>'}`,
      message: messagePrefix ? `${messagePrefix}: ${issue.path.join('.') || '<root>'}: ${issue.message}` : issue.message,
    });
  }
  return out;
}

function validateStepReference(
  issues: ValidationIssue[],
  stepId: string,
  currentStepIndex: number,
  stepIndex: Map<string, number>,
  path: string,
  refId: string,
  messagePrefix: string,
): void {
  const refIdx = stepIndex.get(refId);
  if (refIdx == null) {
    issues.push({
      code: 'UNKNOWN_STEP_REFERENCE',
      stepId,
      path,
      message: `${messagePrefix} '${refId}'`,
    });
  } else if (refIdx >= currentStepIndex) {
    issues.push({
      code: 'FORWARD_STEP_REFERENCE',
      stepId,
      path,
      message: `Forward step reference '${refId}' is not allowed`,
    });
  }
}

export function validateJobCase(
  job: JobCase,
  registry?: ModuleRegistry,
  actionDefaults: ActionDefaultsMap = {},
  opts?: { jobKind?: JobFileKind },
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const warnings: string[] = [];
  const steps = normalizeSteps(job);
  const stepIndex = new Map<string, number>();
  const jobKind = opts?.jobKind ?? 'case';

  for (let i = 0; i < steps.length; i += 1) {
    const id = steps[i].id;
    if (stepIndex.has(id)) {
      issues.push({
        code: 'DUPLICATE_STEP_ID',
        stepId: id,
        message: `Duplicate step id '${id}'`,
      });
    } else {
      stepIndex.set(id, i);
    }
  }

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    const payload = applyActionDefaults(step.action, step.payload ?? {}, actionDefaults);

    if (jobKind === 'case' && (step.action === 'memory.store' || step.action === 'memory.forget')) {
      issues.push({
        code: 'DISALLOWED_MEMORY_MUTATION',
        stepId: step.id,
        path: 'action',
        message: `${step.action} is only allowed in seed jobs`,
      });
    }

    for (const [captureKey, captureSource] of Object.entries(step.capture ?? {})) {
      const capturePath = `capture.${captureKey || '<empty>'}`;
      if (!captureKey.trim() || captureKey.split('.').some((segment) => segment.trim().length === 0)) {
        issues.push({
          code: 'INVALID_CAPTURE',
          stepId: step.id,
          path: capturePath,
          message: 'Capture target keys must use non-empty dot segments',
        });
      }
      if (!captureSource.startsWith('exports.')) {
        issues.push({
          code: 'INVALID_CAPTURE',
          stepId: step.id,
          path: capturePath,
          message: `Capture source '${captureSource}' must start with 'exports.'`,
        });
        continue;
      }
      const sourcePath = captureSource.slice('exports.'.length);
      if (!sourcePath || sourcePath.split('.').some((segment) => segment.trim().length === 0)) {
        issues.push({
          code: 'INVALID_CAPTURE',
          stepId: step.id,
          path: capturePath,
          message: 'Capture source paths must use non-empty dot segments after exports.',
        });
      }
    }

    if (!isNamespacedAction(step.action)) {
      issues.push({
        code: 'INVALID_ACTION_FORMAT',
        stepId: step.id,
        path: 'action',
        message: `Action '${step.action}' must be namespaced as <module>.<action>`,
      });
    }

    if (step.atRelative) {
      try {
        parseDurationMs(step.atRelative);
      } catch {
        issues.push({
          code: 'INVALID_AT_RELATIVE',
          stepId: step.id,
          path: 'atRelative',
          message: `Invalid atRelative '${step.atRelative}'`,
        });
      }
    }

    if (step.atAbsolute && Number.isNaN(Date.parse(step.atAbsolute))) {
      issues.push({
        code: 'INVALID_AT_ABSOLUTE',
        stepId: step.id,
        path: 'atAbsolute',
        message: `Invalid atAbsolute '${step.atAbsolute}'`,
      });
    }

    if (registry) {
      const resolved = registry.resolve(step.action);
      if (!resolved) {
        issues.push({
          code: 'UNKNOWN_ACTION',
          stepId: step.id,
          path: 'action',
          message: `Unknown action '${step.action}' in loaded module registry`,
        });
      } else {
        const parseResult = resolved.definition.schema.safeParse(payload);
        if (!parseResult.success) {
          issues.push(
            ...toValidationIssues(
              parseResult.error.issues,
              payload,
              step.id,
              'MODULE_VALIDATION_ERROR',
              step.action,
            ),
          );
        }
      }
    }

    if (step.action === 'flow.poll') {
      const parsedPoll = FlowPollPayloadSchema.safeParse(payload);
      if (!parsedPoll.success) {
        issues.push(...toValidationIssues(parsedPoll.error.issues, payload, step.id, 'FLOW_POLL_VALIDATION_ERROR'));
      } else {
        const poll = parsedPoll.data;
        if (poll.action === step.action) {
          issues.push({
            code: 'FLOW_POLL_VALIDATION_ERROR',
            stepId: step.id,
            path: 'payload.action',
            message: 'flow.poll cannot target flow.poll directly',
          });
        }
        if (!isNamespacedAction(poll.action)) {
          issues.push({
            code: 'FLOW_POLL_VALIDATION_ERROR',
            stepId: step.id,
            path: 'payload.action',
            message: `Invalid poll target action '${poll.action}'`,
          });
        } else if (registry && !registry.resolve(poll.action)) {
          issues.push({
            code: 'FLOW_POLL_VALIDATION_ERROR',
            stepId: step.id,
            path: 'payload.action',
            message: `Unknown poll target action '${poll.action}' in loaded module registry`,
          });
        }

        const validateConditionPaths = (group: ConditionGroup, pathPrefix: string) => {
          if (!group || !Array.isArray(group.rules)) return;
          for (let j = 0; j < group.rules.length; j += 1) {
            const rule = group.rules[j];
            if (rule && typeof rule === 'object' && 'mode' in rule) {
              validateConditionPaths(rule, `${pathPrefix}.rules[${j}]`);
              continue;
            }
            const leafRule = rule as ConditionRule;
            if (leafRule && typeof leafRule.path === 'string' && !isJsonPathSyntaxValid(leafRule.path)) {
              issues.push({
                code: 'FLOW_POLL_VALIDATION_ERROR',
                stepId: step.id,
                path: `${pathPrefix}.rules[${j}].path`,
                message: `Invalid JSONPath '${leafRule.path}'`,
              });
            }
          }
        };
        validateConditionPaths(poll.conditions, 'payload.conditions');

        for (const [storeKey, jp] of Object.entries(poll.store ?? {})) {
          if (!isJsonPathSyntaxValid(jp)) {
            issues.push({
              code: 'FLOW_POLL_VALIDATION_ERROR',
              stepId: step.id,
              path: `payload.store.${storeKey}`,
              message: `Invalid JSONPath '${jp}'`,
            });
          }
        }
      }
    }

    traverseStrings(payload, (s, strPath) => {
      validateInterpolationString({
        value: s,
        path: strPath,
        stepId: step.id,
        currentStepIndex: i,
        stepIndex,
        declaredInputs: new Set(Object.keys(job.inputs ?? {})),
        issues,
        allowStepReferences: true,
        allowJsonPathStepScope: true,
      });
    });
  }

  traverseStrings(
    job.http,
    (s, strPath) => {
      validateInterpolationString({
        value: s,
        path: strPath,
        declaredInputs: new Set(Object.keys(job.inputs ?? {})),
        issues,
        stepIndex,
        allowStepReferences: false,
        allowJsonPathStepScope: false,
      });
    },
    'http',
  );

  if (registry) {
    for (const conflict of registry.listConflicts()) {
      warnings.push(
        `override: ${conflict.actionKey} winner=${conflict.winner.moduleName}@${conflict.winner.version} replaced=${conflict.previous.moduleName}@${conflict.previous.version}`,
      );
    }
  }

  return { valid: issues.length === 0, issues, warnings };
}

function validateInterpolationString(input: {
  value: string;
  path: string;
  issues: ValidationIssue[];
  stepIndex: Map<string, number>;
  declaredInputs: Set<string>;
  stepId?: string;
  currentStepIndex?: number;
  allowStepReferences: boolean;
  allowJsonPathStepScope: boolean;
}): void {
  const exprs = extractExpressions(input.value);
  if (input.value.includes('${') && exprs.length === 0) {
    input.issues.push({
      code: 'MALFORMED_INTERPOLATION',
      stepId: input.stepId,
      path: input.path,
      message: `Malformed interpolation expression in '${input.value}'`,
    });
    return;
  }

  for (const expr of exprs) {
    if (expr.startsWith('run.')) continue;

    const envExpr = expr.match(/^env\.(.+)$/);
    if (envExpr) {
      if (ENV_VAR_NAME_RE.test(envExpr[1])) continue;
      input.issues.push({
        code: 'INVALID_INTERPOLATION',
        stepId: input.stepId,
        path: input.path,
        message: `Invalid environment variable reference '${expr}'`,
      });
      continue;
    }

    const inputExpr = expr.match(/^input\.(.*)$/);
    if (inputExpr) {
      const [topLevel, ...rest] = inputExpr[1].split('.');
      if (!INPUT_NAME_RE.test(topLevel) || rest.some((segment) => segment.trim().length === 0)) {
        input.issues.push({
          code: 'INVALID_INTERPOLATION',
          stepId: input.stepId,
          path: input.path,
          message: `Invalid input reference '${expr}'`,
        });
        continue;
      }
      if (!input.declaredInputs.has(topLevel)) {
        input.issues.push({
          code: 'INVALID_INTERPOLATION',
          stepId: input.stepId,
          path: input.path,
          message: `Unknown input reference '${expr}'`,
        });
      }
      continue;
    }

    const stepExpr = expr.match(/^step\.([^.]+)\.(response|exports)\..+$/);
    if (stepExpr) {
      if (!input.allowStepReferences) {
        input.issues.push({
          code: 'INVALID_INTERPOLATION',
          stepId: input.stepId,
          path: input.path,
          message: `Step references are not supported in '${input.path}'`,
        });
        continue;
      }
      validateStepReference(
        input.issues,
        input.stepId ?? '<job>',
        input.currentStepIndex ?? 0,
        input.stepIndex,
        input.path,
        stepExpr[1],
        'Unknown step reference',
      );
      continue;
    }

    const jpExpr = expr.match(/^jsonpath\((.+),\s*(.+)\)$/);
    if (jpExpr) {
      const scope = jpExpr[1].trim();
      if (scope === 'run') continue;
      if (scope.startsWith('step:')) {
        if (!input.allowJsonPathStepScope) {
          input.issues.push({
            code: 'INVALID_INTERPOLATION',
            stepId: input.stepId,
            path: input.path,
            message: `Step jsonpath scope is not supported in '${input.path}'`,
          });
          continue;
        }
        const refId = scope.slice('step:'.length);
        const refIdx = input.stepIndex.get(refId);
        if (refIdx == null) {
          input.issues.push({
            code: 'UNKNOWN_STEP_REFERENCE',
            stepId: input.stepId,
            path: input.path,
            message: `Unknown step reference '${refId}' in jsonpath`,
          });
        } else if (refIdx >= (input.currentStepIndex ?? 0)) {
          input.issues.push({
            code: 'FORWARD_STEP_REFERENCE',
            stepId: input.stepId,
            path: input.path,
            message: `Forward step reference '${refId}' in jsonpath is not allowed`,
          });
        }
        continue;
      }
      input.issues.push({
        code: 'INVALID_INTERPOLATION',
        stepId: input.stepId,
        path: input.path,
        message: `Unsupported jsonpath scope '${scope}'`,
      });
      continue;
    }

    input.issues.push({
      code: 'INVALID_INTERPOLATION',
      stepId: input.stepId,
      path: input.path,
      message: `Unsupported interpolation expression '${expr}'`,
    });
  }
}
