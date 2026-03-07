#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const outFile = path.join(root, 'src', 'generated', 'skill-version.ts');
const skillVersion = (process.env.DISPATCH_SKILL_VERSION || 'dev-local').trim();

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, `export const SKILL_VERSION = ${JSON.stringify(skillVersion)};\n`, 'utf8');
console.log(`wrote ${outFile} (${skillVersion})`);
