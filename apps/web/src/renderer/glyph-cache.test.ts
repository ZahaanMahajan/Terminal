/**
 * glyph-cache.test.ts — key generation + cache behavior (DOM-free, injected renderer).
 */

import { describe, it, expect } from 'vitest';
import { GlyphCache, glyphKey, type GlyphRenderer } from './glyph-cache';
import type { Cell } from './cell';
import type { CellMetrics } from './index';

const M = {} as CellMetrics; // renderer is faked; metrics are unused by the fake

/** A fake renderer that returns a unique tagged object per call and counts invocations. */
function countingRenderer(): { renderer: GlyphRenderer; calls: () => number } {
  let n = 0;
  const renderer: GlyphRenderer = () => ({ id: n++ }) as unknown as CanvasImageSource;
  return { renderer, calls: () => n };
}

const cell = (char: string, fg = '#fff', bg = '#000', attrs?: number): Cell =>
  attrs === undefined ? { char, fg, bg } : { char, fg, bg, attrs };

describe('glyphKey', () => {
  it('is stable for equal cells', () => {
    expect(glyphKey(cell('a'))).toBe(glyphKey(cell('a')));
  });

  it('distinguishes char, fg, bg, and attrs', () => {
    const base = glyphKey(cell('a', '#fff', '#000', 1));
    expect(base).not.toBe(glyphKey(cell('b', '#fff', '#000', 1)));
    expect(base).not.toBe(glyphKey(cell('a', '#eee', '#000', 1)));
    expect(base).not.toBe(glyphKey(cell('a', '#fff', '#111', 1)));
    expect(base).not.toBe(glyphKey(cell('a', '#fff', '#000', 2)));
  });

  it('treats missing attrs as 0', () => {
    expect(glyphKey(cell('a'))).toBe(glyphKey(cell('a', '#fff', '#000', 0)));
  });

  it('does not collide across fg/bg boundary (NUL separator)', () => {
    // Without a separator, ("#a","bc") and ("#ab","c") could collide.
    expect(glyphKey(cell('x', '#a', 'bc'))).not.toBe(glyphKey(cell('x', '#ab', 'c')));
  });
});

describe('GlyphCache', () => {
  it('renders on miss, reuses the same bitmap on hit', () => {
    const { renderer, calls } = countingRenderer();
    const cache = new GlyphCache(renderer, 10);
    const a1 = cache.getOrRender(cell('a'), M);
    const a2 = cache.getOrRender(cell('a'), M);
    expect(a1).toBe(a2);
    expect(calls()).toBe(1);
    expect(cache.hits).toBe(1);
    expect(cache.misses).toBe(1);
  });

  it('distinct cells produce distinct bitmaps', () => {
    const { renderer } = countingRenderer();
    const cache = new GlyphCache(renderer, 10);
    const a = cache.getOrRender(cell('a'), M);
    const b = cache.getOrRender(cell('b'), M);
    expect(a).not.toBe(b);
    expect(cache.size).toBe(2);
  });

  it('evicts per maxEntries and re-renders an evicted cell', () => {
    const { renderer, calls } = countingRenderer();
    const cache = new GlyphCache(renderer, 2);
    cache.getOrRender(cell('a'), M); // miss
    cache.getOrRender(cell('b'), M); // miss
    cache.getOrRender(cell('c'), M); // miss → evicts 'a'
    expect(cache.size).toBe(2);
    cache.getOrRender(cell('a'), M); // miss again (was evicted)
    expect(calls()).toBe(4);
    expect(cache.misses).toBe(4);
    expect(cache.hits).toBe(0);
  });

  it('clear() resets bitmaps and counters', () => {
    const { renderer } = countingRenderer();
    const cache = new GlyphCache(renderer, 10);
    cache.getOrRender(cell('a'), M);
    cache.getOrRender(cell('a'), M);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.hits).toBe(0);
    expect(cache.misses).toBe(0);
  });
});
