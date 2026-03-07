import fs from 'node:fs';
import path from 'node:path';

type MemoryState = Record<string, unknown>;

function resolveMemoryPath(configDir: string): string {
  return path.join(configDir, 'memory.json');
}

export function readMemory(configDir: string): MemoryState {
  const filePath = resolveMemoryPath(configDir);
  if (!fs.existsSync(filePath)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return raw as MemoryState;
  } catch {
    return {};
  }
}

export function writeMemory(configDir: string, state: MemoryState): void {
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(resolveMemoryPath(configDir), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}
