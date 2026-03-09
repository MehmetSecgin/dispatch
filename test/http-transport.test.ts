import { describe, expect, it, vi } from 'vitest';
import { HttpTransport } from '../src/transport/http.ts';

// Stub artifacts — just enough for HttpTransport to call
function stubArtifacts() {
  return {
    nextIndex: vi.fn().mockReturnValue(1),
    requestPath: vi.fn().mockReturnValue('/tmp/req.json'),
    responsePath: vi.fn().mockReturnValue('/tmp/resp.json'),
    appendCallLog: vi.fn(),
  } as any;
}

// Stub pool that returns a canned response
function stubPool(statusCode = 200, body = '{"ok":true}') {
  return {
    request: vi.fn().mockResolvedValue({
      statusCode,
      headers: {},
      body: { text: () => Promise.resolve(body) },
    }),
  };
}

function stubPoolRegistry(pool: ReturnType<typeof stubPool>) {
  return { getForUrl: vi.fn().mockReturnValue(pool) } as any;
}

describe('HttpTransport', () => {
  describe('deriveName', () => {
    it('slugifies GET /api/events/123', async () => {
      const pool = stubPool();
      const artifacts = stubArtifacts();
      const http = new HttpTransport(artifacts, { poolRegistry: stubPoolRegistry(pool) });
      await http.get('https://example.com/api/events/123');
      expect(artifacts.appendCallLog).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'get_api_events_123' }),
      );
    });

    it('handles root URL', async () => {
      const pool = stubPool();
      const artifacts = stubArtifacts();
      const http = new HttpTransport(artifacts, { poolRegistry: stubPoolRegistry(pool) });
      await http.get('https://example.com/');
      expect(artifacts.appendCallLog).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'get_root' }),
      );
    });
  });

  describe('convenience methods', () => {
    it('get sends GET', async () => {
      const pool = stubPool();
      const http = new HttpTransport(stubArtifacts(), { poolRegistry: stubPoolRegistry(pool) });
      await http.get('https://example.com/items');
      expect(pool.request).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'GET', path: '/items' }),
      );
    });

    it('post sends POST with body', async () => {
      const pool = stubPool();
      const http = new HttpTransport(stubArtifacts(), { poolRegistry: stubPoolRegistry(pool) });
      await http.post('https://example.com/items', { name: 'test' });
      expect(pool.request).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'POST', body: '{"name":"test"}' }),
      );
    });

    it('put sends PUT with body', async () => {
      const pool = stubPool();
      const http = new HttpTransport(stubArtifacts(), { poolRegistry: stubPoolRegistry(pool) });
      await http.put('https://example.com/items/1', { name: 'updated' });
      expect(pool.request).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'PUT', body: '{"name":"updated"}' }),
      );
    });

    it('patch sends PATCH with body', async () => {
      const pool = stubPool();
      const http = new HttpTransport(stubArtifacts(), { poolRegistry: stubPoolRegistry(pool) });
      await http.patch('https://example.com/items/1', { name: 'patched' });
      expect(pool.request).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'PATCH', body: '{"name":"patched"}' }),
      );
    });

    it('delete sends DELETE', async () => {
      const pool = stubPool();
      const http = new HttpTransport(stubArtifacts(), { poolRegistry: stubPoolRegistry(pool) });
      await http.delete('https://example.com/items/1');
      expect(pool.request).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  describe('header merging', () => {
    it('per-request headers are sent', async () => {
      const pool = stubPool();
      const http = new HttpTransport(stubArtifacts(), { poolRegistry: stubPoolRegistry(pool) });
      await http.get('https://example.com/x', { headers: { Authorization: 'Bearer tok' } });
      const sentHeaders = pool.request.mock.calls[0][0].headers;
      expect(sentHeaders.authorization).toBe('Bearer tok');
    });

    it('default headers merge with per-request (per-request wins)', async () => {
      const pool = stubPool();
      const http = new HttpTransport(stubArtifacts(), {
        poolRegistry: stubPoolRegistry(pool),
        defaultHeaders: { 'X-Api-Key': 'default', Accept: 'text/plain' },
      });
      await http.get('https://example.com/x', { headers: { Accept: 'application/json' } });
      const sentHeaders = pool.request.mock.calls[0][0].headers;
      expect(sentHeaders['x-api-key']).toBe('default');
      expect(sentHeaders.accept).toBe('application/json');
    });

    it('uses default headers when no per-request headers', async () => {
      const pool = stubPool();
      const http = new HttpTransport(stubArtifacts(), {
        poolRegistry: stubPoolRegistry(pool),
        defaultHeaders: { 'X-Api-Key': 'key123' },
      });
      await http.get('https://example.com/x');
      const sentHeaders = pool.request.mock.calls[0][0].headers;
      expect(sentHeaders['x-api-key']).toBe('key123');
    });

    it('defaults content-type to application/json', async () => {
      const pool = stubPool();
      const http = new HttpTransport(stubArtifacts(), { poolRegistry: stubPoolRegistry(pool) });
      await http.get('https://example.com/x');
      const sentHeaders = pool.request.mock.calls[0][0].headers;
      expect(sentHeaders['content-type']).toBe('application/json');
    });

    it('withDefaults merges parent, child, and per-request headers', async () => {
      const pool = stubPool();
      const http = new HttpTransport(stubArtifacts(), {
        poolRegistry: stubPoolRegistry(pool),
        defaultHeaders: { Accept: 'application/json', 'X-Parent': 'parent' },
      });
      const api = http.withDefaults({
        defaultHeaders: { Accept: 'text/plain', 'X-Child': 'child' },
      });

      await api.get('https://example.com/x', {
        headers: { 'X-Child': 'request', 'X-Req': 'req' },
      });

      const sentHeaders = pool.request.mock.calls[0][0].headers;
      expect(sentHeaders.accept).toBe('text/plain');
      expect(sentHeaders['x-parent']).toBe('parent');
      expect(sentHeaders['x-child']).toBe('request');
      expect(sentHeaders['x-req']).toBe('req');
    });
  });

  describe('URL resolution', () => {
    it('resolves relative paths against baseUrl', async () => {
      const pool = stubPool();
      const reg = stubPoolRegistry(pool);
      const http = new HttpTransport(stubArtifacts(), { poolRegistry: reg, baseUrl: 'https://api.example.com' });
      await http.get('/events/123');
      expect(reg.getForUrl).toHaveBeenCalledWith('https://api.example.com/events/123');
    });

    it('resolves relative path without leading slash', async () => {
      const pool = stubPool();
      const reg = stubPoolRegistry(pool);
      const http = new HttpTransport(stubArtifacts(), { poolRegistry: reg, baseUrl: 'https://api.example.com' });
      await http.get('events/123');
      expect(reg.getForUrl).toHaveBeenCalledWith('https://api.example.com/events/123');
    });

    it('does not alter absolute URLs even with baseUrl', async () => {
      const pool = stubPool();
      const reg = stubPoolRegistry(pool);
      const http = new HttpTransport(stubArtifacts(), { poolRegistry: reg, baseUrl: 'https://api.example.com' });
      await http.get('https://other.com/items');
      expect(reg.getForUrl).toHaveBeenCalledWith('https://other.com/items');
    });

    it('strips trailing slash from baseUrl', async () => {
      const pool = stubPool();
      const reg = stubPoolRegistry(pool);
      const http = new HttpTransport(stubArtifacts(), { poolRegistry: reg, baseUrl: 'https://api.example.com/' });
      await http.get('/events');
      expect(reg.getForUrl).toHaveBeenCalledWith('https://api.example.com/events');
    });

    it('withDefaults resolves relative paths against child baseUrl without mutating parent', async () => {
      const pool = stubPool();
      const reg = stubPoolRegistry(pool);
      const http = new HttpTransport(stubArtifacts(), {
        poolRegistry: reg,
        baseUrl: 'https://parent.example.com',
      });
      const child = http.withDefaults({ baseUrl: 'https://child.example.com/api' });

      await child.get('/events');
      await http.get('/status');

      expect(reg.getForUrl).toHaveBeenNthCalledWith(1, 'https://child.example.com/api/events');
      expect(reg.getForUrl).toHaveBeenNthCalledWith(2, 'https://parent.example.com/status');
    });
  });

  describe('curl preview', () => {
    it('redacts authorization header values', async () => {
      const pool = stubPool();
      const artifacts = stubArtifacts();
      const http = new HttpTransport(artifacts, { poolRegistry: stubPoolRegistry(pool) });
      await http.get('https://example.com/x', { headers: { Authorization: 'Bearer my token' } });
      const curl: string = artifacts.appendCallLog.mock.calls[0][0].curl;
      expect(curl).toContain("'authorization: [REDACTED]'");
    });

    it('redacts cookie header values', async () => {
      const pool = stubPool();
      const artifacts = stubArtifacts();
      const http = new HttpTransport(artifacts, { poolRegistry: stubPoolRegistry(pool) });
      await http.get('https://example.com/x', { headers: { Cookie: 'sid=abc123; theme=dark' } });
      const curl: string = artifacts.appendCallLog.mock.calls[0][0].curl;
      expect(curl).toContain("'cookie: [REDACTED]'");
    });

    it('shell-quotes body with special characters', async () => {
      const pool = stubPool();
      const artifacts = stubArtifacts();
      const http = new HttpTransport(artifacts, { poolRegistry: stubPoolRegistry(pool) });
      await http.post('https://example.com/x', { msg: "it's a test" });
      const curl: string = artifacts.appendCallLog.mock.calls[0][0].curl;
      expect(curl).toContain("'\\''");
    });

    it('does not quote simple tokens', async () => {
      const pool = stubPool();
      const artifacts = stubArtifacts();
      const http = new HttpTransport(artifacts, { poolRegistry: stubPoolRegistry(pool) });
      await http.get('https://example.com/x');
      const curl: string = artifacts.appendCallLog.mock.calls[0][0].curl;
      expect(curl).toMatch(/^curl -sS -X GET https:\/\/example\.com\/x /);
    });
  });

  describe('response mapping', () => {
    it('maps statusCode and body to status and body', async () => {
      const pool = stubPool(201, '{"id":42}');
      const http = new HttpTransport(stubArtifacts(), { poolRegistry: stubPoolRegistry(pool) });
      const resp = await http.get('https://example.com/x');
      expect(resp).toEqual({ status: 201, body: { id: 42 } });
    });
  });

  describe('cookie jar', () => {
    it('stores set-cookie response headers and sends cookies on later requests', async () => {
      const pool = {
        request: vi
          .fn()
          .mockResolvedValueOnce({
            statusCode: 200,
            headers: { 'set-cookie': ['sid=abc123; Path=/; HttpOnly'] },
            body: { text: () => Promise.resolve('{"ok":true}') },
          })
          .mockResolvedValueOnce({
            statusCode: 200,
            headers: {},
            body: { text: () => Promise.resolve('{"ok":true}') },
          }),
      };
      const http = new HttpTransport(stubArtifacts(), { poolRegistry: stubPoolRegistry(pool as ReturnType<typeof stubPool>) });

      await http.post('https://example.com/login', { user: 'demo' });
      await http.get('https://example.com/me');

      expect(pool.request.mock.calls[1][0].headers.cookie).toBe('sid=abc123');
    });

    it('isolates cookies per transport instance', async () => {
      const pool = {
        request: vi
          .fn()
          .mockResolvedValueOnce({
            statusCode: 200,
            headers: { 'set-cookie': ['sid=abc123; Path=/'] },
            body: { text: () => Promise.resolve('{"ok":true}') },
          })
          .mockResolvedValueOnce({
            statusCode: 200,
            headers: {},
            body: { text: () => Promise.resolve('{"ok":true}') },
          }),
      };
      const registry = stubPoolRegistry(pool as ReturnType<typeof stubPool>);
      const first = new HttpTransport(stubArtifacts(), { poolRegistry: registry });
      const second = new HttpTransport(stubArtifacts(), { poolRegistry: registry });

      await first.post('https://example.com/login', { user: 'demo' });
      await second.get('https://example.com/me');

      expect(pool.request.mock.calls[1][0].headers.cookie).toBeUndefined();
    });

    it('shares cookies across parent and derived clients in one run', async () => {
      const pool = {
        request: vi
          .fn()
          .mockResolvedValueOnce({
            statusCode: 200,
            headers: { 'set-cookie': ['sid=abc123; Path=/; HttpOnly'] },
            body: { text: () => Promise.resolve('{"ok":true}') },
          })
          .mockResolvedValueOnce({
            statusCode: 200,
            headers: {},
            body: { text: () => Promise.resolve('{"ok":true}') },
          }),
      };
      const http = new HttpTransport(stubArtifacts(), {
        poolRegistry: stubPoolRegistry(pool as ReturnType<typeof stubPool>),
      });
      const api = http.withDefaults({ baseUrl: 'https://example.com' });

      await http.post('https://example.com/login', { user: 'demo' });
      await api.get('/me');

      expect(pool.request.mock.calls[1][0].headers.cookie).toBe('sid=abc123');
    });

    it('honors path and secure cookie restrictions', async () => {
      const pool = {
        request: vi
          .fn()
          .mockResolvedValueOnce({
            statusCode: 200,
            headers: {
              'set-cookie': [
                'sid=abc123; Path=/admin; Secure',
                'theme=dark; Path=/',
              ],
            },
            body: { text: () => Promise.resolve('{"ok":true}') },
          })
          .mockResolvedValue({
            statusCode: 200,
            headers: {},
            body: { text: () => Promise.resolve('{"ok":true}') },
          }),
      };
      const http = new HttpTransport(stubArtifacts(), { poolRegistry: stubPoolRegistry(pool as ReturnType<typeof stubPool>) });

      await http.post('https://example.com/login', { user: 'demo' });
      await http.get('http://example.com/admin/me');
      await http.get('https://example.com/admin/me');
      await http.get('https://example.com/profile');

      expect(pool.request.mock.calls[1][0].headers.cookie).toBe('theme=dark');
      expect(pool.request.mock.calls[2][0].headers.cookie).toBe('sid=abc123; theme=dark');
      expect(pool.request.mock.calls[3][0].headers.cookie).toBe('theme=dark');
    });

    it('drops expired cookies and lets manual cookie values override jar values', async () => {
      const pool = {
        request: vi
          .fn()
          .mockResolvedValueOnce({
            statusCode: 200,
            headers: {
              'set-cookie': [
                'sid=stale; Max-Age=0; Path=/',
                'theme=dark; Path=/',
                'mode=jar; Path=/',
              ],
            },
            body: { text: () => Promise.resolve('{"ok":true}') },
          })
          .mockResolvedValueOnce({
            statusCode: 200,
            headers: {},
            body: { text: () => Promise.resolve('{"ok":true}') },
          }),
      };
      const http = new HttpTransport(stubArtifacts(), { poolRegistry: stubPoolRegistry(pool as ReturnType<typeof stubPool>) });

      await http.post('https://example.com/login', { user: 'demo' });
      await http.get('https://example.com/me', { headers: { Cookie: 'mode=manual; extra=yes' } });

      expect(pool.request.mock.calls[1][0].headers.cookie).toBe('theme=dark; mode=manual; extra=yes');
    });
  });

  describe('module author pattern', () => {
    it('supports building a scoped API client once and reusing it', async () => {
      const pool = stubPool();
      const reg = stubPoolRegistry(pool);
      const ctxHttp = new HttpTransport(stubArtifacts(), { poolRegistry: reg });
      const api = ctxHttp.withDefaults({
        baseUrl: 'https://api.example.com/v1',
        defaultHeaders: { Authorization: 'Bearer secret-token', 'X-Client': 'dispatch' },
      });

      await api.get('/users/me');

      expect(reg.getForUrl).toHaveBeenCalledWith('https://api.example.com/v1/users/me');
      expect(pool.request).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            authorization: 'Bearer secret-token',
            'x-client': 'dispatch',
          }),
          path: '/v1/users/me',
        }),
      );
    });
  });

  describe('requireOk', () => {
    it('returns body for 2xx', () => {
      const http = new HttpTransport(stubArtifacts());
      expect(http.requireOk({ status: 200, body: { ok: true } }, 'test')).toEqual({ ok: true });
    });

    it('returns body for 204', () => {
      const http = new HttpTransport(stubArtifacts());
      expect(http.requireOk({ status: 204, body: null }, 'test')).toBeNull();
    });

    it('throws for 4xx', () => {
      const http = new HttpTransport(stubArtifacts());
      expect(() => http.requireOk({ status: 404, body: { error: 'not found' } }, 'fetch item')).toThrow(
        'fetch item failed with HTTP 404',
      );
    });

    it('throws for 5xx', () => {
      const http = new HttpTransport(stubArtifacts());
      expect(() => http.requireOk({ status: 500, body: {} }, 'save')).toThrow(
        'save failed with HTTP 500',
      );
    });
  });
});
