import { LruCache } from './lruCache.js';

const PAGED_FULL_SET_PER_ENTRY_CAP_BYTES = 2 * 1024 * 1024;
const PAGED_FULL_SET_TOTAL_CAP_BYTES = 20 * 1024 * 1024;
const PAGED_FULL_SET_TTL_MS = 10_000;
const UNPAGED_PER_ENTRY_CAP_BYTES = 1 * 1024 * 1024;
const UNPAGED_TOTAL_CAP_BYTES = 5 * 1024 * 1024;

export class ToolRuntime {
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly unpagedCaches = new Map<string, LruCache<string, unknown>>();
  public readonly pagedFullSetCache = new LruCache<string, unknown>({
    perEntryCapBytes: PAGED_FULL_SET_PER_ENTRY_CAP_BYTES,
    totalCapBytes: PAGED_FULL_SET_TOTAL_CAP_BYTES,
    ttlMs: PAGED_FULL_SET_TTL_MS,
  });

  public async singleflight<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key) as Promise<T> | undefined;
    if (existing) return existing;

    const pending = Promise.resolve()
      .then(fn)
      .finally(() => {
        const current = this.inFlight.get(key);
        if (current === pending) this.inFlight.delete(key);
      });

    this.inFlight.set(key, pending);
    return pending;
  }

  public getUnpagedCache(toolName: string): LruCache<string, unknown> {
    const existing = this.unpagedCaches.get(toolName);
    if (existing) return existing;
    const cache = new LruCache<string, unknown>({
      perEntryCapBytes: UNPAGED_PER_ENTRY_CAP_BYTES,
      totalCapBytes: UNPAGED_TOTAL_CAP_BYTES,
      ttlMs: 0,
    });
    this.unpagedCaches.set(toolName, cache);
    return cache;
  }

  public dispose(): void {
    this.inFlight.clear();
    this.pagedFullSetCache.clear();
    for (const cache of this.unpagedCaches.values()) {
      cache.clear();
    }
    this.unpagedCaches.clear();
  }
}
