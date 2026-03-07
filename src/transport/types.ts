export interface HttpResponse {
  status: number;
  body: unknown;
}

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface HttpRequestOptions {
  headers?: Record<string, string>;
}
