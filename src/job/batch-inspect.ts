import fs from 'node:fs';
import path from 'node:path';
import { readJson } from '../utils/fs-json.js';
import { loadCallLog } from '../data/run-data.js';

interface BatchInspectOptions {
  topN?: number;
}

interface BatchRunEntry {
  batchIndex: number;
  status: 'PASS' | 'FAIL' | 'SKIPPED';
  durationMs: number;
  runId?: string;
  runDir?: string;
  error?: string;
}

interface BatchSummaryFile {
  batchId: string;
  casePath?: string;
  count: number;
  concurrency: number;
  staggerMs: number;
  durationMs: number;
  overall: 'PASS' | 'FAIL';
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  interrupted?: boolean;
  runs: BatchRunEntry[];
}

type CallTimingStat = {
  name: string;
  calls: number;
  attempts: number;
  totalMs: number;
  avgMs: number;
  maxMs: number;
};

interface BatchInspectResult {
  batchId: string;
  summaryPath: string;
  casePath?: string;
  count: number;
  concurrency: number;
  staggerMs: number;
  totalDurationMs: number;
  overall: 'PASS' | 'FAIL';
  passed: number;
  failed: number;
  skipped: number;
  interrupted: boolean;
  runDuration: {
    minMs: number;
    avgMs: number;
    p50Ms: number;
    p95Ms: number;
    maxMs: number;
  };
  callTotals: {
    calls: number;
    totalMs: number;
    avgMs: number;
  };
  overlap: {
    maxConcurrentCalls: number;
  };
  runIdle: {
    avgMs: number;
    p95Ms: number;
    maxMs: number;
  };
  actionTimings: CallTimingStat[];
  slowRuns: Array<{
    batchIndex: number;
    runId?: string;
    status: string;
    durationMs: number;
    callMs: number;
    idleMs: number;
    error?: string;
  }>;
}

function listBatchSummaryFiles(runOutputDir: string): string[] {
  if (!fs.existsSync(runOutputDir)) return [];
  return fs
    .readdirSync(runOutputDir)
    .filter((name) => name.endsWith('.summary.json') && name.includes('-job-batch-'))
    .map((name) => path.join(runOutputDir, name))
    .sort((a, b) => path.basename(b).localeCompare(path.basename(a)));
}

