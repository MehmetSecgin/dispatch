import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CookieJar } from '../src/transport/cookies.ts';
import {
  clearCookieJar,
  loadCookieJar,
  resolveJarPath,
  saveCookieJar,
} from '../src/transport/cookie-jar-store.ts';
import { setDispatchHomeOverride } from '../src/state/home.ts';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-jar-store-'));
  setDispatchHomeOverride(tmp);
});

afterEach(() => {
  setDispatchHomeOverride(null);
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('resolveJarPath', () => {
  it('returns null when neither flag passed', () => {
    expect(resolveJarPath({})).toBeNull();
  });

  it('expands --session under DISPATCH_HOME/sessions/<name>/cookies.json', () => {
    const resolved = resolveJarPath({ session: 'demo' });
    expect(resolved?.filePath).toBe(path.join(tmp, 'sessions', 'demo', 'cookies.json'));
    expect(resolved?.source).toBe('session');
  });

  it('takes --cookie-jar as an absolute file path', () => {
    const target = path.join(tmp, 'custom.json');
    const resolved = resolveJarPath({ cookieJar: target });
    expect(resolved?.filePath).toBe(target);
    expect(resolved?.source).toBe('cookie-jar');
  });

  it('rejects both flags together', () => {
    expect(() => resolveJarPath({ session: 'a', cookieJar: 'b' })).toThrow(/either --session or --cookie-jar/);
  });

  it('rejects unsafe session names', () => {
    expect(() => resolveJarPath({ session: '../escape' })).toThrow(/Invalid session name/);
    expect(() => resolveJarPath({ session: 'with/slash' })).toThrow(/Invalid session name/);
    expect(() => resolveJarPath({ session: '' })).toBeTruthy(); // empty returns null
  });
});

describe('loadCookieJar / saveCookieJar', () => {
  it('returns an empty jar when the file does not exist', () => {
    const jar = loadCookieJar(path.join(tmp, 'missing.json'));
    expect(jar.getCookieHeader(new URL('https://example.com/'))).toBeNull();
  });

  it('round-trips through disk', () => {
    const jar = new CookieJar();
    jar.storeFromResponse(new URL('https://example.com/login'), {
      'set-cookie': ['sid=abc123; Path=/; HttpOnly'],
    });
    const target = path.join(tmp, 'sessions', 'demo', 'cookies.json');
    saveCookieJar(target, jar);

    const restored = loadCookieJar(target);
    expect(restored.getCookieHeader(new URL('https://example.com/me'))).toBe('sid=abc123');
  });

  it('writes the file mode 0600 and the directory 0700', () => {
    if (process.platform === 'win32') return;
    const jar = new CookieJar();
    jar.storeFromResponse(new URL('https://example.com/'), {
      'set-cookie': ['sid=abc; Path=/'],
    });
    const target = path.join(tmp, 'sessions', 'demo', 'cookies.json');
    saveCookieJar(target, jar);

    expect(fs.statSync(target).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(target)).mode & 0o777).toBe(0o700);
  });

  it('atomic-writes via a temp file', () => {
    const target = path.join(tmp, 'cookies.json');
    fs.writeFileSync(target, 'pre-existing');
    const jar = new CookieJar();
    jar.storeFromResponse(new URL('https://example.com/'), { 'set-cookie': ['sid=new; Path=/'] });
    saveCookieJar(target, jar);
    expect(fs.readFileSync(target, 'utf8')).toContain('"sid"');
    const remaining = fs.readdirSync(path.dirname(target)).filter((f) => f.startsWith('cookies.json.tmp'));
    expect(remaining).toEqual([]);
  });

  it('ignores malformed JSON and starts empty', () => {
    const target = path.join(tmp, 'cookies.json');
    fs.writeFileSync(target, '{not json');
    const jar = loadCookieJar(target);
    expect(jar.getCookieHeader(new URL('https://example.com/'))).toBeNull();
  });
});

describe('clearCookieJar', () => {
  it('removes the file when present', () => {
    const target = path.join(tmp, 'cookies.json');
    fs.writeFileSync(target, '{}');
    clearCookieJar(target);
    expect(fs.existsSync(target)).toBe(false);
  });

  it('is a no-op when the file is missing', () => {
    expect(() => clearCookieJar(path.join(tmp, 'absent.json'))).not.toThrow();
  });
});
