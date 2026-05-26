import fs from 'node:fs';
import path from 'node:path';
import { CookieJar } from './cookies.js';
import { getDispatchHomeDir } from '../state/home.js';

const SESSION_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export interface ResolvedJarPath {
  filePath: string;
  source: 'session' | 'cookie-jar';
  sessionName?: string;
}

export function resolveJarPath(opts: { session?: string; cookieJar?: string }): ResolvedJarPath | null {
  const sessionRaw = typeof opts.session === 'string' ? opts.session.trim() : '';
  const cookieJarRaw = typeof opts.cookieJar === 'string' ? opts.cookieJar.trim() : '';

  if (sessionRaw && cookieJarRaw) {
    throw new Error('Pass either --session or --cookie-jar, not both');
  }
  if (sessionRaw) {
    if (!SESSION_NAME_PATTERN.test(sessionRaw)) {
      throw new Error(
        `Invalid session name '${sessionRaw}'. Use letters, digits, '.', '_' or '-' and start with a letter or digit.`,
      );
    }
    const filePath = path.join(getDispatchHomeDir(), 'sessions', sessionRaw, 'cookies.json');
    return { filePath, source: 'session', sessionName: sessionRaw };
  }
  if (cookieJarRaw) {
    return { filePath: path.resolve(cookieJarRaw), source: 'cookie-jar' };
  }
  return null;
}

export function loadCookieJar(filePath: string, now = Date.now()): CookieJar {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new CookieJar();
    throw error;
  }
  if (!raw.trim()) return new CookieJar();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return new CookieJar();
  }
  return CookieJar.deserialize(parsed, now);
}

export function saveCookieJar(filePath: string, jar: CookieJar, now = Date.now()): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    // best-effort on platforms without POSIX perms
  }

  const data = `${JSON.stringify(jar.serialize(now), null, 2)}\n`;
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, data, { mode: 0o600 });
  try {
    fs.chmodSync(tmp, 0o600);
  } catch {
    // ignore
  }
  fs.renameSync(tmp, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // ignore
  }
}

export function clearCookieJar(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
