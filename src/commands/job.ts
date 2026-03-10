import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { isJsonObject } from '../core/json.js';
import { ROOT_DIR, RUN_OUTPUT_DIR } from '../data/paths.js';
import { JobRunExecutionError, executeJobCase, findRunDirById, listRunDirs } from '../job/runner.js';
import { runJobCaseMany } from '../job/batch-runner.js';
import { validateJobCase } from '../job/validator.js';
import { parseParams, resolveChecks, runAssertions, validateParamsForChecks } from '../job/assert.js';
import { nowIso, nowStamp, randomHex } from '../core/time.js';
import { loadModuleRegistry } from '../modules/index.js';
import { readJson, requireFile } from '../utils/fs-json.js';
import {
  cleanJson,
  createRenderer,
  formatBatchInspectHumanResult,
  formatJobAssertHumanResult,
  formatNextActionsHuman,
  isColorEnabled,
  paint,
  parseRunId,
  renderTableString,
  runIdToIso,
  shortenHomePath,
  userPathDisplay,
} from '../output/renderer.js';
import {
  buildDumpSummary,
  defaultRuntime,
  inferJobFileKind,
  listBundledCases,
  loadCallLog,
  loadCase,
  parseActivityLog,
  readJsonMaybe,
  resolveCasePath,
} from '../data/run-data.js';
import { renderReadableRequestsResponses } from '../job/readable-calls.js';
import { JobCaseSchema } from '../core/schema.js';
import { loadActionDefaults } from '../execution/action-defaults.js';
import { HttpPoolRegistry } from '../services/http-pool.js';
import { inspectBatchSummary, resolveBatchSummaryPath } from '../job/batch-inspect.js';
import {
  inspectEffectiveJobHttpConfig,
  inspectJobDependencies,
  resolveJobDependencies,
  summarizeDeclaredHttpDependencies,
  summarizeDeclaredMemoryDependencies,
  type DependencyIssue,
} from '../job/dependencies.js';
import { inspectJobCredentials } from '../job/credentials.js';
import { cliErrorFromCode, exitCodeForCliError, jsonErrorEnvelope } from '../core/errors.js';
import { nextActionsForJobAssert, nextActionsForJobRun, nextActionsForRunMany } from '../job/next-actions.js';

const MAX_PARALLEL_CONCURRENCY = 20;

type CliOpts = {
  json?: boolean;
  verbose?: boolean;
  color?: boolean;
};

type StepResolutionEntry = {
  stepId?: string;
  resolved?: {
    moduleName?: string;
    version?: string;
    layer?: string;
  } | null;
};

type RunSummaryRecord = {
  runId?: string;
  runDir?: string;
  jobType?: string;
  startedAt?: string;
  status?: string;
};

function parsePositiveInt(name: string, raw: unknown): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be an integer > 0`);
  return n;
}

function parseNonNegativeInt(name: string, raw: unknown): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be an integer >= 0`);
  return n;
}

function stripRunUniqSuffix(label: string): string {
  return label.replace(/-\d{3}[a-f0-9]{4}$/i, '');
}

function formatDependencyIssue(issue: DependencyIssue): string {
  if (issue.dependencyType === 'module') return issue.message;
  if (issue.dependencyType === 'http') {
    const location = issue.httpPath ? `http.${issue.httpPath}` : issue.message;
    return `${location}: ${issue.message}`;
  }
  const location = issue.namespace && issue.key ? `${issue.namespace}.${issue.key}` : issue.message;
  return issue.fill
    ? `${location}: ${issue.message} (fill: ${issue.fill.module}:${issue.fill.job})`
    : `${location}: ${issue.message}`;
}

function formatDeclaredMemoryDependency(input: {
  namespace: string;
  key: string;
  fill?: { module: string; job: string };
}): string {
  const location = `${input.namespace}.${input.key}`;
  return input.fill ? `${location} (seed: ${input.fill.module}:${input.fill.job})` : location;
}

function formatDeclaredHttpDependency(input: { path: string }): string {
  return `http.${input.path}`;
}

function formatCredentialIssue(issue: { path: string; message: string }): string {
  return issue.path ? `${issue.path}: ${issue.message}` : issue.message;
}

