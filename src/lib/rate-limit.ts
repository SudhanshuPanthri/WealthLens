/**
 * In-process rate limiting and a concurrency gate for expensive work (LLM calls).
 * Single-instance; for multi-instance use a shared store (Redis INCR + EXPIRE)
 * behind the same `rateLimit()` contract.
 */

interface Window {
  count: number;
  resetAt: number;
}
const windows = new Map<string, Window>();

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterMs: number;
}

/** Fixed-window limiter. Returns ok=false once `limit` is hit within `windowMs`. */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const w = windows.get(key);
  if (!w || now >= w.resetAt) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfterMs: 0 };
  }
  if (w.count >= limit) {
    return { ok: false, remaining: 0, retryAfterMs: w.resetAt - now };
  }
  w.count++;
  return { ok: true, remaining: limit - w.count, retryAfterMs: 0 };
}

/**
 * Bounded-concurrency queue. `run()` waits for a free slot, so a burst of
 * insight requests can't fire dozens of simultaneous LLM calls.
 */
export class Semaphore {
  private active = 0;
  private queue: (() => void)[] = [];

  constructor(private readonly max: number) {}

  private acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  private release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) {
      this.active++;
      next();
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

// Cap concurrent LLM generations across the process (override with LLM_CONCURRENCY).
export const llmQueue = new Semaphore(Math.max(1, Number(process.env.LLM_CONCURRENCY) || 2));
