import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearMemoryNamespace,
  forgetMemoryValue,
  readMemoryNamespace,
  recallMemoryValue,
  resolveMemoryPath,
  storeMemoryValue,
} from '../src/modules/builtin/memory/store.ts';

function makeConfigDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-memory-test-'));
}

afterEach(() => {
  for (const entry of fs.readdirSync(os.tmpdir())) {
    if (entry.startsWith('dispatch-memory-test-')) {
      fs.rmSync(path.join(os.tmpdir(), entry), { recursive: true, force: true });
    }
  }
});

describe('memory store', () => {
  it('stores and recalls nested values inside one namespace', () => {
    const configDir = makeConfigDir();
    storeMemoryValue(configDir, 'reference-data', 'catalog.primary', {
      entryCount: 1,
      labels: ['alpha', 'beta', 'gamma'],
    });

    expect(recallMemoryValue(configDir, 'reference-data', 'catalog.primary')).toEqual({
      found: true,
      value: {
        entryCount: 1,
        labels: ['alpha', 'beta', 'gamma'],
      },
    });
  });

  it('keeps namespaces isolated', () => {
    const configDir = makeConfigDir();
    storeMemoryValue(configDir, 'reference-data', 'catalog.primary', { entries: 1 });
    storeMemoryValue(configDir, 'auxiliary-space', 'catalog.primary', { entries: 2 });

    expect(readMemoryNamespace(configDir, 'reference-data')).toEqual({
      catalog: {
        primary: {
          entries: 1,
        },
      },
    });
    expect(readMemoryNamespace(configDir, 'auxiliary-space')).toEqual({
      catalog: {
        primary: {
          entries: 2,
        },
      },
    });
  });

  it('forgets one subtree without clearing siblings', () => {
    const configDir = makeConfigDir();
    storeMemoryValue(configDir, 'reference-data', 'catalog.primary', { entries: 1 });
    storeMemoryValue(configDir, 'reference-data', 'catalog.secondary', { entries: 2 });

    expect(forgetMemoryValue(configDir, 'reference-data', 'catalog.primary')).toBe(true);
    expect(readMemoryNamespace(configDir, 'reference-data')).toEqual({
      catalog: {
        secondary: {
          entries: 2,
        },
      },
    });
  });

  it('clears only one namespace file', () => {
    const configDir = makeConfigDir();
    storeMemoryValue(configDir, 'reference-data', 'catalog.primary', { entries: 1 });
    storeMemoryValue(configDir, 'auxiliary-space', 'catalog.primary', { entries: 2 });

    expect(clearMemoryNamespace(configDir, 'reference-data')).toBe(1);
    expect(readMemoryNamespace(configDir, 'reference-data')).toEqual({});
    expect(readMemoryNamespace(configDir, 'auxiliary-space')).toEqual({
      catalog: {
        primary: {
          entries: 2,
        },
      },
    });
    expect(fs.existsSync(resolveMemoryPath(configDir, 'reference-data'))).toBe(true);
  });
});
