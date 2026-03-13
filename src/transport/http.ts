import fs from 'node:fs';
import { isJsonObject } from '../core/json.js';
import type { JsonValue } from '../core/json.js';
import { nowIso } from '../core/time.js';
import { sanitizeValue } from '../execution/sanitize.js';
import { debugNs, redactDebug } from '../core/debug.js';
import { jsonStringifySafe, writeJson } from '../utils/fs-json.js';
import { getDefaultHttpPoolRegistry } from '../services/http-pool.js';
import type { Artifacts } from '../modules/types.js';
import { CookieJar, mergeCookieHeaders } from './cookies.js';
import type { HttpMethod, HttpRequestOptions, HttpResponse } from './types.js';

interface HttpTransportArtifacts extends Artifacts {
  nextIndex(): number;
  requestPath(idx: number, name: string): string;
  responsePath(idx: number, name: string): string;
  appendCallLog(entry: unknown): void;
}

interface HttpPoolClient {
  request(options: {
    method: HttpMethod;
    path: string;
    headers: Record<string, string>;
    body?: string;
  }): Promise<{
    statusCode: number;
    headers: Record<string, string | string[] | undefined>;
    body: { text(): Promise<string> };
  }>;
}

interface ConnectionPoolProvider {
  getForUrl(url: string): HttpPoolClient;
}

interface HttpTransportConfig {
  baseUrl?: string;
  defaultHeaders?: Record<string, string>;
  verboseArtifacts?: boolean;
  poolRegistry?: ConnectionPoolProvider;
}

interface HttpTransportSharedState {
  cookieJar: CookieJar;
  poolRegistry?: ConnectionPoolProvider;
}

/**
 * HTTP client used inside action handlers.
 *
 * The transport is usually provided through `ctx.http`. It is preconfigured
 * from the job's top-level `http` block, keeps a shared cookie jar across the
 * whole run, and records requests and responses into run artifacts
 * automatically.
 */
export class HttpTransport {
  private readonly debug = debugNs('http');
  private shared: HttpTransportSharedState;

  constructor(
    private readonly artifacts: HttpTransportArtifacts,
    private readonly opts?: HttpTransportConfig,
  ) {
    this.shared = {
      cookieJar: new CookieJar(),
      poolRegistry: opts?.poolRegistry,
    };
  }

  /**
   * Create a derived transport with narrowed defaults.
   *
   * The derived transport shares the same cookie jar, connection pools, and
   * artifact recording as the original transport.
   */
  withDefaults(opts?: { baseUrl?: string; defaultHeaders?: Record<string, string> }): HttpTransport {
    const derived = new HttpTransport(this.artifacts, {
      ...this.opts,
      ...opts,
      defaultHeaders: mergeDefaultHeaders(this.opts?.defaultHeaders, opts?.defaultHeaders),
      poolRegistry: this.shared.poolRegistry,
    });
    derived.shared = this.shared;
    return derived;
  }

  /** Send a GET request. Relative URLs resolve against `baseUrl`. */
  async get(url: string, opts?: HttpRequestOptions): Promise<HttpResponse> {
    return this.request('GET', url, opts);
  }

  /** Send a POST request with an optional JSON body. */
  async post(url: string, body?: unknown, opts?: HttpRequestOptions): Promise<HttpResponse> {
    return this.request('POST', url, { ...opts, body });
  }

  /** Send a PUT request with an optional JSON body. */
  async put(url: string, body?: unknown, opts?: HttpRequestOptions): Promise<HttpResponse> {
    return this.request('PUT', url, { ...opts, body });
  }

  /** Send a PATCH request with an optional JSON body. */
  async patch(url: string, body?: unknown, opts?: HttpRequestOptions): Promise<HttpResponse> {
    return this.request('PATCH', url, { ...opts, body });
  }

  /** Send a DELETE request. */
  async delete(url: string, opts?: HttpRequestOptions): Promise<HttpResponse> {
    return this.request('DELETE', url, opts);
  }

  /**
   * Send a request with explicit method control.
   *
   * URLs may be absolute, or relative when the transport has a `baseUrl`.
   * Request and response artifacts are recorded automatically.
   */
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
      this.shared.cookieJar.getCookieHeader(new URL(resolvedUrl)),
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
    const poolRegistry = this.shared.poolRegistry ?? getDefaultHttpPoolRegistry();
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
      this.shared.cookieJar.storeFromResponse(parsedUrl, result.headers);
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

  /**
   * Assert that a response has a 2xx status code.
   *
   * On success, this returns `response.body`, which is typically the parsed
   * JSON body from the transport. On failure, it throws an error that includes
   * the provided label and the response status code.
   */
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

function mergeDefaultHeaders(
  base?: Record<string, string>,
  extra?: Record<string, string>,
): Record<string, string> | undefined {
  if (!base && !extra) return undefined;
  const merged: Record<string, string> = {};
  for (const headers of [base, extra]) {
    if (!headers) continue;
    for (const [key, value] of Object.entries(headers)) {
      merged[key.toLowerCase()] = value;
    }
  }
  return merged;
}
