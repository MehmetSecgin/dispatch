import fs from 'node:fs';
import path from 'node:path';
import { RUN_OUTPUT_DIR } from '../data/paths.js';
import { nowIso, nowStamp, runIdUniqToken } from '../core/time.js';
import { ensureDir } from '../utils/fs-json.js';

/**
 * Manages run output artifacts for one dispatch run.
 *
 * Module authors primarily use `appendActivity(...)` to add human-readable
 * action activity lines. Dispatch and `HttpTransport` handle HTTP artifact
 * recording automatically.
 */
export class RunArtifacts {
  /** Unique identifier for the current run. */
  readonly runId: string;

  /** Absolute path to the run output directory. */
  readonly runDir: string;

  /** Absolute path to the directory holding recorded HTTP call payloads. */
  readonly callsDir: string;

  /** Absolute path to the JSONL summary of recorded HTTP calls. */
  readonly callsLogPath: string;

  /** Absolute path to the human-readable activity log. */
  readonly activityLogPath: string;
  private callIndex = 0;

  constructor(label: string) {
    this.runId = `${nowStamp()}-${label}-${runIdUniqToken()}`;
    this.runDir = path.join(RUN_OUTPUT_DIR, this.runId);
    this.callsDir = path.join(this.runDir, 'calls');
    this.callsLogPath = path.join(this.runDir, 'http_calls.jsonl');
    this.activityLogPath = path.join(this.runDir, 'activity.log');
    ensureDir(this.callsDir);
  }

  /**
   * Allocate the next monotonically increasing HTTP call index.
   *
   * This is runner plumbing used by `HttpTransport`.
   */
  nextIndex(): number {
    this.callIndex += 1;
    return this.callIndex;
  }

  /**
   * Compute the artifact path for a recorded request body.
   *
   * This is runner plumbing used by `HttpTransport`.
   */
  requestPath(idx: number, name: string): string {
    return path.join(this.callsDir, `${String(idx).padStart(3, '0')}_${name}.request.json`);
  }

  /**
   * Compute the artifact path for a recorded response body.
   *
   * This is runner plumbing used by `HttpTransport`.
   */
  responsePath(idx: number, name: string): string {
    return path.join(this.callsDir, `${String(idx).padStart(3, '0')}_${name}.response.json`);
  }

  /**
   * Append one line to the run activity log.
   *
   * Convention: `<action-name> key=value key=value`.
   */
  appendActivity(line: string): void {
    fs.appendFileSync(this.activityLogPath, `${nowIso()} ${line}\n`);
  }

  /**
   * Append one machine-readable HTTP call entry to the JSONL call log.
   *
   * This is runner plumbing used by `HttpTransport`.
   */
  appendCallLog(entry: unknown): void {
    fs.appendFileSync(this.callsLogPath, `${JSON.stringify(entry)}\n`);
  }
}
