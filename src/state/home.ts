import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let dispatchHomeOverride: string | null = null;

export function parseDispatchHomeArg(argv: string[]): string | null {
  for (let idx = 0; idx < argv.length; idx += 1) {
    const arg = argv[idx];
    if (arg === '--home') return argv[idx + 1] ?? null;
    if (arg.startsWith('--home=')) return arg.slice('--home='.length) || null;
  }
  return null;
}

export function setDispatchHomeOverride(dir: string | null | undefined): string {
  const normalized = typeof dir === 'string' ? dir.trim() : '';
  dispatchHomeOverride = normalized ? path.resolve(normalized) : null;
  return getDispatchHomeDir();
}

export function getDispatchHomeDir(): string {
  if (dispatchHomeOverride) return dispatchHomeOverride;
  if (process.env.DISPATCH_HOME?.trim()) return path.resolve(process.env.DISPATCH_HOME.trim());
  return path.join(os.homedir(), '.dispatch');
}

export function getDispatchStatePath(...segments: string[]): string {
  return path.join(getDispatchHomeDir(), ...segments);
}

export function ensureDispatchHomeDir(): string {
  const dir = getDispatchHomeDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
