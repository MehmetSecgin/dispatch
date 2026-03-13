import fs from 'node:fs';
import path from 'node:path';
import { isJsonObject } from '../core/json.js';
import { getDispatchStatePath } from '../state/home.js';

export type ActionDefaultsMap = Record<string, Record<string, unknown>>;

export function getActionDefaultsPath(): string {
  return getDispatchStatePath('action-defaults.json');
}

export function loadActionDefaults(filePath = getActionDefaultsPath()): ActionDefaultsMap {
  if (!fs.existsSync(filePath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: ActionDefaultsMap = {};
    for (const [action, value] of Object.entries(parsed)) {
      if (typeof action !== 'string' || !value || typeof value !== 'object' || Array.isArray(value)) continue;
      out[action] = value as Record<string, unknown>;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveActionDefaults(defaults: ActionDefaultsMap, filePath = getActionDefaultsPath()): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(defaults, null, 2)}\n`, 'utf8');
}

function deepClone<T>(v: T): T {
  if (v === undefined) return v;
  return JSON.parse(JSON.stringify(v));
}

function mergeValue(base: unknown, override: unknown): unknown {
  if (override === undefined) return deepClone(base);
  if (base === undefined) return deepClone(override);
  if (Array.isArray(base) || Array.isArray(override)) {
    return deepClone(override);
  }
  if (isJsonObject(base) && isJsonObject(override)) {
    const out: Record<string, unknown> = {};
    const keys = new Set([...Object.keys(base), ...Object.keys(override)]);
    for (const k of keys) out[k] = mergeValue(base[k], override[k]);
    return out;
  }
  return deepClone(override);
}

export function applyActionDefaults(
  action: string,
  payload: Record<string, unknown> | undefined,
  defaultsMap: ActionDefaultsMap,
): Record<string, unknown> {
  const defaults = defaultsMap[action];
  const incoming = payload ?? {};
  if (!defaults) return deepClone(incoming);
  return mergeValue(defaults, incoming) as Record<string, unknown>;
}
