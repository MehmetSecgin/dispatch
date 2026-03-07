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
    storeMemoryValue(configDir, 'sportsbook-reference', 'markets.1x2-fulltime', {
      winners: 1,
      selections: ['home', 'draw', 'away'],
    });

    expect(recallMemoryValue(configDir, 'sportsbook-reference', 'markets.1x2-fulltime')).toEqual({
      found: true,
      value: {
        winners: 1,
        selections: ['home', 'draw', 'away'],
      },
    });
  });

  it('keeps namespaces isolated', () => {
    const configDir = makeConfigDir();
    storeMemoryValue(configDir, 'sportsbook-reference', 'markets.1x2', { winners: 1 });
    storeMemoryValue(configDir, 'other-team', 'markets.1x2', { winners: 2 });

    expect(readMemoryNamespace(configDir, 'sportsbook-reference')).toEqual({
      markets: {
        '1x2': {
          winners: 1,
        },
      },
    });
    expect(readMemoryNamespace(configDir, 'other-team')).toEqual({
      markets: {
        '1x2': {
          winners: 2,
        },
      },
    });
  });

  it('forgets one subtree without clearing siblings', () => {
    const configDir = makeConfigDir();
    storeMemoryValue(configDir, 'sportsbook-reference', 'markets.1x2', { winners: 1 });
    storeMemoryValue(configDir, 'sportsbook-reference', 'markets.totals', { winners: 2 });

    expect(forgetMemoryValue(configDir, 'sportsbook-reference', 'markets.1x2')).toBe(true);
    expect(readMemoryNamespace(configDir, 'sportsbook-reference')).toEqual({
      markets: {
        totals: {
          winners: 2,
        },
      },
    });
  });

  it('clears only one namespace file', () => {
    const configDir = makeConfigDir();
    storeMemoryValue(configDir, 'sportsbook-reference', 'markets.1x2', { winners: 1 });
    storeMemoryValue(configDir, 'other-team', 'markets.1x2', { winners: 2 });

    expect(clearMemoryNamespace(configDir, 'sportsbook-reference')).toBe(1);
    expect(readMemoryNamespace(configDir, 'sportsbook-reference')).toEqual({});
    expect(readMemoryNamespace(configDir, 'other-team')).toEqual({
      markets: {
        '1x2': {
          winners: 2,
        },
      },
    });
    expect(fs.existsSync(resolveMemoryPath(configDir, 'sportsbook-reference'))).toBe(true);
  });
});