export function registerJobCommands(
  program: Command,
  deps: {
    cliVersion: string;
  },
): void {
  const job = program.command('job').description('Job orchestration');

  job
    .command('run')
    .description('Run a job case')
    .requiredOption('--case <path>')
    .option('--resolve-deps', 'Run fill jobs for missing memory dependencies before the main job', false)
    .action(async (cmd) => {
      const opts = program.opts<CliOpts>();
      const renderer = createRenderer({ json: !!opts.json, color: isColorEnabled(opts) });
      const casePath = resolveCasePath(cmd.case);
      const jc = loadCase(casePath);
      const { registry, warnings } = await loadModuleRegistry();
      const runtime = defaultRuntime(deps.cliVersion);
      const validation = validateJobCase(jc, registry, loadActionDefaults(), {
        jobKind: inferJobFileKind(casePath),
      });
      const credentialCheck = inspectJobCredentials(jc, registry, { requireEnv: true });
      if (!validation.valid) {
        const details = {
          casePath,
          issues: validation.issues,
          warnings: [...warnings, ...validation.warnings],
        };
        renderer.render({
          json: jsonErrorEnvelope(cliErrorFromCode('USAGE_ERROR', 'job case validation failed', details)),
          human: [
            `✗ Invalid ${userPathDisplay(String(cmd.case))}`,
            ...validation.issues.map((issue) => {
              const step = issue.stepId ? `[${issue.stepId}] ` : '';
              const p = issue.path ? `${issue.path}: ` : '';
              return `- ${step}${p}${issue.message}`;
            }),
          ],
        });
        process.exitCode = exitCodeForCliError(cliErrorFromCode('USAGE_ERROR', 'job case validation failed'));
        return;
      }
      if (!credentialCheck.valid) {
        const details = {
          casePath,
          issues: credentialCheck.issues,
          warnings: [...warnings, ...validation.warnings],
        };
        renderer.render({
          json: jsonErrorEnvelope(cliErrorFromCode('USAGE_ERROR', 'job credential preflight failed', details)),
          human: [
            `✗ Missing credentials for ${userPathDisplay(String(cmd.case))}`,
            ...credentialCheck.issues.map((issue) => `- [${issue.stepId}] ${formatCredentialIssue(issue)}`),
          ],
        });
        process.exitCode = exitCodeForCliError(cliErrorFromCode('USAGE_ERROR', 'job credential preflight failed'));
        return;
      }

      const httpConfigCheck = inspectEffectiveJobHttpConfig(jc, runtime);
      if (!httpConfigCheck.valid) {
        const details = {
          casePath,
          issues: httpConfigCheck.issues,
          warnings: [...warnings, ...validation.warnings],
        };
        renderer.render({
          json: jsonErrorEnvelope(cliErrorFromCode('USAGE_ERROR', 'job dependency preflight failed', details)),
          human: [
            `✗ Missing prerequisites for ${userPathDisplay(String(cmd.case))}`,
            ...httpConfigCheck.issues.map((issue) => `- ${formatDependencyIssue(issue)}`),
          ],
        });
        process.exitCode = exitCodeForCliError(cliErrorFromCode('USAGE_ERROR', 'job dependency preflight failed'));
        return;
      }

      let dependencyCheck = inspectJobDependencies(jc, {
        registry,
        configDir: runtime.configDir,
        effectiveHttp: httpConfigCheck.effectiveHttp,
      });
      if (cmd.resolveDeps && !dependencyCheck.valid) {
        dependencyCheck = await resolveJobDependencies(jc, {
          registry,
          configDir: runtime.configDir,
          cliVersion: deps.cliVersion,
        });
      }
      if (!dependencyCheck.valid) {
        const details = {
          casePath,
          issues: dependencyCheck.issues,
          warnings: [...warnings, ...validation.warnings],
        };
        renderer.render({
          json: jsonErrorEnvelope(
            cliErrorFromCode('USAGE_ERROR', 'job dependency preflight failed', details),
            dependencyCheck.next,
          ),
          human: [
            `✗ Missing prerequisites for ${userPathDisplay(String(cmd.case))}`,
            ...dependencyCheck.issues.map((issue) => `- ${formatDependencyIssue(issue)}`),
            ...formatNextActionsHuman(dependencyCheck.next, { color: isColorEnabled(opts) }),
          ],
        });
        process.exitCode = exitCodeForCliError(cliErrorFromCode('USAGE_ERROR', 'job dependency preflight failed'));
        return;
      }

      try {
        const summary = await executeJobCase(jc, {
          json: !!opts.json,
          label: 'job-run',
          cliVersion: deps.cliVersion,
          verbose: !!opts.verbose,
          color: isColorEnabled(opts),
          renderer,
        });
        const next = nextActionsForJobRun({
          status: summary.status,
          runId: summary.runId,
          failedStepIndex: summary.failedStepIndex,
        });
        if (!!opts.json) renderer.jsonOut({ ...summary, next });
      } catch (err) {
        if (!(err instanceof JobRunExecutionError)) throw err;
        const next = nextActionsForJobRun({
          status: err.summary.status,
          runId: err.summary.runId,
          failedStepIndex: err.summary.failedStepIndex,
        });
        if (!!opts.json) {
          renderer.jsonOut(
            jsonErrorEnvelope(cliErrorFromCode('RUNTIME_ERROR', 'job run failed', { result: err.summary }), next),
          );
        }
        process.exitCode = exitCodeForCliError(cliErrorFromCode('RUNTIME_ERROR', 'job run failed'));
      }
    });

  job
    .command('run-many')
    .description('Run the same job case multiple times in parallel')
    .requiredOption('--case <path>', 'Job case path')
    .requiredOption('--count <n>', 'Number of runs')
    .option('--concurrency <n>', 'Parallel workers (default 5, max 20)', '5')
    .option('--stagger-ms <n>', 'Delay between launching each run in milliseconds', '0')
    .option('--out <path>', 'Output path for batch summary JSON')
    .action(async (cmd) => {
      const opts = program.opts<CliOpts>();
      const color = isColorEnabled(opts);
      const renderer = createRenderer({ json: !!opts.json, color });
      const count = parsePositiveInt('count', cmd.count);
      let concurrency = parsePositiveInt('concurrency', cmd.concurrency);
      const staggerMs = parseNonNegativeInt('stagger-ms', cmd.staggerMs);
      if (concurrency > MAX_PARALLEL_CONCURRENCY) {
        throw new Error(
          `--concurrency cannot exceed ${MAX_PARALLEL_CONCURRENCY}. ` +
            `Use --concurrency <= ${MAX_PARALLEL_CONCURRENCY} and increase --count for larger batches.`,
        );
      }
      concurrency = Math.min(concurrency, count);

      const casePath = resolveCasePath(cmd.case);
      const jc = loadCase(casePath);
      const { registry, warnings } = await loadModuleRegistry();
      const runtime = defaultRuntime(deps.cliVersion);
      const validation = validateJobCase(jc, registry, loadActionDefaults(), {
        jobKind: inferJobFileKind(casePath),
      });
      const credentialCheck = inspectJobCredentials(jc, registry, { requireEnv: true });
      if (!validation.valid) {
        const first = validation.issues[0];
        throw new Error(
          `Validation failed for ${userPathDisplay(cmd.case)}: ` +
            `${first.path ? `${first.path}: ` : ''}${first.message}`,
        );
      }
      if (!credentialCheck.valid) {
        const first = credentialCheck.issues[0];
        throw new Error(
          `Credential preflight failed for ${userPathDisplay(cmd.case)}: ` +
            `${first.path ? `${first.path}: ` : ''}${first.message}`,
        );
      }
      const httpConfigCheck = inspectEffectiveJobHttpConfig(jc, runtime);
      if (!httpConfigCheck.valid) {
        const first = httpConfigCheck.issues[0];
        throw new Error(
          `Dependency preflight failed for ${userPathDisplay(cmd.case)}: ` +
            `${first.httpPath ? `http.${first.httpPath}: ` : ''}${first.message}`,
        );
      }
      const dependencyCheck = inspectJobDependencies(jc, {
        registry,
        configDir: runtime.configDir,
        effectiveHttp: httpConfigCheck.effectiveHttp,
      });
      if (!dependencyCheck.valid) {
        const first = dependencyCheck.issues[0];
        throw new Error(`Dependency preflight failed for ${userPathDisplay(cmd.case)}: ${formatDependencyIssue(first)}`);
      }

      const batchId = `${nowStamp()}-job-batch-${randomHex(4)}`;
      const startedAt = nowIso();
      const controller = new AbortController();
      const poolRegistry = new HttpPoolRegistry({ connections: MAX_PARALLEL_CONCURRENCY });

      const onSigint = () => {
        if (controller.signal.aborted) return;
        controller.abort();
        if (!opts.json) renderer.progress('\nInterrupted: stopping new runs, waiting for in-flight runs...\n');
      };
      process.once('SIGINT', onSigint);

      let timer: NodeJS.Timeout | null = null;
      const progress = {
        completed: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        inFlight: 0,
      };
      const renderProgress = () => {
        if (!!opts.json || !process.stderr.isTTY) return;
        renderer.progress(
          `\r\x1B[2KProgress ${progress.completed}/${count} ` +
            `(pass=${progress.passed} fail=${progress.failed} skip=${progress.skipped} inFlight=${progress.inFlight})`,
        );
      };
      const stopProgress = () => {
        if (timer) clearInterval(timer);
        timer = null;
        if (!opts.json && process.stderr.isTTY) renderer.clearProgress();
      };

      if (!opts.json) {
        renderer.render({
          json: null,
          human: [
            '',
            `Batch:       ${batchId}`,
            `Case:        ${userPathDisplay(casePath)}`,
            `Count:       ${count}`,
            `Concurrency: ${concurrency}`,
            `Stagger:     ${staggerMs}ms`,
            ...warnings.map((w) => paint(`! module warning: ${w}`, 'warning', color)),
            '',
          ],
        });
        if (process.stderr.isTTY) {
          timer = setInterval(renderProgress, 150);
          renderProgress();
        }
      }

      try {
        const result = await runJobCaseMany({
          batchId,
          count,
          concurrency,
          staggerMs,
          signal: controller.signal,
          onProgress: (state) => {
            progress.completed = state.completed;
            progress.passed = state.passed;
            progress.failed = state.failed;
            progress.skipped = state.skipped;
            progress.inFlight = state.inFlight;
          },
          executeRun: async (input) => {
            const idx = String(input.batchIndex).padStart(3, '0');
            const summary = await executeJobCase(jc, {
              json: true,
              label: `job-run-${batchId}-${idx}`,
              cliVersion: deps.cliVersion,
              verbose: !!opts.verbose,
              color: false,
              poolRegistry,
              runtimeOverrides: {
                batchId: input.batchId,
                batchIndex: input.batchIndex,
                batchCount: input.batchCount,
                workerId: input.workerId,
              },
              renderer,
            });
            return {
              runId: summary.runId,
              runDir: summary.runDir,
            };
          },
        });

        stopProgress();
        const summaryPath = cmd.out
          ? path.resolve(String(cmd.out))
          : path.join(RUN_OUTPUT_DIR, `${batchId}.summary.json`);
        fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
        const firstFailedRunId = result.runs.find((r) => r.status === 'FAIL' && r.runId)?.runId;
        const next = nextActionsForRunMany({
          overall: result.overall,
          batchId,
          firstFailedRunId,
        });
        const batchSummary = {
          ...result,
          casePath,
          startedAt,
          summaryPath,
          next,
        };
        fs.writeFileSync(summaryPath, `${JSON.stringify(cleanJson(batchSummary) ?? {}, null, 2)}\n`, 'utf8');

        if (!!opts.json) {
          if (result.overall === 'FAIL') {
            renderer.jsonOut(
              jsonErrorEnvelope(
                cliErrorFromCode('RUNTIME_ERROR', 'job run-many completed with failures', {
                  result: {
                    ...batchSummary,
                    next: undefined,
                  },
                }),
                next,
              ),
            );
          } else {
            renderer.jsonOut(batchSummary);
          }
        } else {
          const rank = (status: string) => (status === 'FAIL' ? 0 : status === 'SKIPPED' ? 1 : 2);
          const rows = [...result.runs]
            .sort((a, b) => rank(a.status) - rank(b.status) || a.batchIndex - b.batchIndex)
            .map((r) => {
              return [
                String(r.batchIndex),
                r.runId ?? '-',
                r.status,
                `${(r.durationMs / 1000).toFixed(2)}s`,
                r.error ?? '',
              ];
            });
          const overallTone = result.overall === 'PASS' ? 'success' : 'error';
          renderer.render({
            json: null,
            human: [
              renderTableString(['#', 'Run ID', 'Status', 'Duration', 'Error'], rows, {
                flexColumn: 4,
                minFlexWidth: 12,
              }),
              '',
              paint(
                `${result.overall} passed=${result.passed} failed=${result.failed} skipped=${result.skipped} total=${result.total} duration=${(result.durationMs / 1000).toFixed(2)}s`,
                overallTone,
                color,
              ),
              `Summary: ${shortenHomePath(summaryPath)}`,
              ...formatNextActionsHuman(next, { color }),
            ],
          });
        }

        if (result.overall === 'FAIL') {
          process.exitCode = exitCodeForCliError(
            cliErrorFromCode('RUNTIME_ERROR', 'job run-many completed with failures'),
          );
        }
      } finally {
        await poolRegistry.closeAll();
        stopProgress();
        process.off('SIGINT', onSigint);
      }
    });

  job
    .command('batch-inspect')
    .description('Analyze run-many batch summary and timing bottlenecks')
    .requiredOption('--batch-id <id>', 'Batch id, "latest", or summary file path', 'latest')
    .option('--top <n>', 'Top rows to show for actions/slow runs', '5')
    .action((cmd) => {
      const opts = program.opts<CliOpts>();
      const color = isColorEnabled(opts);
      const renderer = createRenderer({ json: !!opts.json, color });
      const topN = parsePositiveInt('top', cmd.top);
      const summaryPath = resolveBatchSummaryPath(String(cmd.batchId || 'latest'), RUN_OUTPUT_DIR);
      const out = inspectBatchSummary(summaryPath, { topN });
      const hints: string[] = [];
      if (out.concurrency > 1 && out.overlap.maxConcurrentCalls <= 1) {
        hints.push('Calls look serialized (max overlap=1). Check transport/client sync bottlenecks.');
      }
      if (out.runIdle.avgMs > out.runDuration.avgMs * 0.4) {
        hints.push('Average idle time is high. Poll intervals or waits are likely dominating run time.');
      }
      const payload = { ...out, hints };
      renderer.render({
        json: payload,
        human: [
          ...formatBatchInspectHumanResult(out, { color, topN }),
          ...hints.map((hint) => paint(`! ${hint}`, 'warning', color)),
        ],
      });
    });

  job
    .command('cases')
    .description('List bundled job cases')
    .action(() => {
      const opts = program.opts<CliOpts>();
      const renderer = createRenderer({ json: !!opts.json });
      const cases = listBundledCases();
      const out = {
        root: path.join(ROOT_DIR, 'jobs'),
        cases: cases.map((p) => path.relative(ROOT_DIR, p)),
      };
      renderer.render({ json: out, human: out.cases });
    });

  job
    .command('replay')
    .description('Replay a previous run by runId')
    .requiredOption('--run-id <id>')
    .action(async (cmd) => {
      const opts = program.opts<CliOpts>();
      const renderer = createRenderer({ json: !!opts.json, color: isColorEnabled(opts) });
      const runDir = findRunDirById(cmd.runId, RUN_OUTPUT_DIR);
      const casePath = fs.existsSync(path.join(runDir, 'job.case.input.json'))
        ? path.join(runDir, 'job.case.input.json')
        : path.join(runDir, 'job.case.resolved.json');
      const jc = loadCase(casePath);
      await executeJobCase(jc, {
        json: !!opts.json,
        label: 'job-replay',
        cliVersion: deps.cliVersion,
        verbose: !!opts.verbose,
        color: isColorEnabled(opts),
        renderer,
      });
    });

  job
    .command('latest')
    .description('Show latest run summary')
    .action(async () => {
      const opts = program.opts<CliOpts>();
      const renderer = createRenderer({ json: !!opts.json });
      const dirs = listRunDirs(200, RUN_OUTPUT_DIR);
      const withSummary = dirs.map((d) => ({ d, s: path.join(d, 'summary.json') })).find((x) => fs.existsSync(x.s));
      if (!withSummary) throw new Error('No run summary found');
      const summary = readJson<RunSummaryRecord>(withSummary.s);
      renderer.render({
        json: summary,
        human: [`Run:      ${summary.runId ?? 'N/A'}`, `Run dir:  ${shortenHomePath(summary.runDir ?? '')}`],
      });
    });

  job
    .command('list')
    .description('List recent runs')
    .option('--limit <n>', 'Limit', '20')
    .action(async (cmd) => {
      const opts = program.opts<CliOpts>();
      const renderer = createRenderer({ json: !!opts.json, color: isColorEnabled(opts) });
      const limit = Number(cmd.limit || '20');
      const list = listRunDirs(limit, RUN_OUTPUT_DIR).map((d) => {
        const s = path.join(d, 'summary.json');
        const m = path.join(d, 'meta.json');
        const summary = fs.existsSync(s) ? readJson<RunSummaryRecord>(s) : {};
        const meta = readJsonMaybe(m);
        const runId = summary.runId ?? path.basename(d);
        const parsed = parseRunId(runId);
        return {
          runId,
          jobType: summary.jobType ?? stripRunUniqSuffix(parsed.label),
          startedAt: (isJsonObject(meta) ? meta.startedAt : undefined) ?? summary.startedAt ?? runIdToIso(runId),
          status: summary.status,
          runDir: d,
        };
      });
      renderer.render({
        json: list,
        human: renderTableString(
          ['When', 'Job', 'Run ID'],
          list.map((x) => {
            const runId = x.runId ?? path.basename(x.runDir);
            const parsed = parseRunId(runId);
            return [parsed.timestamp, String(x.jobType ?? parsed.label), runId];
          }),
          { flexColumn: 1, minFlexWidth: 12 },
        ),
      });
    });

  job
    .command('inspect')
    .description('Inspect run failure diagnostics')
    .requiredOption('--run-id <id>', 'Run id or "latest"', 'latest')
    .option('--step <n>', 'Prefer diagnostics for a specific 1-based step index')
    .option('--show-curl', 'Include curl replay command', false)
    .action(async (cmd) => {
      const opts = program.opts<CliOpts>();
      const renderer = createRenderer({ json: !!opts.json });
      const resolvedRunId = String(cmd.runId || 'latest');
      const runDir =
        resolvedRunId === 'latest' ? listRunDirs(1, RUN_OUTPUT_DIR)[0] : findRunDirById(resolvedRunId, RUN_OUTPUT_DIR);
      if (!runDir) throw new Error('No run found');

      const runId = path.basename(runDir);
      const summaryPath = path.join(runDir, 'summary.json');
      const summary = fs.existsSync(summaryPath) ? readJson(summaryPath) : null;
      const moduleResolutionPath = path.join(runDir, 'module_resolution.json');
      const moduleResolution = readJsonMaybe(moduleResolutionPath);
      const calls = loadCallLog(runDir);
      const failedCalls = calls.filter((c) => Number(c.httpCode) < 200 || Number(c.httpCode) > 299);
      const requestedStepIndex = cmd.step ? Number(cmd.step) : undefined;
      const requestedStepOffset =
        typeof requestedStepIndex === 'number' && Number.isInteger(requestedStepIndex) && requestedStepIndex > 0
          ? requestedStepIndex - 1
          : null;
      const requestedStep =
        requestedStepOffset !== null
          ? ((isJsonObject(moduleResolution)
              ? (moduleResolution.steps as StepResolutionEntry[] | undefined)
              : undefined)?.[requestedStepOffset] ?? null)
          : null;
      const filteredFailedCalls = requestedStep?.stepId
        ? failedCalls.filter((c) => String(c.name || '').replace(/_poll_\d+$/, '') === requestedStep.stepId)
        : failedCalls;
      const failed =
        filteredFailedCalls.length > 0
          ? filteredFailedCalls[filteredFailedCalls.length - 1]
          : (failedCalls[failedCalls.length - 1] ?? null);
      const request = failed ? readJsonMaybe(failed.requestFile) : null;
      const response = failed ? readJsonMaybe(failed.responseFile) : null;

      const stepName = failed?.name ? String(failed.name).replace(/_poll_\d+$/, '') : null;
      const stepResolution = stepName
        ? ((moduleResolution as { steps?: StepResolutionEntry[] } | null | undefined)?.steps?.find(
            (s) => s.stepId === stepName,
          ) ?? null)
        : null;

      const failure = failed
        ? {
            idx: failed.idx,
            name: failed.name,
            method: failed.method,
            url: failed.url,
            httpCode: Number(failed.httpCode),
            uuid: isJsonObject(response) ? (response.uuid ?? null) : null,
            request,
            response,
            requestFile: failed.requestFile,
            responseFile: failed.responseFile,
            curl: failed.curl,
            actionProvider: stepResolution?.resolved ?? null,
          }
        : null;

      const out = {
        runId,
        runDir,
        summary,
        moduleResolution,
        totalCalls: calls.length,
        failedCallCount: failedCalls.length,
        lastFailure: failure,
      };

      renderer.render({
        json: out,
        human: failure
          ? [
              `Run:      ${runId}`,
              `Run dir:  ${shortenHomePath(runDir)}`,
              `Calls:    ${calls.length}`,
              '',
              'Last Failure',
              `- step:     ${failure.name}`,
              ...(failure.actionProvider
                ? [
                    `- module:   ${failure.actionProvider.moduleName}@${failure.actionProvider.version} (${failure.actionProvider.layer})`,
                  ]
                : []),
              `- http:     ${failure.httpCode}`,
              `- request:  ${failure.method} ${failure.url}`,
              ...(failure.uuid ? [`- uuid:     ${failure.uuid}`] : []),
              `- body:     ${JSON.stringify(failure.request)}`,
              `- response: ${JSON.stringify(failure.response)}`,
              ...(cmd.showCurl ? [`- curl:     ${failure.curl}`] : []),
            ]
          : [
              `Run:      ${runId}`,
              `Run dir:  ${shortenHomePath(runDir)}`,
              `Calls:    ${calls.length}`,
              '',
              'No failing HTTP calls recorded.',
            ],
      });
    });

  job
    .command('dump')
    .description('Dump full run payload as JSON')
    .requiredOption('--run-id <id>', 'Run id or "latest"', 'latest')
    .option('--out <path>', 'Write JSON output to file')
    .action(async (cmd) => {
      const opts = program.opts<CliOpts>();
      const renderer = createRenderer({ json: !!opts.json, color: isColorEnabled(opts) });
      const resolvedRunId = String(cmd.runId || 'latest');
      const runDir =
        resolvedRunId === 'latest' ? listRunDirs(1, RUN_OUTPUT_DIR)[0] : findRunDirById(resolvedRunId, RUN_OUTPUT_DIR);
      if (!runDir) throw new Error('No run found');

      const runId = path.basename(runDir);
      const summaryPath = path.join(runDir, 'summary.json');
      const metaPath = path.join(runDir, 'meta.json');
      const moduleResolutionPath = path.join(runDir, 'module_resolution.json');
      const calls = loadCallLog(runDir).map((c) => ({
        ...c,
        request: readJsonMaybe(c.requestFile),
        response: readJsonMaybe(c.responseFile),
      }));
      const meta = readJsonMaybe(metaPath);

      const summary =
        readJsonMaybe(summaryPath) ??
        buildDumpSummary({
          cliVersion: isJsonObject(meta) ? String(meta.cliVersion ?? '') : undefined,
          runId,
          runDir,
        });
      const summaryForDump =
        summary && typeof summary === 'object' ? { ...summary, runId: undefined, runDir: undefined } : summary;

      const payload = {
        runId,
        runDir,
        status: calls.some((c) => Number(c.httpCode) < 200 || Number(c.httpCode) > 299) ? 'failed' : 'success',
        summary: summaryForDump,
        meta,
        moduleResolution: readJsonMaybe(moduleResolutionPath),
        activityLog: parseActivityLog(path.join(runDir, 'activity.log')),
        calls,
      };

      const json = JSON.stringify(cleanJson(payload) ?? {}, null, 2);
      if (cmd.out) {
        const outPath = path.resolve(String(cmd.out));
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, `${json}\n`, 'utf8');
        if (!opts.json) {
          renderer.render({
            json: null,
            human: paint(`✓ Wrote ${shortenHomePath(outPath)}`, 'success', isColorEnabled(opts)),
          });
        }
        return;
      }
      renderer.render({ json: payload, human: json });
    });

  job
    .command('readable')
    .description('Export readable text with all curl calls, requests and responses')
    .requiredOption('--run-id <id>', 'Run id or "latest"', 'latest')
    .option('--out <path>', 'Write txt output to file (default: <runDir>/readable-requests-responses.txt)')
    .action((cmd) => {
      const opts = program.opts();
      const renderer = createRenderer({ json: !!opts.json, color: isColorEnabled(opts) });
      const resolvedRunId = String(cmd.runId || 'latest');
      const runDir =
        resolvedRunId === 'latest' ? listRunDirs(1, RUN_OUTPUT_DIR)[0] : findRunDirById(resolvedRunId, RUN_OUTPUT_DIR);
      if (!runDir) throw new Error('No run found');

      const runId = path.basename(runDir);
      const calls = loadCallLog(runDir).map((c) => ({
        ...c,
        request: readJsonMaybe(c.requestFile),
        response: readJsonMaybe(c.responseFile),
      }));
      const text = renderReadableRequestsResponses(runId, calls);
      const outPath = cmd.out ? path.resolve(String(cmd.out)) : path.join(runDir, 'readable-requests-responses.txt');
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, text, 'utf8');

      renderer.render({
        json: { runId, runDir, out: outPath, calls: calls.length },
        human: paint(`✓ Wrote ${shortenHomePath(outPath)}`, 'success', isColorEnabled(opts)),
      });
    });

  job
    .command('assert')
    .description('Run deterministic assertions against a finished run artifact')
    .requiredOption('--run-id <id>', 'Run id or "latest"', 'latest')
    .option('--check <name>', 'Assertion check name (repeatable)', (v, prev: string[] = []) => [...prev, String(v)], [])
    .option(
      '--param <key=value>',
      'Assertion parameter (repeatable)',
      (v, prev: string[] = []) => [...prev, String(v)],
      [],
    )
    .option('--strict-params', 'Fail when params are not used by selected checks', false)
    .action(async (cmd) => {
      const opts = program.opts();
      const renderer = createRenderer({ json: !!opts.json, color: isColorEnabled(opts) });
      const resolvedRunId = String(cmd.runId || 'latest');
      const runDir =
        resolvedRunId === 'latest' ? listRunDirs(1, RUN_OUTPUT_DIR)[0] : findRunDirById(resolvedRunId, RUN_OUTPUT_DIR);
      if (!runDir) throw new Error('No run found');
      const runId = path.basename(runDir);

      const checks = resolveChecks(cmd.check ?? []);
      const params = parseParams(cmd.param ?? []);
      validateParamsForChecks(checks, params, !!cmd.strictParams);
      const result = runAssertions({ runId, runDir, checks, params });
      const next = nextActionsForJobAssert({ overall: result.overall, runId });
      const resultWithNext = { ...result, next };
      renderer.render({
        json: resultWithNext,
        human: [
          ...formatJobAssertHumanResult(result, { verbose: !!opts.verbose, color: isColorEnabled(opts) }),
          ...formatNextActionsHuman(next, { color: isColorEnabled(opts) }),
        ],
      });
      if (result.overall === 'FAIL') {
        process.exitCode = 1;
      }
    });

  job
    .command('export')
    .description('Export case from previous run')
    .requiredOption('--run-id <id>')
    .requiredOption('--out <path>')
    .action(async (cmd) => {
      const opts = program.opts();
      const renderer = createRenderer({ json: !!opts.json });
      const runDir = findRunDirById(cmd.runId, RUN_OUTPUT_DIR);
      const outPath = path.resolve(cmd.out);
      const toExport = fs.existsSync(path.join(runDir, 'job.case.input.json'))
        ? path.join(runDir, 'job.case.input.json')
        : path.join(runDir, 'job.case.resolved.json');
      fs.copyFileSync(toExport, outPath);
      renderer.render({
        json: { exported: outPath, source: toExport },
        human: `✓ Exported to ${shortenHomePath(outPath)}`,
      });
    });

  job
    .command('import')
    .description('Import shared job case into jobs/imported')
    .requiredOption('--file <path>')
    .action(async (cmd) => {
      const opts = program.opts();
      const renderer = createRenderer({ json: !!opts.json });
      const src = path.resolve(cmd.file);
      requireFile(src, 'import file');
      const importedDir = path.join(ROOT_DIR, 'jobs', 'imported');
      fs.mkdirSync(importedDir, { recursive: true });
      const dst = path.join(importedDir, `${nowStamp()}-${path.basename(src)}`);
      fs.copyFileSync(src, dst);
      renderer.render({ json: { imported: dst }, human: `✓ Imported case to ${shortenHomePath(dst)}` });
    });

  job
    .command('validate')
    .description('Validate job schema and module-resolved actions')
    .requiredOption('--case <path>')
    .action(async (cmd) => {
      const opts = program.opts();
      const renderer = createRenderer({ json: !!opts.json });
      const casePath = resolveCasePath(cmd.case);
      const raw = readJson(casePath);
      const parsed = JobCaseSchema.safeParse(raw);
      const { registry, warnings } = await loadModuleRegistry();
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => ({
          code: 'SCHEMA_ERROR',
          path: i.path.join('.'),
          message: i.message,
        }));
        if (!!opts.json) {
          const details = { casePath, issues, warnings };
          renderer.jsonOut(
            jsonErrorEnvelope(cliErrorFromCode('USAGE_ERROR', 'job case schema validation failed', details)),
          );
        } else {
          renderer.render({
            json: null,
            human: [
              `✗ Invalid ${userPathDisplay(String(cmd.case))}`,
              ...issues.map((issue) => `- ${issue.path || '<root>'}: ${issue.message}`),
            ],
          });
        }
        process.exitCode = exitCodeForCliError(cliErrorFromCode('USAGE_ERROR', 'job case schema validation failed'));
        return;
      }

      const result = validateJobCase(parsed.data, registry, loadActionDefaults(), {
        jobKind: inferJobFileKind(casePath),
      });
      const credentialCheck = inspectJobCredentials(parsed.data, registry);
      const httpConfigCheck = inspectEffectiveJobHttpConfig(parsed.data, defaultRuntime(deps.cliVersion));
      const dependencyCheck = inspectJobDependencies(parsed.data, {
        registry,
        configDir: defaultRuntime(deps.cliVersion).configDir,
        effectiveHttp: httpConfigCheck.effectiveHttp,
      });
      const dependencyIssuesForOutput = httpConfigCheck.valid
        ? dependencyCheck.issues
        : dependencyCheck.issues.filter((issue) => issue.dependencyType !== 'http');
      const declaredHttpDeps = summarizeDeclaredHttpDependencies(parsed.data);
      const declaredMemoryDeps = summarizeDeclaredMemoryDependencies(parsed.data);
      const valid = result.valid && credentialCheck.valid && httpConfigCheck.valid && dependencyCheck.valid;
      if (!!opts.json) {
        if (valid) {
          renderer.jsonOut({ valid: true, casePath, warnings: [...warnings, ...result.warnings] });
        } else {
          renderer.jsonOut(
            jsonErrorEnvelope(
              cliErrorFromCode('USAGE_ERROR', 'job case validation failed', {
                casePath,
                issues: result.issues,
                credentialIssues: credentialCheck.issues,
                dependencyIssues: [...httpConfigCheck.issues, ...dependencyIssuesForOutput],
                warnings: [...warnings, ...result.warnings],
              }),
              dependencyCheck.next,
            ),
          );
        }
      } else if (valid) {
        renderer.render({
          json: null,
          human: [
            `✓ Valid ${userPathDisplay(String(cmd.case))}`,
            ...(declaredMemoryDeps.length > 0
              ? [
                  `! Memory deps:`,
                  ...declaredMemoryDeps.map((dep) => `  - ${formatDeclaredMemoryDependency(dep)}`),
                ]
              : []),
            ...(declaredHttpDeps.length > 0
              ? [`! HTTP deps:`, ...declaredHttpDeps.map((dep) => `  - ${formatDeclaredHttpDependency(dep)}`)]
              : []),
            ...[...warnings, ...result.warnings].map((w) => `! ${w}`),
          ],
        });
      } else {
        renderer.render({
          json: null,
          human: [
            `✗ Invalid ${userPathDisplay(String(cmd.case))}`,
            ...result.issues.map((issue) => {
              const step = issue.stepId ? `[${issue.stepId}] ` : '';
              const p = issue.path ? `${issue.path}: ` : '';
              return `- ${step}${p}${issue.message}`;
            }),
            ...credentialCheck.issues.map((issue) => `- [${issue.stepId}] ${formatCredentialIssue(issue)}`),
            ...httpConfigCheck.issues.map((issue) => `- ${formatDependencyIssue(issue)}`),
            ...dependencyIssuesForOutput.map((issue) => `- ${formatDependencyIssue(issue)}`),
            ...formatNextActionsHuman(dependencyCheck.next, { color: isColorEnabled(opts) }),
          ],
        });
      }
      if (!valid) {
        process.exitCode = exitCodeForCliError(cliErrorFromCode('USAGE_ERROR', 'job case validation failed'));
      }
    });
}
