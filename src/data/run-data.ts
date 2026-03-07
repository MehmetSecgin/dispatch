import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { JsonObject } from '../core/json.js';
import { JobCaseSchema } from '../core/schema.js';
import { RuntimeContext } from '../execution/interpolation.js';
import { ROOT_DIR } from './paths.js';

export function readJsonMaybe(filePath: string | null | undefined): unknown {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return { _raw: raw };
  }
}

function readTextMaybe(filePath: string | null | undefined): string | null {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf8');
}

export function parseActivityLog(filePath: string): Array<{ at: string; message: string }> {
  const txt = readTextMaybe(filePath);
  if (!txt) return [];
  return txt
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^(\S+)\s+(.+)$/);
      if (!m) return null;
      return { at: m[1], message: m[2] };
    })
    .filter((x): x is { at: string; message: string } => x !== null);
}

export interface CallLogEntry extends JsonObject {
  idx?: string;
  startedAt?: string;
  endedAt?: string;
  name?: string;
  method?: string;
  url?: string;
  requestFile?: string | null;
  responseFile?: string | null;
  httpCode?: number | string;
  curl?: string;
}

export function loadCallLog(runDir: string): CallLogEntry[] {
  const logPath = path.join(runDir, 'curl_calls.jsonl');
  if (!fs.existsSync(logPath)) return [];
  const lines = fs
    .readFileSync(logPath, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return lines
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function loadCase(casePath: string) {
  const resolved = resolveCasePath(casePath);
  const parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  return JobCaseSchema.parse(parsed);
}

export function resolveCasePath(inputPath: string): string {
  const raw = String(inputPath || '').trim();
  if (!raw) throw new Error('Case path is empty');

  const candidates: string[] = [];
  if (path.isAbsolute(raw)) candidates.push(raw);
  else {
    candidates.push(path.resolve(raw));
    candidates.push(path.join(ROOT_DIR, raw));
    candidates.push(path.join(ROOT_DIR, 'jobs', raw));
    if (!raw.endsWith('.json')) {
      candidates.push(path.join(ROOT_DIR, 'jobs', `${raw}.job.case.json`));
      candidates.push(path.join(ROOT_DIR, `${raw}.job.case.json`));
    }
    candidates.push(path.join(ROOT_DIR, 'jobs', path.basename(raw)));
  }

  const unique = Array.from(new Set(candidates));
  const found = unique.find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
  if (found) return found;
  throw new Error(`Case file not found: ${raw}`);
}

export function listBundledCases(): Array<string> {
  const jobsDir = path.join(ROOT_DIR, 'jobs');
  if (!fs.existsSync(jobsDir)) return [];
  return fs
    .readdirSync(jobsDir)
    .filter((n) => n.endsWith('.job.case.json'))
    .map((n) => path.join(jobsDir, n))
    .sort((a, b) => a.localeCompare(b));
}

export function defaultRuntime(
  cliVersion: string,
  opts?: {
    configDir?: string;
    overrides?: JsonObject;
  },
): RuntimeContext {
  return {
    configDir: opts?.configDir ?? path.join(os.homedir(), '.dispatch'),
    run: {
      cliVersion,
      startedAt: new Date().toISOString(),
      ...(opts?.overrides ?? {}),
    },
    steps: {},
  };
}

export function defaultUserModulesDir(): string {
  return path.join(os.homedir(), '.dispatch', 'modules');
}

export function buildDumpSummary(meta: { cliVersion?: string; runId: string; runDir: string }): JsonObject {
  return {
    cliVersion: meta.cliVersion,
    runId: meta.runId,
    runDir: meta.runDir,
  };
}
