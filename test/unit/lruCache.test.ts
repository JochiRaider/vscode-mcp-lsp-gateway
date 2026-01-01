import { expect } from 'chai';
import { LruCache } from '../../src/tools/runtime/lruCache.js';

describe('LruCache', () => {
  it('evicts least-recently-used entries deterministically', () => {
    const cache = new LruCache<string, { size: number }>({
      perEntryCapBytes: 100,
      totalCapBytes: 10,
      ttlMs: 10_000,
      now: () => 0,
      sizeOf: (value) => value.size,
    });

    cache.set('a', { size: 5 });
    cache.set('b', { size: 5 });
    cache.get('a');
    cache.set('c', { size: 5 });

    expect(cache.get('b')).to.equal(undefined);
    expect(cache.get('a')).to.not.equal(undefined);
    expect(cache.get('c')).to.not.equal(undefined);
  });

  it('expires entries by TTL on access', () => {
    let now = 0;
    const cache = new LruCache<string, { size: number }>({
      perEntryCapBytes: 100,
      totalCapBytes: 100,
      ttlMs: 10,
      now: () => now,
      sizeOf: (value) => value.size,
    });

    cache.set('a', { size: 1 });
    expect(cache.get('a')).to.not.equal(undefined);

    now = 11;
    expect(cache.get('a')).to.equal(undefined);
    expect(cache.size).to.equal(0);
  });

  it('skips caching when per-entry cap is exceeded', () => {
    const cache = new LruCache<string, { payload: string }>({
      perEntryCapBytes: 10,
      totalCapBytes: 100,
      ttlMs: 10_000,
    });

    const res = cache.set('a', { payload: 'x'.repeat(100) });
    expect(res.stored).to.equal(false);
    expect(cache.get('a')).to.equal(undefined);
    expect(cache.size).to.equal(0);
  });
});
