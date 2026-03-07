import fs from 'node:fs';
import path from 'node:path';
import { ModuleDefinition, ModuleJobDefinition, ModuleJobKind } from './types.js';

const JOB_SUFFIX_RE = /\.job\.(seed|case)\.json$/;

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      out.push(...walkFiles(fullPath));
      continue;
    }
    if (stat.isFile()) out.push(fullPath);
  }
  return out;
}

function compareJobs(a: ModuleJobDefinition, b: ModuleJobDefinition): number {
  if (a.id !== b.id) return a.id.localeCompare(b.id);
  if (a.kind !== b.kind) return a.kind === 'seed' ? -1 : 1;
  return a.path.localeCompare(b.path);
}

export function discoverModuleJobs(moduleDir: string): ModuleJobDefinition[] {
  const jobsDir = path.join(moduleDir, 'jobs');
  if (!fs.existsSync(jobsDir) || !fs.statSync(jobsDir).isDirectory()) return [];

  return walkFiles(jobsDir)
    .map((filePath) => {
      const rel = path.relative(jobsDir, filePath);
      const match = rel.match(JOB_SUFFIX_RE);
      if (!match) return null;
      const kind = match[1] as ModuleJobKind;
      return {
        id: rel.replace(JOB_SUFFIX_RE, ''),
        kind,
        path: filePath,
      };
    })
    .filter((job): job is ModuleJobDefinition => job !== null)
    .sort(compareJobs);
}

export function resolveModuleJob(moduleDef: ModuleDefinition, jobId: string): ModuleJobDefinition | null {
  const normalizedId = String(jobId || '').trim();
  if (!normalizedId) return null;
  const jobs = moduleDef.jobs ?? [];
  return jobs.find((job) => job.id === normalizedId && job.kind === 'seed') ??
    jobs.find((job) => job.id === normalizedId && job.kind === 'case') ??
    null;
}