export function resolveBatchSummaryPath(input: string, runOutputDir: string): string {
  const raw = String(input || '').trim();
  if (!raw || raw === 'latest') {
    const latest = listBatchSummaryFiles(runOutputDir)[0];
    if (!latest) throw new Error('No batch summary found');
    return latest;
  }

  if (path.isAbsolute(raw) && fs.existsSync(raw) && fs.statSync(raw).isFile()) return raw;

  const direct = path.resolve(raw);
  if (fs.existsSync(direct) && fs.statSync(direct).isFile()) return direct;

  const byBatchId = path.join(runOutputDir, raw.endsWith('.summary.json') ? raw : `${raw}.summary.json`);
  if (fs.existsSync(byBatchId) && fs.statSync(byBatchId).isFile()) return byBatchId;

  const matches = listBatchSummaryFiles(runOutputDir).filter((p) => path.basename(p).includes(raw));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new Error(`Batch id is ambiguous: ${raw}`);
  throw new Error(`Batch summary not found: ${raw}`);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function normalizeCallName(name: string): string {
  return name.replace(/_attempt_\d+$/, '').replace(/_poll_\d+$/, '');
}

function parseIsoMs(v: string | undefined): number {
  if (!v) return 0;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : 0;
}

export function inspectBatchSummary(summaryPath: string, opts: BatchInspectOptions = {}): BatchInspectResult {
  const topN = Number.isInteger(opts.topN) && (opts.topN as number) > 0 ? (opts.topN as number) : 5;
  const summary = readJson<BatchSummaryFile>(summaryPath);
  if (!summary || !Array.isArray(summary.runs)) {
    throw new Error(`Invalid batch summary shape: ${summaryPath}`);
  }

  const actionMap = new Map<string, { totalMs: number; calls: number; maxMs: number; attempts: number }>();
  const intervals: Array<{ t: number; d: number }> = [];
  let callCount = 0;
  let totalCallMs = 0;
  const runIdleList: number[] = [];
  const runDurations = summary.runs.map((r) => Number(r.durationMs || 0));
  const slowRuns: BatchInspectResult['slowRuns'] = [];

  for (const run of summary.runs) {
    const runDir = run.runDir || (run.runId ? path.join(path.dirname(summaryPath), run.runId) : undefined);
    const calls = runDir ? loadCallLog(runDir) : [];
    let runCallMs = 0;

    for (const c of calls) {
      const started = parseIsoMs(c.startedAt);
      const ended = parseIsoMs(c.endedAt);
      const duration = Math.max(0, ended - started);
      runCallMs += duration;
      callCount += 1;
      totalCallMs += duration;

      if (started > 0 && ended > 0 && ended >= started) {
        intervals.push({ t: started, d: +1 });
        intervals.push({ t: ended, d: -1 });
      }

      const rawName = String(c.name || '');
      const key = normalizeCallName(rawName);
      const cur = actionMap.get(key) ?? { totalMs: 0, calls: 0, maxMs: 0, attempts: 0 };
      cur.totalMs += duration;
      cur.calls += 1;
      cur.maxMs = Math.max(cur.maxMs, duration);
      if (/_attempt_\d+$/.test(rawName) || /_poll_\d+$/.test(rawName)) cur.attempts += 1;
      actionMap.set(key, cur);
    }

    const idle = Math.max(0, Number(run.durationMs || 0) - runCallMs);
    runIdleList.push(idle);
    slowRuns.push({
      batchIndex: run.batchIndex,
      runId: run.runId,
      status: run.status,
      durationMs: Number(run.durationMs || 0),
      callMs: runCallMs,
      idleMs: idle,
      error: run.error,
    });
  }

  intervals.sort((a, b) => {
    if (a.t !== b.t) return a.t - b.t;
    return b.d - a.d;
  });
  let active = 0;
  let maxConcurrentCalls = 0;
  for (const p of intervals) {
    active += p.d;
    maxConcurrentCalls = Math.max(maxConcurrentCalls, active);
  }

  const runDurationsSorted = [...runDurations].sort((a, b) => a - b);
  const runIdleSorted = [...runIdleList].sort((a, b) => a - b);

  const actionTimings: CallTimingStat[] = Array.from(actionMap.entries())
    .map(([name, s]) => ({
      name,
      calls: s.calls,
      attempts: s.attempts,
      totalMs: s.totalMs,
      avgMs: s.calls > 0 ? s.totalMs / s.calls : 0,
      maxMs: s.maxMs,
    }))
    .sort((a, b) => b.totalMs - a.totalMs);

  return {
    batchId: summary.batchId,
    summaryPath,
    casePath: summary.casePath,
    count: summary.count,
    concurrency: summary.concurrency,
    staggerMs: summary.staggerMs,
    totalDurationMs: summary.durationMs,
    overall: summary.overall,
    passed: summary.passed,
    failed: summary.failed,
    skipped: summary.skipped,
    interrupted: !!summary.interrupted,
    runDuration: {
      minMs: runDurationsSorted[0] ?? 0,
      avgMs: runDurations.length > 0 ? runDurations.reduce((a, b) => a + b, 0) / runDurations.length : 0,
      p50Ms: percentile(runDurationsSorted, 50),
      p95Ms: percentile(runDurationsSorted, 95),
      maxMs: runDurationsSorted[runDurationsSorted.length - 1] ?? 0,
    },
    callTotals: {
      calls: callCount,
      totalMs: totalCallMs,
      avgMs: callCount > 0 ? totalCallMs / callCount : 0,
    },
    overlap: {
      maxConcurrentCalls,
    },
    runIdle: {
      avgMs: runIdleList.length > 0 ? runIdleList.reduce((a, b) => a + b, 0) / runIdleList.length : 0,
      p95Ms: percentile(runIdleSorted, 95),
      maxMs: runIdleSorted[runIdleSorted.length - 1] ?? 0,
    },
    actionTimings,
    slowRuns: slowRuns.sort((a, b) => b.durationMs - a.durationMs).slice(0, topN),
  };
}
