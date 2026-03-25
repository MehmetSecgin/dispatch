import path from 'node:path';
import { Command } from 'commander';
import { createRenderer, isColorEnabled, paint } from '../output/renderer.js';
import { cliErrorFromCode, exitCodeForCliError, jsonErrorEnvelope } from '../core/errors.js';
import { loadModuleRegistry } from '../modules/index.js';
import { parseRawInputs } from '../job/inputs.js';
import { coerceInputsFromSchema } from '../execution/schema-coerce.js';
import { applyActionDefaults, loadActionDefaults } from '../execution/action-defaults.js';
import { RunArtifacts } from '../artifacts/run-artifacts.js';
import { HttpTransportImpl } from '../transport/http.js';
import { getDefaultHttpPoolRegistry } from '../services/http-pool.js';
import { defaultRuntime } from '../data/run-data.js';
import { nowIso } from '../core/time.js';
import { writeJson } from '../utils/fs-json.js';
import { buildResolutionRow } from '../modules/conflicts.js';
import { nextActionsForActionRun } from '../job/next-actions.js';
import type { JobStep } from '../core/schema.js';

type CliOpts = {
  json?: boolean;
  verbose?: boolean;
  color?: boolean;
};

interface ActionRunSummary {
  cliVersion: string;
  action: string;
  status: 'SUCCESS' | 'FAILED';
  runId: string;
  runDir: string;
  response?: unknown;
  exports?: Record<string, unknown>;
  detail?: string | null;
}

function collectRepeatedOption(value: string, previous: string[] = []): string[] {
  previous.push(value);
  return previous;
}

function parseKeyValueList(
  entries: string[] | undefined,
  label: 'header' | 'credential',
): { values: Record<string, string>; issues: Array<{ path: string; message: string }> } {
  const values: Record<string, string> = {};
  const issues: Array<{ path: string; message: string }> = [];

  for (const raw of entries ?? []) {
    const trimmed = String(raw ?? '').trim();
    const eqIndex = trimmed.indexOf('=');
    if (!trimmed || eqIndex <= 0) {
      issues.push({
        path: label,
        message: `${label} '${raw}' must use key=value format`,
      });
      continue;
    }
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (!key) {
      issues.push({
        path: label,
        message: `${label} '${raw}' must include a non-empty key`,
      });
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      issues.push({
        path: `${label}.${key}`,
        message: `${label} '${key}' was provided more than once`,
      });
      continue;
    }
    values[key] = value;
  }

  return { values, issues };
}

function resolveCredential(
  actionKey: string,
  credentialSchema: { safeParse: (value: unknown) => { success: boolean; data?: unknown; error?: { issues: Array<{ path: Array<string | number>; message: string }> } } } | undefined,
  mappings: Record<string, string>,
): { credential?: unknown; issues: Array<{ path: string; message: string }>; warnings: string[] } {
  const issues: Array<{ path: string; message: string }> = [];
  const warnings: string[] = [];

  if (!credentialSchema) {
    if (Object.keys(mappings).length > 0) {
      warnings.push(`Action '${actionKey}' does not declare a credential contract; ignoring --credential values`);
    }
    return { issues, warnings };
  }

  if (Object.keys(mappings).length === 0) {
    issues.push({
      path: 'credential',
      message: `Action '${actionKey}' requires credentials; pass --credential <field=ENV_VAR>`,
    });
    return { issues, warnings };
  }

  const resolved: Record<string, string> = {};
  for (const [field, envName] of Object.entries(mappings)) {
    const value = process.env[envName];
    if (value === undefined || value === '') {
      issues.push({
        path: `credential.${field}`,
        message: `Missing required environment variable '${envName}'`,
      });
      continue;
    }
    resolved[field] = value;
  }

  if (issues.length > 0) return { issues, warnings };

  const parsed = credentialSchema.safeParse(resolved);
  if (!parsed.success) {
    for (const issue of parsed.error?.issues ?? []) {
      issues.push({
        path: issue.path.length > 0 ? `credential.${issue.path.join('.')}` : 'credential',
        message: issue.message,
      });
    }
    return { issues, warnings };
  }

  return {
    credential: parsed.data,
    issues,
    warnings,
  };
}

