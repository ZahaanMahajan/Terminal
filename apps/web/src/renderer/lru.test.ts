/**
 * lru.test.ts — the LRU eviction algorithm, by invariant.
 */

import { describe, it, expect } from 'vitest';
import { LruCache } from './lru';

describe('LruCache', () => {
  it('stores and retrieves values', () => {
    const c = new LruCache<string, number>(4);
    c.set('a', 1);
    expect(c.get('a')).toBe(1);
    expect(c.has('a')).toBe(true);
    expect(c.size).toBe(1);
  });

  it('returns undefined for absent keys', () => {
    const c = new LruCache<string, number>(4);
    expect(c.get('missing')).toBeUndefined();
  });

  it('rejects maxEntries <= 0', () => {
    expect(() => new LruCache<string, number>(0)).toThrow();
    expect(() => new LruCache<string, number>(-1)).toThrow();
  });

  it('evicts the least-recently-used entry when over capacity', () => {
    const c = new LruCache<string, number>(2);
    c.set('a', 1);
    c.set('b', 2);
    c.set('c', 3); // 'a' is LRU → evicted
    expect(c.has('a')).toBe(false);
    expect(c.has('b')).toBe(true);
    expect(c.has('c')).toBe(true);
    expect(c.size).toBe(2);
  });

  it('get() refreshes recency, protecting an entry from the next eviction', () => {
    const c = new LruCache<string, number>(2);
    c.set('a', 1);
    c.set('b', 2);
    c.get('a'); // 'a' is now MRU; 'b' is LRU
    c.set('c', 3); // evicts 'b', not 'a'
    expect(c.has('a')).toBe(true);
    expect(c.has('b')).toBe(false);
    expect(c.has('c')).toBe(true);
  });

  it('set() on an existing key updates the value and refreshes recency', () => {
    const c = new LruCache<string, number>(2);
    c.set('a', 1);
    c.set('b', 2);
    c.set('a', 99); // update + refresh; 'b' is now LRU
    expect(c.get('a')).toBe(99);
    c.set('c', 3); // evicts 'b'
    expect(c.has('b')).toBe(false);
    expect(c.has('a')).toBe(true);
  });

  it('clear() empties the cache', () => {
    const c = new LruCache<string, number>(4);
    c.set('a', 1);
    c.set('b', 2);
    c.clear();
    expect(c.size).toBe(0);
    expect(c.has('a')).toBe(false);
  });
});
