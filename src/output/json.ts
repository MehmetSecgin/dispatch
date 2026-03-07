import { isJsonObject, type JsonObject, type JsonValue } from '../core/json.js';

export function cleanJson(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    return value.map(cleanJson).filter((v) => v !== undefined);
  }
  if (isJsonObject(value)) {
    const out: JsonObject = {};
    for (const [k, v] of Object.entries(value)) {
      const cleaned = cleanJson(v);
      if (k === 'next' && Array.isArray(cleaned) && cleaned.length === 0) continue;
      if (cleaned !== undefined) out[k] = cleaned;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
  return value as JsonValue;
}