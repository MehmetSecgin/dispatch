import os from 'node:os';
import path from 'node:path';
import chalk from 'chalk';
import figures from 'figures';
import logSymbols from 'log-symbols';
import boxen from 'boxen';

type Tone = 'success' | 'error' | 'warning' | 'dim' | 'accent' | 'url' | 'none';

export function paint(text: string, tone: Tone, enabled: boolean): string {
  if (tone === 'none' || !enabled) return text;
  const ui = {
    success: chalk.green,
    error: chalk.red.bold,
    warning: chalk.yellow,
    dim: chalk.dim,
    accent: chalk.cyan,
    url: chalk.cyan.underline,
  } as const;
  return ui[tone](text);
}

export function shortenHomePath(p: string): string {
  const home = os.homedir();
  if (p === home) return '~';
  if (p.startsWith(`${home}${path.sep}`)) return `~${p.slice(home.length)}`;
  return p;
}

export function userPathDisplay(inputPath: string): string {
  return path.isAbsolute(inputPath) ? shortenHomePath(inputPath) : inputPath;
}

export function parseRunId(runId: string): { timestamp: string; label: string } {
  const m = runId.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(.+)$/);
  if (!m) return { timestamp: runId, label: runId };
  const [, y, mo, d, h, mi, _s, label] = m;
  return { timestamp: `${y}-${mo}-${d} ${h}:${mi}`, label };
}

export function runIdToIso(runId: string): string | undefined {
  const m = runId.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-/);
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
}

export function isColorEnabled(opts: { color?: boolean }): boolean {
  return !!(opts.color !== false && process.stdout.isTTY && !process.env.NO_COLOR);
}

export function uiSymbol(kind: 'success' | 'error' | 'warning' | 'info', colorEnabled: boolean): string {
  const plain = {
    success: process.platform === 'win32' ? figures.tick : '✓',
    error: process.platform === 'win32' ? figures.cross : '✗',
    warning: process.platform === 'win32' ? figures.warning : '⚠',
    info: process.platform === 'win32' ? figures.info : 'ℹ',
  } as const;
  if (colorEnabled) {
    if (kind === 'success') return logSymbols.success;
    if (kind === 'error') return logSymbols.error;
    if (kind === 'warning') return logSymbols.warning;
    return logSymbols.info;
  }
  return plain[kind];
}

export function renderStatusBox(text: string, tone: 'success' | 'error' | 'warning' | 'accent', colorEnabled: boolean): string {
  if (!process.stdout.isTTY) return paint(text, tone, colorEnabled);
  return boxen(text, {
    padding: { top: 0, right: 1, bottom: 0, left: 1 },
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    borderStyle: 'round',
    borderColor: colorEnabled
      ? (tone === 'success' ? 'green' : tone === 'error' ? 'red' : tone === 'warning' ? 'yellow' : 'cyan')
      : undefined,
  });
}
