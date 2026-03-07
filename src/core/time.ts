import { randomBytes } from 'node:crypto';

export function nowIso(): string {
  return new Date().toISOString();
}

export function nowStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function parseDurationMs(value: string): number {
  const m = value.trim().match(/^(\d+)(ms|s|m|h)$/i);
  if (!m) throw new Error(`Invalid duration '${value}'`);
  const n = Number(m[1]);
  const u = m[2].toLowerCase();
  if (u === 'ms') return n;
  if (u === 's') return n * 1000;
  if (u === 'm') return n * 60_000;
  if (u === 'h') return n * 3_600_000;
  throw new Error(`Unsupported duration unit '${u}'`);
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function randomHex(length: number): string {
  if (!Number.isInteger(length) || length <= 0) throw new Error('randomHex length must be > 0');
  const bytes = Math.ceil(length / 2);
  return randomBytes(bytes).toString('hex').slice(0, length);
}

export function runIdUniqToken(): string {
  const ms = String(new Date().getMilliseconds()).padStart(3, '0');
  return `${ms}${randomHex(4)}`;
}
