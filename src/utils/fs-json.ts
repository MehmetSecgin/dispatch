import fs from 'node:fs';

export function readJson<T = unknown>(p: string): T {
  return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
}

export function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

export function writeJson(p: string, v: unknown): void {
  fs.writeFileSync(p, JSON.stringify(v, null, 2));
}

export function requireFile(p: string, label: string): void {
  if (!fs.existsSync(p)) throw new Error(`Missing ${label}: ${p}`);
}

export function jsonStringifySafe(v: unknown): string {
  return JSON.stringify(v, null, 2);
}