export function registerRunCommand(
  program: Command,
  deps: { cliVersion: string },
): void {
  program
    .command('run')
    .description('Run one action directly')
    .argument('<action>', 'Action key in <module.action> format')
    .option('--input <key=value>', 'Action input field', collectRepeatedOption, [])
    .option('--base-url <url>', 'HTTP base URL')
    .option('--header <key=value>', 'HTTP header', collectRepeatedOption, [])
    .option('--credential <field=ENV_VAR>', 'Credential field mapping', collectRepeatedOption, [])
    .action(async (actionKey: string, cmd) => {
      const opts = program.opts<CliOpts>();
      const color = isColorEnabled(opts);
      const renderer = createRenderer({ json: !!opts.json, color });
      const { registry, warnings: registryWarnings } = await loadModuleRegistry();
      const resolved = registry.resolve(String(actionKey));

      if (!resolved) {
        const err = cliErrorFromCode('NOT_FOUND', `Unknown action '${actionKey}'`);
        renderer.render({
          json: jsonErrorEnvelope(err),
          human: `Error: ${err.message}`,
        });
        process.exitCode = exitCodeForCliError(err);
        return;
      }

      const rawInputResult = parseRawInputs(cmd.input);
      const headerResult = parseKeyValueList(cmd.header, 'header');
      const credentialMapResult = parseKeyValueList(cmd.credential, 'credential');
      const coerced = coerceInputsFromSchema(rawInputResult.values, resolved.definition.schema);
      const payload = applyActionDefaults(resolved.actionKey, coerced.payload, loadActionDefaults());
      const payloadValidation = resolved.definition.schema.safeParse(payload);
      const preflightIssues = [
        ...rawInputResult.issues,
        ...headerResult.issues,
        ...credentialMapResult.issues,
        ...coerced.issues,
      ];

      if (preflightIssues.length > 0 || !payloadValidation.success) {
        const zodIssues = payloadValidation.success
          ? []
          : payloadValidation.error.issues.map((issue) => ({
              path: issue.path.length > 0 ? `inputs.${issue.path.join('.')}` : 'inputs',
              message: issue.message,
            }));
        const err = cliErrorFromCode('USAGE_ERROR', 'action input preflight failed', {
          action: resolved.actionKey,
          issues: [...preflightIssues, ...zodIssues],
          warnings: registryWarnings,
        });
        renderer.render({
          json: jsonErrorEnvelope(err),
          human: [
            `✗ Invalid inputs for ${resolved.actionKey}`,
            ...[...preflightIssues, ...zodIssues].map((issue) => `- ${issue.path}: ${issue.message}`),
          ],
        });
        process.exitCode = exitCodeForCliError(err);
        return;
      }

      const credentialResult = resolveCredential(
        resolved.actionKey,
        resolved.definition.credentialSchema as
          | { safeParse: (value: unknown) => { success: boolean; data?: unknown; error?: { issues: Array<{ path: Array<string | number>; message: string }> } } }
          | undefined,
        credentialMapResult.values,
      );
      const warnings = [...registryWarnings, ...credentialResult.warnings];

      if (credentialResult.issues.length > 0) {
        const err = cliErrorFromCode('USAGE_ERROR', 'action credential preflight failed', {
          action: resolved.actionKey,
          issues: credentialResult.issues,
          warnings,
        });
        renderer.render({
          json: jsonErrorEnvelope(err),
          human: [
            `✗ Missing credentials for ${resolved.actionKey}`,
            ...credentialResult.issues.map((issue) => `- ${issue.path}: ${issue.message}`),
          ],
        });
        process.exitCode = exitCodeForCliError(err);
        return;
      }

      const artifacts = new RunArtifacts('action-run');
      const runtime = defaultRuntime(deps.cliVersion);
      runtime.run.startedAt = nowIso();
      const step: JobStep = { id: 'run', action: resolved.actionKey, payload };
      const summaryBase = {
        cliVersion: deps.cliVersion,
        action: resolved.actionKey,
        runId: artifacts.runId,
        runDir: artifacts.runDir,
      };

      writeJson(path.join(artifacts.runDir, 'meta.json'), {
        cliVersion: deps.cliVersion,
        action: resolved.actionKey,
        runId: artifacts.runId,
        startedAt: runtime.run.startedAt,
      });
      writeJson(path.join(artifacts.runDir, 'module_resolution.json'), {
        generatedAt: nowIso(),
        warnings,
        conflicts: registry.listConflicts(),
        loadedModules: registry.listModules().map((mod) => ({
          name: mod.name,
          version: mod.version,
          layer: mod.layer,
          sourcePath: mod.sourcePath,
          actions: Object.keys(mod.actions).map((name) => `${mod.name}.${name}`),
        })),
        steps: [buildResolutionRow(step.id, step.action, resolved)],
      });

      const http = new HttpTransportImpl(artifacts, {
        baseUrl: typeof cmd.baseUrl === 'string' ? cmd.baseUrl : undefined,
        defaultHeaders: headerResult.values,
        poolRegistry: getDefaultHttpPoolRegistry(),
      });

      const writeSummary = (status: 'SUCCESS' | 'FAILED') => {
        writeJson(path.join(artifacts.runDir, 'summary.json'), {
          runId: artifacts.runId,
          runDir: artifacts.runDir,
          jobType: `action-run:${resolved.actionKey}`,
          startedAt: runtime.run.startedAt,
          status,
        });
      };

      try {
        const result = await resolved.definition.handler(
          {
            http,
            artifacts,
            runtime,
            step,
            credential: credentialResult.credential,
            resolve: (nextActionKey: string) => registry.resolve(nextActionKey),
          },
          payloadValidation.data,
        );

        if (resolved.definition.exportsSchema) {
          const exportsParseResult = resolved.definition.exportsSchema.safeParse(result.exports ?? {});
          if (!exportsParseResult.success) {
            const message = exportsParseResult.error.issues
              .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
              .join('; ');
            throw new Error(`Export validation failed for ${resolved.actionKey}: ${message}`);
          }
        }

        writeSummary('SUCCESS');
        const next = nextActionsForActionRun({ runId: artifacts.runId });
        const summary: ActionRunSummary = {
          ...summaryBase,
          status: 'SUCCESS',
          response: result.response,
          exports: result.exports,
          detail: result.detail ?? null,
        };

        renderer.render({
          json: { ...summary, next },
          human: [
            `${paint('✓', 'success', color)} ${resolved.actionKey}${result.detail ? `  ${result.detail}` : ''}`,
            ...(warnings.map((warning) => `${paint('!', 'warning', color)} ${warning}`)),
            ...(result.response === undefined ? [] : [JSON.stringify(result.response, null, 2)]),
          ],
        });
      } catch (error) {
        writeSummary('FAILED');
        const next = nextActionsForActionRun({ runId: artifacts.runId });
        const code = exitCodeForCliError(error) === 3 ? 'TRANSIENT_ERROR' : 'RUNTIME_ERROR';
        const err = cliErrorFromCode(code, error instanceof Error ? error.message : String(error), {
          action: resolved.actionKey,
          runId: artifacts.runId,
          runDir: artifacts.runDir,
          warnings,
        });
        renderer.render({
          json: jsonErrorEnvelope(err, next),
          human: [
            `Error: ${err.message}`,
            ...warnings.map((warning) => `${paint('!', 'warning', color)} ${warning}`),
            ...next.map((action) => `- ${action.description}: ${action.command}`),
          ],
        });
        process.exitCode = exitCodeForCliError(err);
      }
    });
}
