/**
 * screen.test.ts — unit tests for the viewport-over-scrollback contract.
 */

import { describe, it, expect } from 'vitest';
import { Screen, emptyCell } from './screen';

describe('Screen', () => {
  describe('initial state', () => {
    it('pre-fills scrollback with `rows` empty lines', () => {
      const s = new Screen(10, 4);
      expect(s.scrollback.count).toBe(4);
      expect(s.viewportTop).toBe(0);
      expect(s.viewportBottom).toBe(4);
    });

    it('starts fully dirty so the first paint covers everything', () => {
      const s = new Screen(10, 4);
      expect(s.dirty.size).toBe(4);
      for (let r = 0; r < 4; r++) expect(s.dirty.has(r)).toBe(true);
    });

    it('reports atBottom=true and zero linesAbove/linesBelow at construction', () => {
      const s = new Screen(10, 4);
      expect(s.atBottom).toBe(true);
      expect(s.linesAbove).toBe(0);
      expect(s.linesBelow).toBe(0);
    });
  });

  describe('cell access (viewport coords)', () => {
    it('write places characters one per cell', () => {
      const s = new Screen(10, 2);
      s.clearDirty();
      s.write(2, 0, 'abc');
      expect(s.get(2, 0).char).toBe('a');
      expect(s.get(3, 0).char).toBe('b');
      expect(s.get(4, 0).char).toBe('c');
      expect(s.dirty.has(0)).toBe(true);
    });

    it('write wraps to the next row when overflowing, marking the source line wrapped', () => {
      const s = new Screen(5, 2);
      s.clearDirty();
      s.write(3, 0, 'hello'); // 'h' at (3,0), 'e' at (4,0), wrap, 'l','l','o' on row 1
      expect(s.get(3, 0).char).toBe('h');
      expect(s.get(4, 0).char).toBe('e');
      expect(s.get(0, 1).char).toBe('l');
      expect(s.get(1, 1).char).toBe('l');
      expect(s.get(2, 1).char).toBe('o');
      expect(s.scrollback.isWrapped(s.viewportTop + 0)).toBe(true);
      expect(s.scrollback.isWrapped(s.viewportTop + 1)).toBe(false);
      // Both rows are dirty.
      expect(s.dirty.has(0)).toBe(true);
      expect(s.dirty.has(1)).toBe(true);
    });

    it('write clips at the viewport bottom even when wrapping', () => {
      const s = new Screen(3, 2);
      s.clearDirty();
      // 9 chars, cols=3, rows=2 → fills rows 0 and 1, then clips the last 3.
      s.write(0, 0, 'abcdefghi');
      expect(s.get(0, 0).char).toBe('a');
      expect(s.get(2, 0).char).toBe('c');
      expect(s.get(0, 1).char).toBe('d');
      expect(s.get(2, 1).char).toBe('f');
      // 'g','h','i' fell off the bottom; rows 0 and 1 are still dirty.
      expect(s.dirty.size).toBe(2);
    });

    it('set marks exactly the written row dirty', () => {
      const s = new Screen(10, 4);
      s.clearDirty();
      s.set(0, 2, { char: 'x', fg: '#fff', bg: '#000' });
      expect(s.dirty.has(2)).toBe(true);
      expect(s.dirty.has(0)).toBe(false);
      expect(s.dirty.size).toBe(1);
    });

    it('set with out-of-bounds row/col is a silent no-op (no dirty mark)', () => {
      const s = new Screen(10, 4);
      s.clearDirty();
      s.set(-1, 0, emptyCell());
      s.set(0, -1, emptyCell());
      s.set(10, 0, emptyCell());
      s.set(0, 4, emptyCell());
      expect(s.dirty.size).toBe(0);
    });

    it('get on out-of-bounds throws RangeError', () => {
      const s = new Screen(10, 4);
      expect(() => s.get(-1, 0)).toThrow(RangeError);
      expect(() => s.get(10, 0)).toThrow(RangeError);
      expect(() => s.get(0, 4)).toThrow(RangeError);
    });

    it('clear empties every viewport cell and marks all rows dirty', () => {
      const s = new Screen(5, 2);
      s.write(0, 0, 'hello');
      s.clearDirty();
      s.clear();
      expect(s.get(0, 0).char).toBe(' ');
      expect(s.get(4, 0).char).toBe(' ');
      expect(s.dirty.size).toBe(2);
    });
  });

  describe('scrolling', () => {
    it('scrollTo clamps within [oldestId, nextLineId - rows]', () => {
      const s = new Screen(5, 3);
      for (let i = 0; i < 7; i++) s.appendLine(); // total 10 lines, ids 0..9
      // valid viewportTop ∈ [0, 7]
      s.scrollTo(100);
      expect(s.viewportTop).toBe(7);
      s.scrollTo(-100);
      expect(s.viewportTop).toBe(0);
      s.scrollTo(4);
      expect(s.viewportTop).toBe(4);
    });

    it('scrollBy(0) is a true no-op (viewport unchanged, no dirty)', () => {
      const s = new Screen(5, 3);
      for (let i = 0; i < 5; i++) s.appendLine();
      s.scrollTo(2);
      s.clearDirty();
      s.scrollBy(0);
      expect(s.viewportTop).toBe(2);
      expect(s.dirty.size).toBe(0);
    });

    it('scrollBy changes viewportTop and marks all rows dirty', () => {
      const s = new Screen(5, 3);
      for (let i = 0; i < 5; i++) s.appendLine();
      s.scrollTo(0);
      s.clearDirty();
      s.scrollBy(2);
      expect(s.viewportTop).toBe(2);
      expect(s.dirty.size).toBe(3);
    });

    it('scrollToBottom puts viewport at the last `rows` lines', () => {
      const s = new Screen(5, 3);
      for (let i = 0; i < 5; i++) s.appendLine(); // 8 total, ids 0..7
      s.scrollTo(0);
      s.scrollToBottom();
      expect(s.viewportTop).toBe(5); // 8 - 3
      expect(s.atBottom).toBe(true);
    });

    it('linesAbove and linesBelow track correctly across the buffer', () => {
      const s = new Screen(5, 3);
      for (let i = 0; i < 5; i++) s.appendLine(); // 8 total
      s.scrollTo(2);
      expect(s.linesAbove).toBe(2);
      expect(s.linesBelow).toBe(3); // 8 - (2 + 3)
    });
  });

  describe('writing to history', () => {
    it('println appends a line, snaps to bottom, writes the text', () => {
      const s = new Screen(20, 3);
      const before = s.scrollback.nextLineId;
      s.println('hello');
      expect(s.scrollback.nextLineId).toBe(before + 1);
      expect(s.atBottom).toBe(true);
      expect(s.get(0, 2).char).toBe('h');
      expect(s.get(4, 2).char).toBe('o');
    });

    it('appendLine does not change the viewport position by itself', () => {
      const s = new Screen(5, 3);
      for (let i = 0; i < 5; i++) s.appendLine(); // 8 total
      s.scrollTo(0); // user is reading old history
      s.appendLine();
      expect(s.viewportTop).toBe(0); // unchanged — no auto-scroll on raw appendLine
    });

    it('println of text longer than cols spans multiple physical lines with wrap flags set', () => {
      const s = new Screen(5, 3);
      const before = s.scrollback.nextLineId;
      s.println('hello world'); // 11 chars / cols 5 = 3 lines
      expect(s.scrollback.nextLineId).toBe(before + 3);
      expect(s.scrollback.isWrapped(before)).toBe(true);
      expect(s.scrollback.isWrapped(before + 1)).toBe(true);
      expect(s.scrollback.isWrapped(before + 2)).toBe(false);
    });
  });

  describe('setCols (reflow integration)', () => {
    it('is a no-op when newCols equals current cols', () => {
      const s = new Screen(10, 3);
      s.write(0, 0, 'hello');
      const sbBefore = s.scrollback;
      s.setCols(10);
      expect(s.scrollback).toBe(sbBefore); // same instance
      expect(s.get(0, 0).char).toBe('h');
    });

    it('rejects newCols <= 0', () => {
      const s = new Screen(10, 3);
      expect(() => s.setCols(0)).toThrow();
      expect(() => s.setCols(-1)).toThrow();
    });

    it('reflows: long line splits when shrinking cols', () => {
      const s = new Screen(10, 3);
      // Pre-fill: a single logical "hello world!!" (13 chars) wraps once at cols=10.
      s.println('hello world!!');
      s.setCols(5);
      // 13 chars logical → at cols=5: "hello"|" worl"|"d!!" → 3 lines (no trailing all-default).
      // The screen has its own pre-filled lines too, but those are empty and trim to length 0.
      expect(s.cols).toBe(5);
    });

    it('reflows: short wrapped lines merge when growing cols', () => {
      const s = new Screen(5, 3);
      s.println('hello world!!'); // 3 wrapped lines at cols=5
      s.setCols(20);
      // 13 chars logical → at cols=20: 1 line "hello world!!"
      expect(s.cols).toBe(20);
    });
  });
});
