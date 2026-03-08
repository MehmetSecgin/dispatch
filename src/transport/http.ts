import fs from 'node:fs';
import { RunArtifacts } from '../artifacts/run-artifacts.js';
import { isJsonObject } from '../core/json.js';
import type { JsonValue } from '../core/json.js';
import { nowIso } from '../core/time.js';
import { sanitizeValue } from '../execution/sanitize.js';
import { debugNs, redactDebug } from '../core/debug.js';
import { jsonStringifySafe, writeJson } from '../utils/fs-json.js';
import { getDefaultHttpPoolRegistry, HttpPoolRegistry } from '../services/http-pool.js';
import { CookieJar, mergeCookieHeaders } from './cookies.js';
import type { HttpMethod, HttpRequestOptions, HttpResponse } from './types.js';

export interface HttpTransportOptions {
  baseUrl?: string;
  defaultHeaders?: Record<string, string>;
  verboseArtifacts?: boolean;
  poolRegistry?: HttpPoolRegistry;
}

export class HttpTransport {
  private readonly debug = debugNs('http');
  private readonly cookieJar = new CookieJar();

  constructor(
    private readonly artifacts: RunArtifacts,
    private readonly opts?: HttpTransportOptions,
  ) {}

  async get(url: string, opts?: HttpRequestOptions): Promise<HttpResponse> {
    return this.request('GET', url, opts);
  }

  async post(url: string, body?: unknown, opts?: HttpRequestOptions): Promise<HttpResponse> {
    return this.request('POST', url, { ...opts, body });
  }

  async put(url: string, body?: unknown, opts?: HttpRequestOptions): Promise<HttpResponse> {
    return this.request('PUT', url, { ...opts, body });
  }

  async patch(url: string, body?: unknown, opts?: HttpRequestOptions): Promise<HttpResponse> {
    return this.request('PATCH', url, { ...opts, body });
  }

  async delete(url: string, opts?: HttpRequestOptions): Promise<HttpResponse> {
    return this.request('DELETE', url, opts);
  }

  async request(
    method: HttpMethod,
    url: string,
    opts?: HttpRequestOptions & { body?: unknown },
  ): Promise<HttpResponse> {
    const resolvedUrl = this.resolveUrl(url);
    const name = this.deriveName(method, resolvedUrl);
    this.debug('request start name=%s method=%s url=%s', name, method, resolvedUrl);

    const idx = this.artifacts.nextIndex();
    const reqPath = this.artifacts.requestPath(idx, name);
    const respPath = this.artifacts.responsePath(idx, name);

    let bodyData: string | null = null;
    if (opts?.body !== undefined) {
      bodyData = JSON.stringify(opts.body);
      writeJson(reqPath, sanitizeValue(opts.body));
      this.debug('request body written path=%s', reqPath);
    }

    const startedAt = nowIso();

    // Build headers: content-type default, then defaults, then per-request
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.opts?.defaultHeaders) {
      for (const [k, v] of Object.entries(this.opts.defaultHeaders)) {
        headers[k.toLowerCase()] = v;
      }
    }
    if (opts?.headers) {
      for (const [k, v] of Object.entries(opts.headers)) {
        headers[k.toLowerCase()] = v;
      }
    }

    const mergedCookieHeader = mergeCookieHeaders(
      this.cookieJar.getCookieHeader(new URL(resolvedUrl)),
      headers.cookie,
    );
    if (mergedCookieHeader) headers.cookie = mergedCookieHeader;
    else delete headers.cookie;

    const headerFlags = Object.entries(headers).flatMap(([k, v]) => ['-H', `${k}: ${sanitizeHeaderValueForLog(k, v)}`]);
    const curlPreview = [
      'curl',
      '-sS',
      '-X',
      method,
      resolvedUrl,
      ...headerFlags,
      ...(bodyData !== null ? ['--data-raw', bodyData] : []),
    ];

    const parsedUrl = new URL(resolvedUrl);
    const poolRegistry = this.opts?.poolRegistry ?? getDefaultHttpPoolRegistry();
    const pool = poolRegistry.getForUrl(resolvedUrl);

    let code = 0;
    let rawResponse = '';
    let responseJson: JsonValue | unknown = {};
    let endedAt = nowIso();

    try {
      const result = await pool.request({
        method,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        headers,
        body: bodyData ?? undefined,
      });
      code = result.statusCode;
      this.cookieJar.storeFromResponse(parsedUrl, result.headers);
      rawResponse = await result.body.text();
      endedAt = nowIso();
      fs.writeFileSync(respPath, rawResponse, 'utf8');

      if (rawResponse.trim().length > 0) {
        try {
          responseJson = JSON.parse(rawResponse);
        } catch {
          responseJson = { _raw: rawResponse };
        }
      }
      this.debug('request done name=%s code=%d', name, code);
    } catch (error) {
      endedAt = nowIso();
      responseJson = {
        _error: error instanceof Error ? error.message : String(error),
      };
      fs.writeFileSync(respPath, JSON.stringify(responseJson, null, 2), 'utf8');
      this.debug('request failed name=%s error=%O', name, redactDebug(responseJson));
    }

    this.artifacts.appendCallLog({
      idx: String(idx).padStart(3, '0'),
      startedAt,
      endedAt,
      name,
      method,
      url: resolvedUrl,
      requestFile: opts?.body !== undefined ? reqPath : null,
      responseFile: respPath,
      httpCode: code,
      curl: curlPreview.map(shellQuote).join(' '),
    });

    if (code === 0) {
      const errorMessage = isJsonObject(responseJson) ? responseJson._error : undefined;
      throw new Error(`HTTP request failed for ${name}: ${errorMessage ?? 'unknown error'}`);
    }

    return { status: code, body: responseJson };
  }

  requireOk(response: HttpResponse, label: string): unknown {
    if (response.status < 200 || response.status > 299) {
      this.debug('requireOk failed label=%s status=%d', label, response.status);
      throw new Error(`${label} failed with HTTP ${response.status}: ${jsonStringifySafe(response.body)}`);
    }
    this.debug('requireOk ok label=%s status=%d', label, response.status);
    return response.body;
  }

  private resolveUrl(url: string): string {
    if (this.opts?.baseUrl && !url.startsWith('http://') && !url.startsWith('https://')) {
      const base = this.opts.baseUrl.endsWith('/') ? this.opts.baseUrl.slice(0, -1) : this.opts.baseUrl;
      const p = url.startsWith('/') ? url : `/${url}`;
      return `${base}${p}`;
    }
    return url;
  }

  private deriveName(method: HttpMethod, url: string): string {
    try {
      const parsed = new URL(url);
      const slug = parsed.pathname
        .replace(/^\/+|\/+$/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .toLowerCase();
      return `${method.toLowerCase()}_${slug || 'root'}`;
    } catch {
      const slug = url
        .replace(/^\/+|\/+$/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .toLowerCase();
      return `${method.toLowerCase()}_${slug || 'root'}`;
    }
  }
}

function shellQuote(s: string): string {
  if (/^[a-zA-Z0-9_./:@=-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, "'\\''")}'`;
}

function sanitizeHeaderValueForLog(name: string, value: string): string {
  const lowerName = name.toLowerCase();
  if (lowerName === 'cookie' || lowerName === 'authorization') return '[REDACTED]';
  return value;
}
