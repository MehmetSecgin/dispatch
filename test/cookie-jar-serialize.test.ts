import { describe, expect, it } from 'vitest';
import { COOKIE_JAR_FORMAT_VERSION, CookieJar } from '../src/transport/cookies.ts';

function buildJar(headers: Record<string, string[]>, url = 'https://example.com/login') {
  const jar = new CookieJar();
  jar.storeFromResponse(new URL(url), headers);
  return jar;
}

describe('CookieJar.serialize / deserialize', () => {
  it('round-trips a session cookie unchanged', () => {
    const jar = buildJar({ 'set-cookie': ['sid=abc123; Path=/; HttpOnly'] });
    const dumped = jar.serialize();
    expect(dumped.version).toBe(COOKIE_JAR_FORMAT_VERSION);

    const restored = CookieJar.deserialize(JSON.parse(JSON.stringify(dumped)));
    expect(restored.getCookieHeader(new URL('https://example.com/me'))).toBe('sid=abc123');
  });

  it('round-trips an explicitly-domained cookie', () => {
    const jar = buildJar({
      'set-cookie': ['theme=dark; Domain=example.com; Path=/'],
    });
    const restored = CookieJar.deserialize(jar.serialize());
    expect(restored.getCookieHeader(new URL('https://api.example.com/x'))).toBe('theme=dark');
  });

  it('drops cookies whose expiresAt is in the past when loading', () => {
    const now = Date.now();
    const payload = {
      version: COOKIE_JAR_FORMAT_VERSION,
      cookies: [
        {
          name: 'stale',
          value: 'x',
          domain: 'example.com',
          hostOnly: true,
          path: '/',
          secure: false,
          httpOnly: false,
          expiresAt: now - 1000,
          createdAt: now - 5000,
        },
        {
          name: 'fresh',
          value: 'y',
          domain: 'example.com',
          hostOnly: true,
          path: '/',
          secure: false,
          httpOnly: false,
          expiresAt: now + 60_000,
          createdAt: now,
        },
      ],
    };
    const restored = CookieJar.deserialize(payload, now);
    expect(restored.getCookieHeader(new URL('https://example.com/'))).toBe('fresh=y');
  });

  it('drops expired cookies on serialize', () => {
    const jar = new CookieJar();
    jar.storeFromResponse(new URL('https://example.com/'), {
      'set-cookie': ['stale=x; Max-Age=1; Path=/', 'fresh=y; Path=/'],
    });
    const future = Date.now() + 10_000;
    const dumped = jar.serialize(future);
    const names = dumped.cookies.map((c) => c.name);
    expect(names).toContain('fresh');
    expect(names).not.toContain('stale');
  });

  it('returns an empty jar for unknown version', () => {
    const restored = CookieJar.deserialize({ version: 999, cookies: [] });
    expect(restored.getCookieHeader(new URL('https://example.com/'))).toBeNull();
  });

  it('returns an empty jar for malformed input', () => {
    expect(CookieJar.deserialize(null).getCookieHeader(new URL('https://example.com/'))).toBeNull();
    expect(CookieJar.deserialize('garbage').getCookieHeader(new URL('https://example.com/'))).toBeNull();
    expect(
      CookieJar.deserialize({ version: COOKIE_JAR_FORMAT_VERSION, cookies: 'nope' }).getCookieHeader(
        new URL('https://example.com/'),
      ),
    ).toBeNull();
  });

  it('skips entries missing required fields', () => {
    const restored = CookieJar.deserialize({
      version: COOKIE_JAR_FORMAT_VERSION,
      cookies: [
        { name: 'ok', value: 'v', domain: 'example.com', hostOnly: true, path: '/', secure: false, httpOnly: false, expiresAt: null, createdAt: 0 },
        { name: 'bad' },
        { value: 'noname' },
      ],
    });
    expect(restored.getCookieHeader(new URL('https://example.com/'))).toBe('ok=v');
  });
});
