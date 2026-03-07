import fs from 'node:fs';
import path from 'node:path';
import { RunArtifacts } from '../artifacts/run-artifacts.js';
import type { JsonObject } from '../core/json.js';
import { loadModuleRegistry } from '../modules/index.js';
import { buildResolutionRow } from '../modules/conflicts.js';
import { HttpTransport } from '../transport/http.js';
import { interpolateAny, RuntimeContext } from '../execution/interpolation.js';
import { JobCase, normalizeSteps } from '../core/schema.js';
import { defaultRuntime } from '../data/run-data.js';
import { nowIso, parseDurationMs, sleep } from '../core/time.js';
import { sanitizeValue } from '../execution/sanitize.js';
import { writeJson } from '../utils/fs-json.js';
import { applyActionDefaults, loadActionDefaults } from '../execution/action-defaults.js';
import { debugNs, redactDebug } from '../core/debug.js';
import { HttpPoolRegistry } from '../services/http-pool.js';
import { Listr } from 'listr2';
import { paint, Renderer, shortenHomePath } from '../output/renderer.js';
import { NextAction, nextActionsForJobRun } from './next-actions.js';

const debug = debugNs('job-runner');

interface JobRunSummary {
  cliVersion: string;
  jobType: string;
  status: 'FAILED' | 'SUCCESS';
  runId: string;
  runDir: string;
  moduleResolutionPath: string;
  failedStep: { id: string; action: string } | null;
  failedStepIndex: number | null;
  error: string | null;
}

export class JobRunExecutionError extends Error {
  readonly summary: JobRunSummary;

  constructor(summary: JobRunSummary) {
    super(summary.error ?? 'job run failed');
    this.name = 'JobRunExecutionError';
    this.summary = summary;
  }
}

