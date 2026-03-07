import { Pool } from 'undici';

interface HttpPoolOptions {
  connections?: number;
  pipelining?: number;
  headersTimeoutMs?: number;
  bodyTimeoutMs?: number;
}

const DEFAULT_POOL_OPTIONS: Required<HttpPoolOptions> = {
  connections: 20,
  pipelining: 1,
  headersTimeoutMs: 30_000,
  bodyTimeoutMs: 30_000,
};

export class HttpPoolRegistry {
  private readonly pools = new Map<string, Pool>();
  private readonly options: Required<HttpPoolOptions>;

  constructor(options: HttpPoolOptions = {}) {
    this.options = { ...DEFAULT_POOL_OPTIONS, ...options };
  }

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

export function getDefaultHttpPoolRegistry(): HttpPoolRegistry {
  if (!defaultRegistry) defaultRegistry = new HttpPoolRegistry();
  return defaultRegistry;
}
