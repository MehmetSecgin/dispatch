import type { IncomingHttpHeaders } from 'node:http';

interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  hostOnly: boolean;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expiresAt: number | null;
  createdAt: number;
}

export class CookieJar {
  private readonly cookies: StoredCookie[] = [];

  storeFromResponse(url: URL, headers: IncomingHttpHeaders): void {
    const setCookieHeader = headers['set-cookie'];
    const rawCookies = Array.isArray(setCookieHeader)
      ? setCookieHeader
      : typeof setCookieHeader === 'string'
        ? [setCookieHeader]
        : [];

    for (const rawCookie of rawCookies) {
      const parsed = parseSetCookie(rawCookie, url);
      if (!parsed) continue;
      this.upsert(parsed);
    }
    this.pruneExpired(Date.now());
  }

  getCookieHeader(url: URL, now = Date.now()): string | null {
    this.pruneExpired(now);

    const matching = this.cookies
      .filter((cookie) => cookieMatchesUrl(cookie, url))
      .sort(compareCookiesForHeader);

    if (matching.length === 0) return null;
    return matching.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
  }

  private pruneExpired(now: number): void {
    for (let i = this.cookies.length - 1; i >= 0; i -= 1) {
      const cookie = this.cookies[i];
      if (cookie.expiresAt !== null && cookie.expiresAt <= now) {
        this.cookies.splice(i, 1);
      }
    }
  }

  private upsert(cookie: StoredCookie): void {
    const existingIdx = this.cookies.findIndex(
      (existing) =>
        existing.name === cookie.name &&
        existing.domain === cookie.domain &&
        existing.path === cookie.path &&
        existing.hostOnly === cookie.hostOnly,
    );

    if (cookie.expiresAt !== null && cookie.expiresAt <= Date.now()) {
      if (existingIdx >= 0) this.cookies.splice(existingIdx, 1);
      return;
    }

    if (existingIdx >= 0) this.cookies.splice(existingIdx, 1);
    this.cookies.push(cookie);
  }
}

export function mergeCookieHeaders(
  jarCookieHeader: string | null,
  manualCookieHeader: string | undefined,
): string | undefined {
  if (!jarCookieHeader && !manualCookieHeader) return undefined;
  if (!jarCookieHeader) return manualCookieHeader;
  if (!manualCookieHeader) return jarCookieHeader;

  const merged = new Map<string, string>();
  for (const [name, value] of parseCookieHeader(jarCookieHeader)) merged.set(name, value);
  for (const [name, value] of parseCookieHeader(manualCookieHeader)) merged.set(name, value);
  return Array.from(merged.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

function parseSetCookie(raw: string, url: URL): StoredCookie | null {
  const segments = raw
    .split(';')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  if (segments.length === 0) return null;

  const [nameValue, ...attributeSegments] = segments;
  const equalsIdx = nameValue.indexOf('=');
  if (equalsIdx <= 0) return null;

  const name = nameValue.slice(0, equalsIdx).trim();
  const value = nameValue.slice(equalsIdx + 1).trim();
  if (!name) return null;

  const defaults = defaultCookieScope(url);
  let domain = defaults.domain;
  let hostOnly = true;
  let path = defaults.path;
  let secure = false;
  let httpOnly = false;
  let expiresAt: number | null = null;

  for (const attributeSegment of attributeSegments) {
    const [rawAttrName, ...rawAttrValueParts] = attributeSegment.split('=');
    const attrName = rawAttrName.trim().toLowerCase();
    const attrValue = rawAttrValueParts.join('=').trim();

    switch (attrName) {
      case 'domain': {
        const normalized = normalizeCookieDomain(attrValue);
        if (!normalized || !domainMatches(url.hostname, normalized)) return null;
        domain = normalized;
        hostOnly = false;
        break;
      }
      case 'path':
        path = normalizeCookiePath(attrValue);
        break;
      case 'expires': {
        const parsed = Date.parse(attrValue);
        if (!Number.isNaN(parsed)) expiresAt = parsed;
        break;
      }
      case 'max-age': {
        const seconds = Number.parseInt(attrValue, 10);
        if (!Number.isNaN(seconds)) expiresAt = Date.now() + seconds * 1000;
        break;
      }
      case 'secure':
        secure = true;
        break;
      case 'httponly':
        httpOnly = true;
        break;
      default:
        break;
    }
  }

  return {
    name,
    value,
    domain,
    hostOnly,
    path,
    secure,
    httpOnly,
    expiresAt,
    createdAt: Date.now(),
  };
}

function cookieMatchesUrl(cookie: StoredCookie, url: URL): boolean {
  if (cookie.secure && url.protocol !== 'https:') return false;
  if (!domainMatchesUrl(cookie, url.hostname)) return false;
  if (!pathMatches(url.pathname || '/', cookie.path)) return false;
  return true;
}

function compareCookiesForHeader(a: StoredCookie, b: StoredCookie): number {
  if (b.path.length !== a.path.length) return b.path.length - a.path.length;
  return a.createdAt - b.createdAt;
}

function domainMatchesUrl(cookie: StoredCookie, host: string): boolean {
  const normalizedHost = host.toLowerCase();
  if (cookie.hostOnly) return normalizedHost === cookie.domain;
  return normalizedHost === cookie.domain || normalizedHost.endsWith(`.${cookie.domain}`);
}

function domainMatches(host: string, cookieDomain: string): boolean {
  const normalizedHost = host.toLowerCase();
  return normalizedHost === cookieDomain || normalizedHost.endsWith(`.${cookieDomain}`);
}

function pathMatches(requestPath: string, cookiePath: string): boolean {
  if (requestPath === cookiePath) return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith('/') || requestPath.charAt(cookiePath.length) === '/';
}

function defaultCookieScope(url: URL): { domain: string; path: string } {
  return {
    domain: url.hostname.toLowerCase(),
    path: defaultCookiePath(url.pathname || '/'),
  };
}

function defaultCookiePath(pathname: string): string {
  if (!pathname.startsWith('/')) return '/';
  if (pathname === '/') return '/';
  const lastSlash = pathname.lastIndexOf('/');
  if (lastSlash <= 0) return '/';
  return pathname.slice(0, lastSlash);
}

function normalizeCookieDomain(value: string): string | null {
  const normalized = value.trim().replace(/^\.+/, '').toLowerCase();
  return normalized || null;
}

function normalizeCookiePath(value: string): string {
  if (!value || !value.startsWith('/')) return '/';
  return value;
}

function parseCookieHeader(header: string): Array<[string, string]> {
  return header
    .split(';')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      const equalsIdx = segment.indexOf('=');
      if (equalsIdx <= 0) return null;
      return [segment.slice(0, equalsIdx).trim(), segment.slice(equalsIdx + 1).trim()] as [string, string];
    })
    .filter((entry): entry is [string, string] => entry !== null);
}
