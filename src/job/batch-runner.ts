import { nowIso, sleep } from '../core/time.js';

type BatchRunStatus = 'PASS' | 'FAIL' | 'SKIPPED';

interface RunManyExecutionInput {
  batchId: string;
  batchIndex: number;
  batchCount: number;
  workerId: number;
}

interface RunManyExecutionOutput {
  runId: string;
  runDir: string;
}

interface RunManyItemResult extends RunManyExecutionInput {
  status: BatchRunStatus;
  durationMs: number;
  runId?: string;
  runDir?: string;
  error?: string;
}

interface RunManyProgress {
  total: number;
  completed: number;
  passed: number;
  failed: number;
  skipped: number;
  inFlight: number;
  interrupted: boolean;
  lastResult?: RunManyItemResult;
}

interface RunManyResult extends RunManyProgress {
  batchId: string;
  count: number;
  concurrency: number;
  staggerMs: number;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  overall: 'PASS' | 'FAIL';
  runs: RunManyItemResult[];
}

interface RunManyOptions {
  batchId: string;
  count: number;
  concurrency: number;
  staggerMs: number;
  signal?: AbortSignal;
  executeRun: (input: RunManyExecutionInput) => Promise<RunManyExecutionOutput>;
  onProgress?: (state: RunManyProgress) => void;
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function shortError(err: unknown): string {
  const firstLine = toErrorMessage(err).split('\n')[0].trim();
  if (firstLine.length <= 180) return firstLine;
  return `${firstLine.slice(0, 177)}...`;
}

function summaryField(err: unknown, key: 'runId' | 'runDir'): string | undefined {
  if (!err || typeof err !== 'object' || !('summary' in err)) return undefined;
  const { summary } = err as { summary?: unknown };
  if (!summary || typeof summary !== 'object' || !(key in summary)) return undefined;
  const value = summary[key as keyof typeof summary];
  return typeof value === 'string' ? value : undefined;
}

function assertPositiveInt(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be an integer > 0`);
  }
}

function assertNonNegativeInt(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be an integer >= 0`);
  }
}

export async function runJobCaseMany(opts: RunManyOptions): Promise<RunManyResult> {
  assertPositiveInt('count', opts.count);
  assertPositiveInt('concurrency', opts.concurrency);
  assertNonNegativeInt('staggerMs', opts.staggerMs);

  const workerCount = Math.min(opts.concurrency, opts.count);
  const startedAtMs = Date.now();
  const startedAt = nowIso();

  const results: Array<RunManyItemResult | undefined> = new Array(opts.count).fill(undefined);
  let nextIndex = 0;
  let completed = 0;
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let inFlight = 0;

  const emit = (lastResult?: RunManyItemResult) => {
    opts.onProgress?.({
      total: opts.count,
      completed,
      passed,
      failed,
      skipped,
      inFlight,
      interrupted: !!opts.signal?.aborted,
      lastResult,
    });
  };

  const worker = async (workerId: number) => {
    while (true) {
      if (opts.signal?.aborted) return;
      const current = nextIndex;
      nextIndex += 1;
      if (current >= opts.count) return;

      const batchIndex = current + 1;
      const base: RunManyExecutionInput = {
        batchId: opts.batchId,
        batchIndex,
        batchCount: opts.count,
        workerId,
      };

      const scheduledAt = startedAtMs + (batchIndex - 1) * opts.staggerMs;
      const waitMs = scheduledAt - Date.now();
      if (waitMs > 0) await sleep(waitMs);

      if (opts.signal?.aborted) {
        const skippedResult: RunManyItemResult = {
          ...base,
          status: 'SKIPPED',
          durationMs: 0,
          error: 'Interrupted before start',
        };
        results[current] = skippedResult;
        completed += 1;
        skipped += 1;
        emit(skippedResult);
        continue;
      }

      const runStart = Date.now();
      inFlight += 1;
      try {
        const out = await opts.executeRun(base);
        const successResult: RunManyItemResult = {
          ...base,
          status: 'PASS',
          durationMs: Date.now() - runStart,
          runId: out.runId,
          runDir: out.runDir,
        };
        results[current] = successResult;
        completed += 1;
        passed += 1;
        emit(successResult);
      } catch (err) {
        const failResult: RunManyItemResult = {
          ...base,
          status: 'FAIL',
          durationMs: Date.now() - runStart,
          runId: summaryField(err, 'runId'),
          runDir: summaryField(err, 'runDir'),
          error: shortError(err),
        };
        results[current] = failResult;
        completed += 1;
        failed += 1;
        emit(failResult);
      } finally {
        inFlight -= 1;
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, (_, i) => worker(i + 1)));

  // Mark any never-dispatched tasks as skipped when interrupted.
  if (opts.signal?.aborted) {
    for (let i = 0; i < results.length; i += 1) {
      if (results[i]) continue;
      const skippedResult: RunManyItemResult = {
        batchId: opts.batchId,
        batchIndex: i + 1,
        batchCount: opts.count,
        workerId: 0,
        status: 'SKIPPED',
        durationMs: 0,
        error: 'Interrupted before dispatch',
      };
      results[i] = skippedResult;
      completed += 1;
      skipped += 1;
      emit(skippedResult);
    }
  }

  const finalized = results.filter((x): x is RunManyItemResult => x !== undefined);
  const endedAt = nowIso();
  const durationMs = Date.now() - startedAtMs;
  const interrupted = !!opts.signal?.aborted;
  const overall: 'PASS' | 'FAIL' = !interrupted && failed === 0 && skipped === 0 ? 'PASS' : 'FAIL';

  return {
    batchId: opts.batchId,
    count: opts.count,
    concurrency: opts.concurrency,
    staggerMs: opts.staggerMs,
    startedAt,
    endedAt,
    durationMs,
    overall,
    total: opts.count,
    completed,
    passed,
    failed,
    skipped,
    inFlight: 0,
    interrupted,
    runs: finalized,
  };
}
