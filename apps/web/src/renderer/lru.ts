/**
 * renderer/lru.ts — a tiny, generic LRU cache.
 *
 * Backed by a single `Map`, exploiting the fact that JS `Map` preserves *insertion order*:
 *   - The first key in iteration order is the least-recently-used.
 *   - `get` deletes-then-reinserts the entry, moving it to the end (most-recently-used).
 *   - `set` evicts from the front when over capacity.
 *
 * This is the whole algorithm — no doubly-linked list, no timestamps. It's O(1) per op because
 * Map delete + set are O(1) and `keys().next()` gives the front key without iterating.
 *
 * Pure (no DOM), so it's exhaustively unit-testable. The glyph cache composes this with a
 * canvas renderer (glyph-cache.ts).
 */

export class LruCache<K, V> {
  private readonly map = new Map<K, V>();
  private readonly maxEntries: number;

  constructor(maxEntries: number) {
    if (maxEntries <= 0) throw new Error('LruCache: maxEntries must be > 0');
    this.maxEntries = maxEntries;
  }

  get size(): number {
    return this.map.size;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  /** Returns the value and marks it most-recently-used, or `undefined` if absent. */
  get(key: K): V | undefined {
    const v = this.map.get(key);
    if (v === undefined) return undefined;
    // Re-insert to move to the back (most-recently-used).
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  /** Insert or update; evicts the least-recently-used entries if over capacity. */
  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value as K;
      this.map.delete(oldest);
    }
  }

  clear(): void {
    this.map.clear();
  }
}
