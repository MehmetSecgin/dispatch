import fs from 'node:fs';
import path from 'node:path';
import { RUN_OUTPUT_DIR } from '../data/paths.js';
import { nowIso, nowStamp, runIdUniqToken } from '../core/time.js';
import { ensureDir } from '../utils/fs-json.js';

export class RunArtifacts {
  readonly runId: string;
  readonly runDir: string;
  readonly callsDir: string;
  readonly callsLogPath: string;
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

  nextIndex(): number {
    this.callIndex += 1;
    return this.callIndex;
  }

  requestPath(idx: number, name: string): string {
    return path.join(this.callsDir, `${String(idx).padStart(3, '0')}_${name}.request.json`);
  }

  responsePath(idx: number, name: string): string {
    return path.join(this.callsDir, `${String(idx).padStart(3, '0')}_${name}.response.json`);
  }

  appendActivity(line: string): void {
    fs.appendFileSync(this.activityLogPath, `${nowIso()} ${line}\n`);
  }

  appendCallLog(entry: unknown): void {
    fs.appendFileSync(this.callsLogPath, `${JSON.stringify(entry)}\n`);
  }
}
