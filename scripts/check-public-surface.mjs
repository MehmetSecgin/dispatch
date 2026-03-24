import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const dtsPath = path.join(REPO_ROOT, 'dist', 'index.d.ts');

if (!fs.existsSync(dtsPath)) {
  console.error(`missing declaration output: ${dtsPath}`);
  process.exit(1);
}

const dts = fs.readFileSync(dtsPath, 'utf8');
const banned = [
  'RunArtifacts',
  'HttpPoolRegistry',
  'HttpTransportOptions',
  'HttpTransportImpl',
  'HttpTransportArtifacts',
  'HttpTransportConfig',
  'HttpTransportSharedState',
  'HttpPoolClient',
  'ConnectionPoolProvider',
  'ModuleDefinition',
  'ModuleLayer',
  'ModuleJobDefinition',
  'ModuleJobKind',
  'ActionHandler',
];

const leaked = banned.filter((name) => dts.includes(name));
if (leaked.length > 0) {
  console.error(`public declaration surface leaked internal names: ${leaked.join(', ')}`);
  process.exit(1);
}

console.log('public declaration surface OK');