export async function executeJobCase(
  job: JobCase,
  opts: {
    json: boolean;
    label: string;
    cliVersion: string;
    verbose?: boolean;
    color?: boolean;
    runtimeOverrides?: JsonObject;
    poolRegistry?: HttpPoolRegistry;
    renderer?: Renderer;
  },
): Promise<JobRunSummary> {
  debug('execute start jobType=%s json=%s verbose=%s label=%s', job.jobType, opts.json, !!opts.verbose, opts.label);
  const artifacts = new RunArtifacts(opts.label);
  const http = new HttpTransport(artifacts, {
    verboseArtifacts: !!opts.verbose,
    poolRegistry: opts.poolRegistry,
  });

  const runtime: RuntimeContext = defaultRuntime(opts.cliVersion, {
    overrides: opts.runtimeOverrides,
  });
  runtime.run.startedAt = nowIso();

  writeJson(path.join(artifacts.runDir, 'meta.json'), {
    cliVersion: opts.cliVersion,
    schemaVersion: job.schemaVersion,
    runId: artifacts.runId,
    startedAt: runtime.run.startedAt,
  });
  writeJson(path.join(artifacts.runDir, 'job.case.input.json'), sanitizeValue(job));

  const { registry, warnings } = await loadModuleRegistry();
  debug('modules loaded warnings=%d conflicts=%d', warnings.length, registry.listConflicts().length);
  const actionDefaults = loadActionDefaults();
  const steps = normalizeSteps(job);
  const stepResolution = steps.map((step) => buildResolutionRow(step.id, step.action, registry.resolve(step.action)));
  const moduleResolution = {
    generatedAt: nowIso(),
    warnings,
    conflicts: registry.listConflicts(),
    loadedModules: registry.listModules().map((m) => ({
      name: m.name,
      version: m.version,
      layer: m.layer,
      sourcePath: m.sourcePath,
      actions: Object.keys(m.actions).map((name) => `${m.name}.${name}`),
    })),
    steps: stepResolution,
  };
  writeJson(path.join(artifacts.runDir, 'module_resolution.json'), moduleResolution);
  debug('module resolution written path=%s', path.join(artifacts.runDir, 'module_resolution.json'));

  const runStartMs = Date.now();
  const verbose = !opts.json;
  const interactiveHuman = verbose && !!process.stdout.isTTY;
  const color = opts.color ?? (interactiveHuman && !process.env.NO_COLOR);
  const renderer = opts.renderer;

  const waitQuietly = async (ms: number) => {
    await sleep(ms);
  };

  const actionPad = Math.max(...steps.map((s) => s.action.length), 24);
  let failedStep: { id: string; action: string } | null = null;
  let failedStepIndex: number | null = null;
  let executionError: Error | null = null;

  const runStep = async (stepIdx: number, onProgress?: (message: string) => void) => {
    const step = steps[stepIdx];
    const stepNum = stepIdx + 1;
    if (step.atRelative) {
      const wait = parseDurationMs(step.atRelative);
      const target = runStartMs + wait;
      const now = Date.now();
      if (target > now) await waitQuietly(target - now);
    } else if (step.atAbsolute) {
      const t = Date.parse(step.atAbsolute);
      if (Number.isNaN(t)) throw new Error(`Invalid atAbsolute in step ${step.id}`);
      const now = Date.now();
      if (t > now) await waitQuietly(t - now);
    }

    const payloadWithDefaults = applyActionDefaults(step.action, step.payload ?? {}, actionDefaults);
    const payload = interpolateAny(payloadWithDefaults, runtime);
    debug('step start idx=%d id=%s action=%s payload=%O', stepNum, step.id, step.action, redactDebug(payload));
    artifacts.appendActivity(`step ${step.id} action=${step.action}`);

    const resolved = registry.resolve(step.action);
    if (!resolved) throw new Error(`Unknown action '${step.action}' (no module handler loaded)`);

    const parseResult = resolved.definition.schema.safeParse(payload);
    if (!parseResult.success) {
      const errors = parseResult.error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`);
      debug('step validation failed id=%s action=%s errors=%o', step.id, step.action, errors);
      throw new Error(`Validation failed for ${step.action}: ${errors.join('; ')}`);
    }

    const result = await resolved.definition.handler(
      {
        http,
        artifacts,
        runtime,
        step,
        resolve: (actionKey: string) => registry.resolve(actionKey),
        progress: onProgress,
      },
      payload,
    );

    runtime.steps[step.id] = { response: result.response ?? {} };
    debug(
      'step done idx=%d id=%s action=%s detail=%s response=%O',
      stepNum,
      step.id,
      step.action,
      result.detail ?? '',
      redactDebug(result.response),
    );
    return result;
  };

  if (verbose) {
    printJobRunHeader(renderer, job.jobType, artifacts.runId);
    for (const warning of warnings) renderer?.line(`  ! module warning: ${warning}`);
    if (warnings.length > 0) renderer?.line('');
  }

  try {
    if (interactiveHuman) {
      const tasks = new Listr(
        steps.map((step, idx) => ({
          title: `[${idx + 1}/${steps.length}] ${step.action}`,
          task: async (_ctx: unknown, task: { title: string; output?: string }) => {
            const stepStartedAt = Date.now();
            try {
              const result = await runStep(idx, (message: string) => {
                task.output = singleLineProgress(message);
              });
              const stepDuration = ((Date.now() - stepStartedAt) / 1000).toFixed(2);
              const detail = result.detail ? `  ${result.detail}` : '';
              task.title = `[${idx + 1}/${steps.length}] ${step.action}  ${stepDuration}s${detail}`;
            } catch (err) {
              failedStep = { id: step.id ?? `step_${idx + 1}`, action: step.action };
              failedStepIndex = idx + 1;
              throw err;
            }
          },
        })),
        {
          concurrent: false,
          exitOnError: true,
          rendererOptions: {
            collapse: false,
            showTimer: false,
          } as Record<string, unknown>,
        },
      );
      await tasks.run();
    } else {
      for (let stepIdx = 0; stepIdx < steps.length; stepIdx += 1) {
        const step = steps[stepIdx];
        const stepNum = stepIdx + 1;
        const stepStartedAt = Date.now();
        if (verbose) {
          renderer?.line(
            `  ${paint(`[${stepNum}/${steps.length}]`, 'dim', color)} ${step.action.padEnd(actionPad)} ${paint('…', 'accent', color)} running`,
          );
        }
        try {
          const result = await runStep(stepIdx);
          const stepDuration = ((Date.now() - stepStartedAt) / 1000).toFixed(2);
          if (verbose) {
            const detail = result.detail ? `  ${result.detail}` : '';
            renderer?.line(
              `  ${paint(`[${stepNum}/${steps.length}]`, 'dim', color)} ${step.action.padEnd(actionPad)} ${paint('✓', 'success', color)} ${stepDuration}s${detail}`,
            );
          }
        } catch (err) {
          failedStep = { id: step.id ?? `step_${stepNum}`, action: step.action };
          failedStepIndex = stepNum;
          if (verbose) {
            const msg = err instanceof Error ? err.message : String(err);
            renderer?.line(
              `  ${paint(`[${stepNum}/${steps.length}]`, 'dim', color)} ${step.action.padEnd(actionPad)} ${paint('✗', 'error', color)} ${msg}`,
            );
          }
          throw err;
        }
      }
    }

    const resolvedCase = interpolateAny(job, runtime);
    writeJson(path.join(artifacts.runDir, 'job.case.resolved.json'), sanitizeValue(resolvedCase));
  } catch (err) {
    executionError = err instanceof Error ? err : new Error(String(err));
  }

  const summary: JobRunSummary = {
    cliVersion: opts.cliVersion,
    jobType: job.jobType,
    status: executionError ? ('FAILED' as const) : ('SUCCESS' as const),
    runId: artifacts.runId,
    runDir: artifacts.runDir,
    moduleResolutionPath: path.join(artifacts.runDir, 'module_resolution.json'),
    failedStep,
    failedStepIndex,
    error: executionError ? executionError.message : null,
  };
  writeJson(path.join(artifacts.runDir, 'summary.json'), summary);
  debug('execute done runId=%s summary=%O', artifacts.runId, redactDebug(summary));

  if (verbose) {
    const totalRuntimeSec = ((Date.now() - runStartMs) / 1000).toFixed(2);
    printJobRunSummary(
      renderer,
      {
        totalRuntimeSec,
        moduleResolutionPath: String(summary.moduleResolutionPath),
        runDir: summary.runDir,
        status: summary.status,
        error: summary.error,
        next: nextActionsForJobRun({
          status: summary.status,
          runId: summary.runId,
          failedStepIndex: summary.failedStepIndex,
        }),
      },
      color,
    );
  }

  if (executionError) throw new JobRunExecutionError(summary);
  return summary;
}

function printJobRunHeader(renderer: Renderer | undefined, jobType: string, runId: string): void {
  const pad = '  ';
  const title = '─ Job Run ';
  const minGap = 2;
  const interiorWidth = Math.max(62, jobType.length + runId.length + minGap + 2);
  const gap = Math.max(minGap, interiorWidth - jobType.length - runId.length - 2);
  const border = '─'.repeat(Math.max(0, interiorWidth - title.length));
  renderer?.line('');
  renderer?.line(`${pad}┌${title}${border}┐`);
  renderer?.line(`${pad}│ ${jobType}${' '.repeat(gap)}${runId} │`);
  renderer?.line(`${pad}└${'─'.repeat(interiorWidth)}┘`);
  renderer?.line('');
}

function printJobRunSummary(
  renderer: Renderer | undefined,
  summary: {
    totalRuntimeSec: string;
    moduleResolutionPath: string;
    runDir: string;
    status: 'FAILED' | 'SUCCESS';
    error?: string | null;
    next: NextAction[];
  },
  color: boolean,
): void {
  const failed = summary.status === 'FAILED';
  const mark = failed ? paint('✗', 'error', color) : paint('✓', 'success', color);
  const word = failed ? 'Failed' : 'Complete';
  renderer?.line(`${mark} ${word} in ${summary.totalRuntimeSec}s`);
  if (failed && summary.error) renderer?.line(`${paint('Error', 'dim', color)}    ${summary.error}`);
  renderer?.line('');
  renderer?.line(`${paint('Modules', 'dim', color)}     ${shortenHomePath(summary.moduleResolutionPath)}`);
  renderer?.line(`${paint('Run dir', 'dim', color)}     ${shortenHomePath(summary.runDir)}`);
  if (summary.next.length > 0) {
    renderer?.line('');
    renderer?.line(`${paint('Next', 'dim', color)}        ${summary.next[0].command}  ${summary.next[0].description}`);
    for (const action of summary.next.slice(1)) {
      renderer?.line(`            ${action.command}  ${action.description}`);
    }
  }
  renderer?.line('');
}

function singleLineProgress(input: string): string {
  const clean = String(input).replace(/\s+/g, ' ').trim();
  const cols = process.stdout.columns ?? 80;
  const max = Math.max(30, cols - 22);
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}

export function findRunDirById(runId: string, runOutputDir: string): string {
  const p = path.join(runOutputDir, runId);
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return p;
  const matches = fs.existsSync(runOutputDir)
    ? fs
        .readdirSync(runOutputDir)
        .filter((n) => n.includes(runId))
        .map((n) => path.join(runOutputDir, n))
    : [];
  if (matches.length === 1) return matches[0];
  throw new Error(`Run id not found or ambiguous: ${runId}`);
}

export function listRunDirs(limit: number, runOutputDir: string): string[] {
  if (!fs.existsSync(runOutputDir)) return [];
  return fs
    .readdirSync(runOutputDir)
    .map((n) => path.join(runOutputDir, n))
    .filter((p) => fs.statSync(p).isDirectory())
    .sort((a, b) => path.basename(b).localeCompare(path.basename(a)))
    .slice(0, limit);
}
