import type { JsonObject, JsonValue } from '../../core/json.js';
import type { NextAction } from '../../job/next-actions.js';
import { paint, shortenHomePath, uiSymbol } from './symbols.js';
import { renderTableString } from './table.js';

export function formatJobAssertHumanResult(
  result: {
    runId: string;
    runDir: string;
    overall: 'PASS' | 'FAIL';
    passed: number;
    failed: number;
    checks: Array<{ name: string; status: 'PASS' | 'FAIL'; reason?: string; details?: JsonObject }>;
  },
  opts: { verbose: boolean; color: boolean },
): string[] {
  const total = result.checks.length;
  const lines: string[] = [];
  if (result.overall === 'PASS') {
    lines.push(paint(`${uiSymbol('success', opts.color)} Assertions passed (${result.passed}/${total})`, 'success', opts.color));
  } else {
    lines.push(paint(`${uiSymbol('error', opts.color)} Assertions failed (${result.passed}/${total} passed)`, 'error', opts.color));
    for (const check of result.checks.filter(item => item.status === 'FAIL')) {
      const reason = check.reason ? `: ${check.reason}` : '';
      lines.push(`${paint(`  ${uiSymbol('error', opts.color)}`, 'error', opts.color)} ${check.name}${reason}`);
    }
  }

  if (opts.verbose) {
    lines.push(`${paint('  Run:', 'dim', opts.color)}      ${result.runId}`);
    lines.push(`${paint('  Run dir:', 'dim', opts.color)}  ${shortenHomePath(result.runDir)}`);
    for (const check of result.checks) {
      const mark = check.status === 'PASS'
        ? paint(uiSymbol('success', opts.color), 'success', opts.color)
        : paint(uiSymbol('error', opts.color), 'error', opts.color);
      const reason = check.reason ? ` (${check.reason})` : '';
      lines.push(`  ${mark} ${check.name}${reason}`);
    }
  }

  return lines;
}

export function formatNextActionsHuman(next: NextAction[], opts: { color: boolean }): string[] {
  if (next.length === 0) return [];
  const lines = [`${paint('Next', 'dim', opts.color)}        ${next[0].command}  ${next[0].description}`];
  for (const action of next.slice(1)) {
    lines.push(`            ${action.command}  ${action.description}`);
  }
  return lines;
}

function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function formatBatchInspectHumanResult(
  result: {
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
    runDuration: { minMs: number; avgMs: number; p50Ms: number; p95Ms: number; maxMs: number };
    callTotals: { calls: number; totalMs: number; avgMs: number };
    overlap: { maxConcurrentCalls: number };
    runIdle: { avgMs: number; p95Ms: number; maxMs: number };
    actionTimings: Array<{ name: string; calls: number; attempts: number; totalMs: number; avgMs: number; maxMs: number }>;
    slowRuns: Array<{ batchIndex: number; runId?: string; status: string; durationMs: number; callMs: number; idleMs: number; error?: string }>;
  },
  opts: { color: boolean; topN: number },
): string[] {
  const overallTone = result.overall === 'PASS' ? 'success' : 'error';
  const overallSymbol = uiSymbol(result.overall === 'PASS' ? 'success' : 'error', opts.color);
  const lines = [
    '',
    `${paint('Batch:', 'dim', opts.color)}        ${result.batchId}`,
    `${paint('Summary:', 'dim', opts.color)}      ${shortenHomePath(result.summaryPath)}`,
  ];
  if (result.casePath) lines.push(`${paint('Case:', 'dim', opts.color)}         ${shortenHomePath(result.casePath)}`);
  lines.push(`${paint('Runs:', 'dim', opts.color)}         total=${result.count} pass=${result.passed} fail=${result.failed} skip=${result.skipped}`);
  lines.push(`${paint('Config:', 'dim', opts.color)}       concurrency=${result.concurrency} stagger=${result.staggerMs}ms interrupted=${result.interrupted ? 'yes' : 'no'}`);
  lines.push(`${paint('Total:', 'dim', opts.color)}        ${formatMs(result.totalDurationMs)}`);
  lines.push(`${paint('Overall:', 'dim', opts.color)}      ${paint(`${overallSymbol} ${result.overall}`, overallTone, opts.color)}`);
  lines.push('');
  lines.push(renderTableString(['Run Duration', 'Value'], [
    ['min', formatMs(result.runDuration.minMs)],
    ['avg', formatMs(result.runDuration.avgMs)],
    ['p50', formatMs(result.runDuration.p50Ms)],
    ['p95', formatMs(result.runDuration.p95Ms)],
    ['max', formatMs(result.runDuration.maxMs)],
  ], { flexColumn: 1 }));
  lines.push('');
  lines.push(renderTableString(['Signal', 'Value'], [
    ['calls', String(result.callTotals.calls)],
    ['call total', formatMs(result.callTotals.totalMs)],
    ['call avg', formatMs(result.callTotals.avgMs)],
    ['max overlap', String(result.overlap.maxConcurrentCalls)],
    ['idle avg', formatMs(result.runIdle.avgMs)],
    ['idle p95', formatMs(result.runIdle.p95Ms)],
    ['idle max', formatMs(result.runIdle.maxMs)],
  ], { flexColumn: 1 }));

  const topActions = result.actionTimings.slice(0, opts.topN);
  if (topActions.length > 0) {
    lines.push('');
    lines.push(renderTableString(
      ['Top Actions', 'Calls', 'Attempts', 'Total', 'Avg', 'Max'],
      topActions.map(action => [
        action.name,
        action.calls,
        action.attempts,
        formatMs(action.totalMs),
        formatMs(action.avgMs),
        formatMs(action.maxMs),
      ]),
      { flexColumn: 0, minFlexWidth: 12 },
    ));
  }

  if (result.slowRuns.length > 0) {
    lines.push('');
    lines.push(renderTableString(
      ['Slow Runs', 'Run ID', 'Status', 'Duration', 'Call', 'Idle', 'Error'],
      result.slowRuns.map(run => [
        String(run.batchIndex),
        run.runId ?? '-',
        run.status,
        formatMs(run.durationMs),
        formatMs(run.callMs),
        formatMs(run.idleMs),
        run.error ?? '',
      ]),
      { flexColumn: 6, minFlexWidth: 12 },
    ));
  }

  return lines;
}
