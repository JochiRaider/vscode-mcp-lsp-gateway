import { stableJsonStringify } from '../../util/stableStringify.js';
import { utf8ByteLength } from '../../util/responseSize.js';

type CacheEntry<T> = Readonly<{
  value: T;
  sizeBytes: number;
  expiresAt?: number;
}>;

export type LruCacheOptions<T> = Readonly<{
  perEntryCapBytes: number;
  totalCapBytes: number;
  ttlMs: number;
  now?: () => number;
  sizeOf?: (value: T) => number;
}>;

export type LruCacheSetResult = Readonly<{ stored: boolean; sizeBytes: number }>;

export class LruCache<K, V> {
  private readonly entries = new Map<K, CacheEntry<V>>();
  private totalBytes = 0;
  private readonly perEntryCapBytes: number;
  private readonly totalCapBytes: number;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly sizeOf: (value: V) => number;

  public constructor(opts: LruCacheOptions<V>) {
    this.perEntryCapBytes = Math.max(0, Math.floor(opts.perEntryCapBytes));
    this.totalCapBytes = Math.max(0, Math.floor(opts.totalCapBytes));
    this.ttlMs = Math.max(0, Math.floor(opts.ttlMs));
    this.now = opts.now ?? Date.now;
    this.sizeOf = opts.sizeOf ?? defaultSizeOf;
  }

  public get size(): number {
    return this.entries.size;
  }

  public get sizeBytes(): number {
    return this.totalBytes;
  }

  public get(key: K): V | undefined {
    const now = this.now();
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (isExpired(entry, now)) {
      this.deleteEntry(key, entry);
      return undefined;
    }
    this.touch(key, entry);
    return entry.value;
  }

  public set(key: K, value: V): LruCacheSetResult {
    const now = this.now();
    this.evictExpired(now);

    const sizeBytes = normalizeSizeBytes(this.sizeOf(value));
    if (this.perEntryCapBytes <= 0 || this.totalCapBytes <= 0) {
      this.deleteIfPresent(key);
      return { stored: false, sizeBytes };
    }
    if (sizeBytes > this.perEntryCapBytes) {
      this.deleteIfPresent(key);
      return { stored: false, sizeBytes };
    }

    const existing = this.entries.get(key);
    if (existing) this.deleteEntry(key, existing);

    const entry: CacheEntry<V> =
      this.ttlMs > 0 ? { value, sizeBytes, expiresAt: now + this.ttlMs } : { value, sizeBytes };
    this.entries.set(key, entry);
    this.totalBytes += sizeBytes;

    this.evictToCapacity();
    return { stored: true, sizeBytes };
  }

  public clear(): void {
    this.entries.clear();
    this.totalBytes = 0;
  }

  private deleteIfPresent(key: K): void {
    const entry = this.entries.get(key);
    if (entry) this.deleteEntry(key, entry);
  }

  private deleteEntry(key: K, entry: CacheEntry<V>): void {
    this.entries.delete(key);
    this.totalBytes -= entry.sizeBytes;
  }

  private touch(key: K, entry: CacheEntry<V>): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
  }

  private evictExpired(now: number): void {
    for (const [key, entry] of this.entries.entries()) {
      if (isExpired(entry, now)) this.deleteEntry(key, entry);
    }
  }

  private evictToCapacity(): void {
    while (this.totalBytes > this.totalCapBytes && this.entries.size > 0) {
      const first = this.entries.entries().next();
      if (first.done) break;
      const [key, entry] = first.value;
      this.deleteEntry(key, entry);
    }
  }
}

function defaultSizeOf(value: unknown): number {
  return utf8ByteLength(stableJsonStringify(value));
}

function normalizeSizeBytes(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function isExpired<T>(entry: CacheEntry<T>, now: number): boolean {
  return entry.expiresAt !== undefined && entry.expiresAt <= now;
}
