import fs from 'node:fs';
import path from 'node:path';
import { isJsonObject } from '../core/json.js';
import { getDispatchStatePath } from '../state/home.js';

interface RuntimeOverrides {
  scoreDefaults?: {
    currentPeriod?: {
      id: number;
      name: string;
      slug: string;
    };
    clock?: {
      minute: number;
      second: number;
    };
  };
}

export function getRuntimeOverridesPath(): string {
  return getDispatchStatePath('runtime-overrides.json');
}

export function loadRuntimeOverrides(configPath = getRuntimeOverridesPath()): RuntimeOverrides {
  if (!fs.existsSync(configPath)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (!isJsonObject(raw)) return {};
    const out: RuntimeOverrides = {};
    if (isJsonObject(raw.scoreDefaults)) {
      const scoreDefaults: NonNullable<RuntimeOverrides['scoreDefaults']> = {};
      const p = raw.scoreDefaults.currentPeriod;
      if (isJsonObject(p)) {
        const id = Number(p.id);
        const name = String(p.name ?? '').trim();
        const slug = String(p.slug ?? '').trim();
        if (Number.isInteger(id) && id > 0 && name && slug) {
          scoreDefaults.currentPeriod = { id, name, slug };
        }
      }
      const c = raw.scoreDefaults.clock;
      if (isJsonObject(c)) {
        const minute = Number(c.minute);
        const second = Number(c.second);
        if (Number.isInteger(minute) && minute >= 0 && Number.isInteger(second) && second >= 0 && second <= 59) {
          scoreDefaults.clock = { minute, second };
        }
      }
      if (scoreDefaults.currentPeriod || scoreDefaults.clock) out.scoreDefaults = scoreDefaults;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveRuntimeOverrides(overrides: RuntimeOverrides, configPath = getRuntimeOverridesPath()): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(overrides, null, 2)}\n`, 'utf8');
}
