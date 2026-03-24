import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearMemoryNamespace,
  forgetMemoryValue,
  listMemoryByPrefix,
  readMemoryNamespace,
  recallMemoryValue,
  recallMemoryValues,
  resolveMemoryPath,
  storeMemoryValue,
  storeMemoryValues,
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

  it('stores many entries in one write and preserves nested object and array values', () => {
    const configDir = makeConfigDir();
    storeMemoryValues(configDir, 'reference-data', [
      {
        key: 'catalog.products.p1',
        value: {
          prices: [1, 2, 3],
          meta: { tags: ['featured'] },
        },
      },
      {
        key: 'catalog.products.p2',
        value: ['bundle', { enabled: true }],
      },
    ]);

    expect(readMemoryNamespace(configDir, 'reference-data')).toEqual({
      catalog: {
        products: {
          p1: {
            prices: [1, 2, 3],
            meta: { tags: ['featured'] },
          },
          p2: ['bundle', { enabled: true }],
        },
      },
    });
  });

  it('lists stored entries under a prefix and recalls many keys with defaults', () => {
    const configDir = makeConfigDir();
    storeMemoryValues(configDir, 'reference-data', [
      { key: 'catalog.products.p1', value: { id: 'p1' } },
      { key: 'catalog.products.p2', value: { id: 'p2' } },
    ]);

    expect(listMemoryByPrefix(configDir, 'reference-data', 'catalog.products.')).toEqual({
      prefix: 'catalog.products',
      keys: ['catalog.products.p1', 'catalog.products.p2'],
      count: 2,
      contents: {
        p1: { id: 'p1' },
        p2: { id: 'p2' },
      },
    });

    expect(recallMemoryValues(configDir, 'reference-data', ['catalog.products.p1', 'catalog.products.p3'], 'missing')).toEqual([
      { key: 'catalog.products.p1', found: true, value: { id: 'p1' } },
      { key: 'catalog.products.p3', found: false, value: 'missing' },
    ]);
  });
});
