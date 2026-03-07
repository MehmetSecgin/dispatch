import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveRootDir(): string {
  let cwd: string | null = null;
  try {
    cwd = process.cwd();
  } catch {
    cwd = null;
  }

  const candidates = [path.resolve(__dirname, '..'), path.resolve(__dirname, '../..'), ...(cwd ? [cwd] : [])];

  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'package.json'))) return c;
  }

  return path.resolve(__dirname, '..');
}

export const ROOT_DIR = resolveRootDir();
export const RUN_OUTPUT_DIR = path.join(ROOT_DIR, 'run-output');
