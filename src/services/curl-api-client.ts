import fs from 'node:fs';
import { RunArtifacts } from '../artifacts/run-artifacts.js';
import { isJsonObject } from '../core/json.js';
import type { JsonValue } from '../core/json.js';
import { nowIso } from '../core/time.js';
import { sanitizeValue } from '../execution/sanitize.js';
import { debugNs, redactDebug } from '../core/debug.js';
import { jsonStringifySafe, writeJson } from '../utils/fs-json.js';
import { getDefaultHttpPoolRegistry, HttpPoolRegistry } from './http-pool.js';

interface ApiCallResult {
  code: number;
  responsePath: string;
  responseJson: JsonValue | unknown;
}

export class CurlApiClient {
  private readonly debug = debugNs('api:curl');
  private readonly cookies = new Map<string, string>();

  constructor(
    private readonly artifacts: RunArtifacts,
    private readonly opts?: { verboseArtifacts?: boolean; poolRegistry?: HttpPoolRegistry },
  ) {}

  private getCookieHeader(): string | undefined {
    if (this.cookies.size === 0) return undefined;
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  private persistCookieJar(): void {
    const header = this.getCookieHeader();
    if (!header) return;
    fs.writeFileSync(this.artifacts.cookieJar, `${header}\n`, 'utf8');
  }

  private absorbSetCookie(raw: string | string[] | undefined): void {
    if (!raw) return;
    const rows = Array.isArray(raw) ? raw : [raw];
    for (const row of rows) {
      if (typeof row !== 'string') continue;
      const pair = row.split(';', 1)[0]?.trim();
      if (!pair) continue;
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const key = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (!key) continue;
      if (value === '') this.cookies.delete(key);
      else this.cookies.set(key, value);
    }
    this.persistCookieJar();
  }

  async call(params: {
    name: string;
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    url: string;
    body?: unknown;
    contentTypeJson?: boolean;
    redactRequest?: boolean;
    intentPayload?: unknown;
    wirePayload?: unknown;
  }): Promise<ApiCallResult> {
    this.debug('call start name=%s method=%s url=%s', params.name, params.method, params.url);

    const idx = this.artifacts.nextIndex();
    const reqPath = this.artifacts.requestPath(idx, params.name);
    const respPath = this.artifacts.responsePath(idx, params.name);

    let bodyData: string | null = null;
    if (params.body !== undefined) {
      bodyData = JSON.stringify(params.body);
      const toWrite = params.redactRequest === false ? params.body : sanitizeValue(params.body);
      writeJson(reqPath, toWrite);
      this.debug('request body written path=%s body=%O', reqPath, redactDebug(toWrite));
    }

    const startedAt = nowIso();
    const headers: Record<string, string> = {};
    if (params.contentTypeJson !== false) headers['content-type'] = 'application/json';
    const cookieHeader = this.getCookieHeader();
    if (cookieHeader) headers.cookie = cookieHeader;

    const curlPreview = [
      'curl',
      '-sS',
      '-X',
      params.method,
      params.url,
      ...(params.contentTypeJson !== false ? ['-H', 'Content-Type: application/json'] : []),
      ...(cookieHeader ? ['-H', `Cookie: ${cookieHeader}`] : []),
      ...(bodyData !== null ? ['--data-raw', bodyData] : []),
    ];
    const sanitizedCmd = curlPreview;

    const url = new URL(params.url);
    const poolRegistry = this.opts?.poolRegistry ?? getDefaultHttpPoolRegistry();
    const pool = poolRegistry.getForUrl(params.url);

    let code = 0;
    let rawResponse = '';
    let responseJson: JsonValue | unknown = {};
    let endedAt = nowIso();
    try {
      const result = await pool.request({
        method: params.method,
        path: `${url.pathname}${url.search}`,
        headers,
        body: bodyData ?? undefined,
      });
      code = result.statusCode;
      rawResponse = await result.body.text();
      this.absorbSetCookie(result.headers['set-cookie'] as string | string[] | undefined);
      endedAt = nowIso();
      fs.writeFileSync(respPath, rawResponse, 'utf8');

      if (rawResponse.trim().length > 0) {
        try {
          responseJson = JSON.parse(rawResponse);
        } catch {
          responseJson = { _raw: rawResponse };
        }
      }
      this.debug('call done name=%s code=%d responsePath=%s', params.name, code, respPath);
    } catch (error) {
      endedAt = nowIso();
      responseJson = {
        _error: error instanceof Error ? error.message : String(error),
      };
      fs.writeFileSync(respPath, JSON.stringify(responseJson, null, 2), 'utf8');
      this.debug('call failed name=%s error=%O', params.name, redactDebug(responseJson));
    }

    this.artifacts.appendCallLog({
      idx: String(idx).padStart(3, '0'),
      startedAt,
      endedAt,
      name: params.name,
      method: params.method,
      url: params.url,
      requestFile: params.body !== undefined ? reqPath : null,
      responseFile: respPath,
      httpCode: code,
      curl: sanitizedCmd.join(' '),
      ...(this.opts?.verboseArtifacts
        ? {
            intentPayload: sanitizeValue(params.intentPayload),
            wirePayload: sanitizeValue(params.wirePayload ?? params.body),
          }
        : {}),
    });

    if (code === 0) {
      const errorMessage = isJsonObject(responseJson) ? responseJson._error : undefined;
      throw new Error(`HTTP request failed for ${params.name}: ${errorMessage ?? 'unknown error'}`);
    }
    return { code, responsePath: respPath, responseJson };
  }

  require2xx(result: ApiCallResult, label: string): JsonValue | unknown {
    if (result.code < 200 || result.code > 299) {
      this.debug('require2xx failed label=%s code=%d body=%O', label, result.code, redactDebug(result.responseJson));
      throw new Error(`${label} failed with HTTP ${result.code}: ${jsonStringifySafe(result.responseJson)}`);
    }
    this.debug('require2xx ok label=%s code=%d', label, result.code);
    return result.responseJson;
  }
}
