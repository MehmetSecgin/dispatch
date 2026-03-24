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

/**
 * HTTP client used inside action handlers.
 *
 * The transport is provided through `ctx.http`. It is preconfigured from the
 * job's top-level `http` block, keeps a shared cookie jar across the whole
 * run, and records requests and responses into run artifacts automatically.
 *
 * Module authors receive this interface — they never construct the underlying
 * implementation directly.
 */
export interface HttpTransport {
  /**
   * Create a derived transport with narrowed defaults.
   *
   * The derived transport shares the same cookie jar, connection pools, and
   * artifact recording as the original transport.
   */
  withDefaults(opts?: { baseUrl?: string; defaultHeaders?: Record<string, string> }): HttpTransport;

  /** Send a GET request. Relative URLs resolve against `baseUrl`. */
  get(url: string, opts?: HttpRequestOptions): Promise<HttpResponse>;

  /** Send a POST request with an optional JSON body. */
  post(url: string, body?: unknown, opts?: HttpRequestOptions): Promise<HttpResponse>;

  /** Send a PUT request with an optional JSON body. */
  put(url: string, body?: unknown, opts?: HttpRequestOptions): Promise<HttpResponse>;

  /** Send a PATCH request with an optional JSON body. */
  patch(url: string, body?: unknown, opts?: HttpRequestOptions): Promise<HttpResponse>;

  /** Send a DELETE request. */
  delete(url: string, opts?: HttpRequestOptions): Promise<HttpResponse>;

  /**
   * Send a request with explicit method control.
   *
   * URLs may be absolute, or relative when the transport has a `baseUrl`.
   * Request and response artifacts are recorded automatically.
   */
  request(method: HttpMethod, url: string, opts?: HttpRequestOptions & { body?: unknown }): Promise<HttpResponse>;

  /**
   * Assert that a response has a 2xx status code.
   *
   * On success, this returns `response.body`, which is typically the parsed
   * JSON body from the transport. On failure, it throws an error that includes
   * the provided label and the response status code.
   */
  requireOk(response: HttpResponse, label: string): unknown;
}
