/**
 * Normalized HTTP response returned by `HttpTransport`.
 */
export interface HttpResponse {
  /** Numeric HTTP status code. */
  status: number;

  /**
   * Parsed response payload.
   *
   * When the response body contains JSON, this is the parsed JSON value.
   * Callers may also supply `null` or another explicit shape for empty
   * responses when constructing `HttpResponse` manually in tests or helpers.
   */
  body: unknown;
}

/** Supported HTTP methods for dispatch's built-in transport. */
export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/**
 * Per-request transport options.
 */
export interface HttpRequestOptions {
  /**
   * Extra request headers.
   *
   * These are merged onto the transport's default headers, and per-request
   * values override headers inherited from `ctx.http` or `withDefaults(...)`.
   */
  headers?: Record<string, string>;
}
