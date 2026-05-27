/**
 * reflow.test.ts — unit tests for the logical-line reflow algorithm.
 *
 * Each test sets up a small source Scrollback (sometimes with wrapped lines, sometimes a
 * cursor), runs `reflowScrollback`, and asserts on the resulting Scrollback's contents and on
 * any cursor remap.
 */

import { describe, it, expect } from 'vitest';
import { Scrollback } from './scrollback';
import { reflowScrollback } from './reflow';
import { makeCursor } from './cursor';
import { DEFAULT_FG, DEFAULT_BG } from './cell';

/** Read the printable characters from a line, trimming trailing fully-default cells. */
function lineText(sb: Scrollback, id: number): string {
  const line = sb.getLine(id);
  if (!line) return '';
  let end = line.length;
  while (end > 0) {
    const c = line[end - 1];
    if (c.char === ' ' && c.fg === DEFAULT_FG && c.bg === DEFAULT_BG) end--;
    else break;
  }
  return line.slice(0, end).map(c => c.char).join('');
}

/** Write a string into a single line; sets wrap if requested. */
function fillLine(sb: Scrollback, id: number, text: string, wrap = false): void {
  for (let i = 0; i < text.length; i++) {
    sb.setCell(id, i, { char: text[i], fg: DEFAULT_FG, bg: DEFAULT_BG });
  }
  sb.setWrapped(id, wrap);
}

describe('reflowScrollback', () => {
  it('returns the same instance when newCols === src.cols', () => {
    const src = new Scrollback(10, 100);
    src.appendLine();
    const out = reflowScrollback(src, 10);
    expect(out).toBe(src);
  });

  it('rejects newCols <= 0', () => {
    const src = new Scrollback(10, 100);
    expect(() => reflowScrollback(src, 0)).toThrow();
    expect(() => reflowScrollback(src, -1)).toThrow();
  });

  it('shrinking cols re-splits a wrapped logical line into more physical lines', () => {
    // logical: "hello world!!" (13 chars) → at cols=10: 2 lines wrapped once
    const src = new Scrollback(10, 100);
    const a = src.appendLine(); fillLine(src, a, 'hello worl', true);
    const b = src.appendLine(); fillLine(src, b, 'd!!');

    const out = reflowScrollback(src, 5);
    // At cols=5: "hello"|" worl"|"d!!" → 3 lines, first two wrapped.
    expect(out.count).toBe(3);
    expect(lineText(out, 0)).toBe('hello');
    expect(lineText(out, 1)).toBe(' worl');
    expect(lineText(out, 2)).toBe('d!!');
    expect(out.isWrapped(0)).toBe(true);
    expect(out.isWrapped(1)).toBe(true);
    expect(out.isWrapped(2)).toBe(false);
  });

  it('growing cols merges wrapped lines into fewer physical lines', () => {
    // src at cols=5: 3 wrapped lines for "hello world!!"
    const src = new Scrollback(5, 100);
    const a = src.appendLine(); fillLine(src, a, 'hello', true);
    const b = src.appendLine(); fillLine(src, b, ' worl', true);
    const c = src.appendLine(); fillLine(src, c, 'd!!');

    const out = reflowScrollback(src, 20);
    // At cols=20: 1 line "hello world!!" (13 chars), no wrap.
    expect(out.count).toBe(1);
    expect(lineText(out, 0)).toBe('hello world!!');
    expect(out.isWrapped(0)).toBe(false);
  });

  it('preserves separate logical lines (non-wrapped) independently', () => {
    const src = new Scrollback(5, 100);
    const a = src.appendLine(); fillLine(src, a, 'abc');         // no wrap
    const b = src.appendLine(); fillLine(src, b, 'xyzAB', true); // wraps
    const c = src.appendLine(); fillLine(src, c, 'CD');          // continuation
    const out = reflowScrollback(src, 10);
    expect(out.count).toBe(2);
    expect(lineText(out, 0)).toBe('abc');
    expect(lineText(out, 1)).toBe('xyzABCD');
    expect(out.isWrapped(0)).toBe(false);
    expect(out.isWrapped(1)).toBe(false);
  });

  it('trims trailing fully-default cells before reflowing', () => {
    // A line with only "abc" written + 7 default trailing cells; no wrap.
    const src = new Scrollback(10, 100);
    const a = src.appendLine(); fillLine(src, a, 'abc');
    const out = reflowScrollback(src, 5);
    // Should not produce a second all-empty line for the 7 trailing default cells.
    expect(out.count).toBe(1);
    expect(lineText(out, 0)).toBe('abc');
  });

  it('an empty logical line becomes one empty physical line', () => {
    const src = new Scrollback(10, 100);
    src.appendLine(); // all-default cells, no wrap
    const out = reflowScrollback(src, 5);
    expect(out.count).toBe(1);
    expect(out.isWrapped(0)).toBe(false);
    expect(lineText(out, 0)).toBe('');
  });

  it('remaps a cursor sitting on a wrapped continuation line', () => {
    // src cols=10: "hello worl"|"d!!" wraps once. Cursor at (id=1, col=2) → on the 2nd '!'.
    // Logical col = 10 + 2 = 12. At cols=5: chunks at positions [0,5)|[5,10)|[10,13).
    //   pos 12 falls in chunk 2 (pos 10..12), col within chunk = 2.
    const src = new Scrollback(10, 100);
    const a = src.appendLine(); fillLine(src, a, 'hello worl', true);
    const b = src.appendLine(); fillLine(src, b, 'd!!');
    const cursor = makeCursor(2, b);
    const out = reflowScrollback(src, 5, cursor);
    expect(out.count).toBe(3);
    expect(cursor.lineId).toBe(2); // third physical line in the new buffer
    expect(cursor.col).toBe(2);
  });

  it('cursor sitting on trimmed trailing padding snaps to end-of-content', () => {
    // "abc" with cursor on col 5 (the 3rd trailing space). Logical col before trim = 5.
    // After trim cells.length = 3; cursor logical col is clamped to 3 (end-of-content).
    // We reflow to a *different* newCols so the algorithm actually runs (same-cols is a no-op).
    const src = new Scrollback(10, 100);
    const a = src.appendLine(); fillLine(src, a, 'abc');
    const cursor = makeCursor(5, a);
    const out = reflowScrollback(src, 20, cursor);
    expect(out.count).toBe(1);
    expect(cursor.lineId).toBe(0);
    expect(cursor.col).toBe(3); // just past 'c'
  });

  it('cursor on an empty line stays at col 0', () => {
    const src = new Scrollback(10, 100);
    const a = src.appendLine();
    const cursor = makeCursor(0, a);
    const out = reflowScrollback(src, 5, cursor);
    expect(cursor.lineId).toBe(0);
    expect(cursor.col).toBe(0);
    expect(out.count).toBe(1);
  });

  it('dangling wrap on the last source line is treated as a terminator (no infinite loop)', () => {
    const src = new Scrollback(5, 100);
    const a = src.appendLine(); fillLine(src, a, 'hi', true); // dangles
    const out = reflowScrollback(src, 10);
    expect(out.count).toBe(1);
    expect(lineText(out, 0)).toBe('hi');
    expect(out.isWrapped(0)).toBe(false);
  });

  it('preserves the capacity of the source', () => {
    const src = new Scrollback(5, 42);
    src.appendLine();
    const out = reflowScrollback(src, 10);
    expect(out.capacity).toBe(42);
  });
});
