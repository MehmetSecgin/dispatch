import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(THIS_DIR, '..');

describe('package files', () => {
  it(
    'ships module authoring docs and schema in npm pack dry-run output',
    () => {
    const out = spawnSync('npm', ['pack', '--json', '--dry-run'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });

    expect(out.status).toBe(0);

    const packOutput = JSON.parse(out.stdout.trim()) as Array<{
      files: Array<{ path: string }>;
    }>;
    const files = packOutput.flatMap((entry) => entry.files.map((file) => file.path));

    expect(files).toEqual(
      expect.arrayContaining(['MODULE_AUTHORING.md', 'CONVENTIONS.md', 'schemas/module.json.schema.json']),
    );
    },
    15_000,
  );
});
