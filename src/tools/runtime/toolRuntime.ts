import { LruCache } from './lruCache.js';

const PAGED_FULL_SET_PER_ENTRY_CAP_BYTES = 2 * 1024 * 1024;
const PAGED_FULL_SET_TOTAL_CAP_BYTES = 20 * 1024 * 1024;
const PAGED_FULL_SET_TTL_MS = 10_000;

export class ToolRuntime {
  private readonly inFlight = new Map<string, Promise<unknown>>();
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

  public dispose(): void {
    this.inFlight.clear();
    this.pagedFullSetCache.clear();
  }
}
