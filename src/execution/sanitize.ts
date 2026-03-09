import { isJsonObject, type JsonObject } from '../core/json.js';

const SENSITIVE_KEYS = new Set([
  'password',
  'token',
  'cookie',
  'authorization',
  'apikey',
  'api-key',
  'clientsecret',
  'client-secret',
  'secret',
]);

export function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (isJsonObject(value)) {
    const out: JsonObject = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_KEYS.has(k.toLowerCase())) out[k] = '[REDACTED]';
      else out[k] = sanitizeValue(v);
    }
    return out;
  }
  return value;
}
