import createDebug from 'debug';
import { sanitizeValue } from '../execution/sanitize.js';

export function debugNs(namespace: string) {
  return createDebug(`dispatch:${namespace}`);
}

export function redactDebug<T>(value: T): T {
  return sanitizeValue(value) as T;
}
