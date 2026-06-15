/**
 * In-process TTL cache. Single-instance only.
 *
 * To scale horizontally, implement the same `cached()` / `get()` / `set()`
 * contract against Redis and export that instance instead — every caller goes
 * through this module, so nothing else changes (see ARCHITECTURE §Scaling).
 */
export interface CacheEntry<T> {
  value: T;
  at: number;
}

export class TTLCache {
  private store = new Map<string, CacheEntry<unknown>>();

  /** Run `fn` unless a fresh value is cached. On failure, serve a stale value if present. */
  async cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
    const hit = this.store.get(key) as CacheEntry<T> | undefined;
    if (hit && Date.now() - hit.at < ttlMs) return hit.value;
    try {
      const value = await fn();
      this.store.set(key, { value, at: Date.now() });
      return value;
    } catch (err) {
      if (hit) return hit.value; // serve stale on failure
      throw err;
    }
  }

  get<T>(key: string): CacheEntry<T> | undefined {
    return this.store.get(key) as CacheEntry<T> | undefined;
  }

  set<T>(key: string, value: T): void {
    this.store.set(key, { value, at: Date.now() });
  }

  delete(key: string): void {
    this.store.delete(key);
  }
}

// Shared instance for public market data (indices, movers, funds).
export const marketCache = new TTLCache();
