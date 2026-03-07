import fs from 'node:fs';
import path from 'node:path';

type MemoryState = Record<string, unknown>;

function sanitizeNamespace(namespace: string): string {
  const sanitized = String(namespace || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  if (!sanitized) throw new Error('Memory namespace is empty');
  return sanitized;
}

function splitKeyPath(key: string): string[] {
  const segments = String(key || '')
    .split('.')
    .map((segment) => segment.trim());
  if (segments.length === 0 || segments.some((segment) => segment.length === 0)) {
    throw new Error(`Invalid memory key path: ${key}`);
  }
  return segments;
}

function ensureMemoryObject(value: unknown): MemoryState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as MemoryState;
}

function deletePath(target: MemoryState, segments: string[]): boolean {
  if (segments.length === 1) {
    if (!Object.prototype.hasOwnProperty.call(target, segments[0])) return false;
    delete target[segments[0]];
    return true;
  }
  const [head, ...rest] = segments;
  const next = target[head];
  if (!next || typeof next !== 'object' || Array.isArray(next)) return false;
  const deleted = deletePath(next as MemoryState, rest);
  if (deleted && Object.keys(next as MemoryState).length === 0) delete target[head];
  return deleted;
}

function readPath(target: unknown, segments: string[]): { found: boolean; value: unknown } {
  let cursor = target;
  for (const segment of segments) {
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) {
      return { found: false, value: undefined };
    }
    if (!Object.prototype.hasOwnProperty.call(cursor, segment)) {
      return { found: false, value: undefined };
    }
    cursor = (cursor as MemoryState)[segment];
  }
  return { found: true, value: cursor };
}

export function resolveMemoryPath(configDir: string, namespace: string): string {
  return path.join(resolveMemoryRoot(configDir), `${sanitizeNamespace(namespace)}.json`);
}

export function resolveMemoryRoot(configDir: string): string {
  return path.join(configDir, 'memory');
}

export function listMemoryNamespaces(configDir: string): Array<{ namespace: string; path: string }> {
  const rootDir = resolveMemoryRoot(configDir);
  if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) return [];

  return fs
    .readdirSync(rootDir)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => ({
      namespace: entry.slice(0, -'.json'.length),
      path: path.join(rootDir, entry),
    }))
    .sort((a, b) => a.namespace.localeCompare(b.namespace));
}

export function readMemoryNamespace(configDir: string, namespace: string): MemoryState {
  const filePath = resolveMemoryPath(configDir, namespace);
  if (!fs.existsSync(filePath)) return {};
  try {
    return ensureMemoryObject(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch {
    return {};
  }
}

export function writeMemoryNamespace(configDir: string, namespace: string, state: MemoryState): void {
  const filePath = resolveMemoryPath(configDir, namespace);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export function storeMemoryValue(configDir: string, namespace: string, key: string, value: unknown): void {
  const state = readMemoryNamespace(configDir, namespace);
  const segments = splitKeyPath(key);
  let cursor: MemoryState = state;
  for (const segment of segments.slice(0, -1)) {
    const current = cursor[segment];
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as MemoryState;
  }
  cursor[segments[segments.length - 1]] = value;
  writeMemoryNamespace(configDir, namespace, state);
}

export function recallMemoryValue(
  configDir: string,
  namespace: string,
  key: string,
): { found: boolean; value: unknown } {
  const state = readMemoryNamespace(configDir, namespace);
  return readPath(state, splitKeyPath(key));
}

export function forgetMemoryValue(configDir: string, namespace: string, key: string): boolean {
  const state = readMemoryNamespace(configDir, namespace);
  const forgotten = deletePath(state, splitKeyPath(key));
  if (forgotten) writeMemoryNamespace(configDir, namespace, state);
  return forgotten;
}

export function clearMemoryNamespace(configDir: string, namespace: string): number {
  const state = readMemoryNamespace(configDir, namespace);
  const removed = Object.keys(state).length;
  writeMemoryNamespace(configDir, namespace, {});
  return removed;
}
