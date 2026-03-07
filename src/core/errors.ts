import type { JsonObject } from './json.js';

type CliErrorCode = 'USAGE_ERROR' | 'TRANSIENT_ERROR' | 'NOT_FOUND' | 'RUNTIME_ERROR';

interface CliErrorEnvelope {
  status: 'error';
  code: CliErrorCode;
  retryable: boolean;
  message: string;
  details?: JsonObject;
  next?: Array<{ command: string; description: string }>;
}

class CliError extends Error {
  readonly code: CliErrorCode;
  readonly retryable: boolean;
  readonly details?: JsonObject;

  constructor(code: CliErrorCode, message: string, opts?: { retryable?: boolean; details?: JsonObject }) {
    super(message);
    this.name = 'CliError';
    this.code = code;
    this.retryable = opts?.retryable ?? code === 'TRANSIENT_ERROR';
    this.details = opts?.details;
  }
}

function toCliError(err: unknown): CliError {
  if (err instanceof CliError) return err;
  const message = err instanceof Error ? err.message : String(err);
  const code = inferCliErrorCode(message);
  return new CliError(code, message, { retryable: code === 'TRANSIENT_ERROR' });
}

function inferCliErrorCode(message: string): CliErrorCode {
  const msg = String(message || '').toLowerCase();

  if (
    msg.includes(' not found') ||
    msg.startsWith('not found') ||
    msg.includes('no run found') ||
    msg.includes('batch summary not found') ||
    msg.includes('case file not found') ||
    msg.includes('run id not found')
  ) {
    return 'NOT_FOUND';
  }

  if (
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('econnreset') ||
    msg.includes('econnrefused') ||
    msg.includes('enotfound') ||
    msg.includes('eai_again') ||
    msg.includes('temporar') ||
    msg.includes('http 429') ||
    msg.includes('http 502') ||
    msg.includes('http 503') ||
    msg.includes('http 504')
  ) {
    return 'TRANSIENT_ERROR';
  }

  if (
    msg.includes('unknown command') ||
    msg.includes('unknown argument') ||
    msg.includes('unknown action') ||
    msg.includes('unsupported') ||
    msg.includes('invalid') ||
    msg.includes('missing') ||
    msg.includes('required') ||
    msg.includes('must be') ||
    msg.includes('provide ') ||
    msg.includes('validation failed')
  ) {
    return 'USAGE_ERROR';
  }

  return 'RUNTIME_ERROR';
}

export function exitCodeForCliError(err: unknown): number {
  const c = toCliError(err).code;
  if (c === 'USAGE_ERROR') return 2;
  if (c === 'TRANSIENT_ERROR') return 3;
  if (c === 'NOT_FOUND') return 4;
  return 1;
}

export function jsonErrorEnvelope(
  err: unknown,
  next: Array<{ command: string; description: string }> = [],
): CliErrorEnvelope {
  const e = toCliError(err);
  return {
    status: 'error',
    code: e.code,
    retryable: e.retryable,
    message: e.message,
    details: e.details,
    next,
  };
}

export function cliErrorFromCode(code: CliErrorCode, message: string, details?: JsonObject): CliError {
  return new CliError(code, message, { details, retryable: code === 'TRANSIENT_ERROR' });
}
