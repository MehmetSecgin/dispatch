import { Pool } from 'undici';

/**
 * Low-level connection pool tuning for `HttpTransport`.
 *
 * Most module authors do not need to touch this. Dispatch uses it internally
 * to reuse Undici pools across requests to the same origin.
 */
interface HttpPoolOptions {
  /** Maximum concurrent connections per origin. */
  connections?: number;

  /** Number of pipelined requests allowed per connection. */
  pipelining?: number;

  /** Response-header timeout in milliseconds. */
  headersTimeoutMs?: number;

  /** Response-body timeout in milliseconds. */
  bodyTimeoutMs?: number;
}

const DEFAULT_POOL_OPTIONS: Required<HttpPoolOptions> = {
  connections: 20,
  pipelining: 1,
  headersTimeoutMs: 30_000,
  bodyTimeoutMs: 30_000,
};

/**
 * Shared registry of Undici pools keyed by request origin.
 *
 * `HttpTransport` uses this so multiple requests to the same host can reuse
 * the same connection pool during a run.
 */
export class HttpPoolRegistry {
  private readonly pools = new Map<string, Pool>();
  private readonly options: Required<HttpPoolOptions>;

  constructor(options: HttpPoolOptions = {}) {
    this.options = { ...DEFAULT_POOL_OPTIONS, ...options };
  }

  /**
   * Get or create a pool for the URL's origin.
   */
  getForUrl(url: string): Pool {
    const origin = new URL(url).origin;
    const existing = this.pools.get(origin);
    if (existing) return existing;
    const pool = new Pool(origin, {
      connections: this.options.connections,
      pipelining: this.options.pipelining,
      headersTimeout: this.options.headersTimeoutMs,
      bodyTimeout: this.options.bodyTimeoutMs,
    });
    this.pools.set(origin, pool);
    return pool;
  }

  /**
   * Best-effort shutdown for all tracked pools.
   */
  async closeAll(): Promise<void> {
    await Promise.all(
      Array.from(this.pools.values()).map(async (pool) => {
        try {
          await pool.close();
        } catch {
          // ignore close errors for best-effort shutdown
        }
      }),
    );
    this.pools.clear();
  }
}

let defaultRegistry: HttpPoolRegistry | null = null;

/**
 * Process-wide default pool registry used by `HttpTransport`.
 */
export function getDefaultHttpPoolRegistry(): HttpPoolRegistry {
  if (!defaultRegistry) defaultRegistry = new HttpPoolRegistry();
  return defaultRegistry;
}
