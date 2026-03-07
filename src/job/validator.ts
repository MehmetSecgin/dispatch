import { JobCase, normalizeSteps } from '../core/schema.js';
import { parseDurationMs } from '../core/time.js';
import { ModuleRegistry } from '../modules/registry.js';
import { isNamespacedAction } from '../modules/index.js';
import { isJsonPathSyntaxValid } from '../execution/conditions.js';
import type { ConditionGroup, ConditionRule } from '../execution/conditions.js';
import { FlowPollPayloadSchema } from '../modules/builtin/flow/schemas.js';
import { ActionDefaultsMap, applyActionDefaults } from '../execution/action-defaults.js';
import type { JobFileKind } from '../data/run-data.js';

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
    | 'DISALLOWED_MEMORY_MUTATION';
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
          for (const issue of parseResult.error.issues) {
            issues.push({
              code: 'MODULE_VALIDATION_ERROR',
              stepId: step.id,
              path: `payload.${issue.path.join('.') || '<root>'}`,
              message: `${step.action}: ${issue.path.join('.') || '<root>'}: ${issue.message}`,
            });
          }
        }
      }
    }

    if (step.action === 'flow.poll') {
      const parsedPoll = FlowPollPayloadSchema.safeParse(payload);
      if (!parsedPoll.success) {
        for (const issue of parsedPoll.error.issues) {
          issues.push({
            code: 'FLOW_POLL_VALIDATION_ERROR',
            stepId: step.id,
            path: `payload.${issue.path.join('.')}`,
            message: issue.message,
          });
        }
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
      const exprs = extractExpressions(s);
      if (s.includes('${') && exprs.length === 0) {
        issues.push({
          code: 'MALFORMED_INTERPOLATION',
          stepId: step.id,
          path: strPath,
          message: `Malformed interpolation expression in '${s}'`,
        });
        return;
      }

      for (const expr of exprs) {
        if (expr.startsWith('run.')) continue;

        const stepExpr = expr.match(/^step\.([^.]+)\.response\..+$/);
        if (stepExpr) {
          const refId = stepExpr[1];
          const refIdx = stepIndex.get(refId);
          if (refIdx == null) {
            issues.push({
              code: 'UNKNOWN_STEP_REFERENCE',
              stepId: step.id,
              path: strPath,
              message: `Unknown step reference '${refId}'`,
            });
          } else if (refIdx >= i) {
            issues.push({
              code: 'FORWARD_STEP_REFERENCE',
              stepId: step.id,
              path: strPath,
              message: `Forward step reference '${refId}' is not allowed`,
            });
          }
          continue;
        }

        const jpExpr = expr.match(/^jsonpath\((.+),\s*(.+)\)$/);
        if (jpExpr) {
          const scope = jpExpr[1].trim();
          if (scope === 'run') continue;
          if (scope.startsWith('step:')) {
            const refId = scope.slice('step:'.length);
            const refIdx = stepIndex.get(refId);
            if (refIdx == null) {
              issues.push({
                code: 'UNKNOWN_STEP_REFERENCE',
                stepId: step.id,
                path: strPath,
                message: `Unknown step reference '${refId}' in jsonpath`,
              });
            } else if (refIdx >= i) {
              issues.push({
                code: 'FORWARD_STEP_REFERENCE',
                stepId: step.id,
                path: strPath,
                message: `Forward step reference '${refId}' in jsonpath is not allowed`,
              });
            }
            continue;
          }
          issues.push({
            code: 'INVALID_INTERPOLATION',
            stepId: step.id,
            path: strPath,
            message: `Unsupported jsonpath scope '${scope}'`,
          });
          continue;
        }

        issues.push({
          code: 'INVALID_INTERPOLATION',
          stepId: step.id,
          path: strPath,
          message: `Unsupported interpolation expression '${expr}'`,
        });
      }
    });
  }

  if (registry) {
    for (const conflict of registry.listConflicts()) {
      warnings.push(
        `override: ${conflict.actionKey} winner=${conflict.winner.moduleName}@${conflict.winner.version} replaced=${conflict.previous.moduleName}@${conflict.previous.version}`,
      );
    }
  }

  return { valid: issues.length === 0, issues, warnings };
}
