/**
 * scrollback.test.ts — unit tests for the ring-buffer invariants.
 *
 * The tests are organized by the property they pin down. Each "it" name is the invariant; if
 * one fails, the failure message tells you which contract broke.
 */

import { describe, it, expect } from 'vitest';
import { Scrollback } from './scrollback';
import { emptyCell } from './cell';

describe('Scrollback', () => {
  describe('initial state', () => {
    it('starts empty: count, oldestId, nextLineId all zero', () => {
      const sb = new Scrollback(80, 100);
      expect(sb.count).toBe(0);
      expect(sb.oldestId).toBe(0);
      expect(sb.nextLineId).toBe(0);
    });

    it('rejects non-positive cols or capacity', () => {
      expect(() => new Scrollback(0)).toThrow();
      expect(() => new Scrollback(80, 0)).toThrow();
      expect(() => new Scrollback(-1)).toThrow();
      expect(() => new Scrollback(80, -1)).toThrow();
    });
  });

  describe('appendLine', () => {
    it('assigns monotonically increasing ids starting at 0', () => {
      const sb = new Scrollback(80, 100);
      expect(sb.appendLine()).toBe(0);
      expect(sb.appendLine()).toBe(1);
      expect(sb.appendLine()).toBe(2);
    });

    it('tracks count up to capacity', () => {
      const sb = new Scrollback(80, 3);
      sb.appendLine(); expect(sb.count).toBe(1);
      sb.appendLine(); expect(sb.count).toBe(2);
      sb.appendLine(); expect(sb.count).toBe(3);
    });

    it('evicts oldest at capacity; count stays at capacity, oldestId advances', () => {
      const sb = new Scrollback(80, 3);
      sb.appendLine(); sb.appendLine(); sb.appendLine(); // ids 0, 1, 2
      sb.appendLine();                                    // id 3, evicts id 0
      expect(sb.count).toBe(3);
      expect(sb.oldestId).toBe(1);
      expect(sb.nextLineId).toBe(4);
    });

    it('returns the new line filled with empty cells', () => {
      const sb = new Scrollback(5, 2);
      const id = sb.appendLine();
      const line = sb.getLine(id);
      expect(line).not.toBeNull();
      expect(line).toHaveLength(5);
      expect(line![0]).toEqual(emptyCell());
    });
  });

  describe('getLine', () => {
    it('returns the live line reference for a valid id', () => {
      const sb = new Scrollback(80, 100);
      const id = sb.appendLine();
      const line = sb.getLine(id);
      expect(line).not.toBeNull();
      expect(line).toHaveLength(80);
    });

    it('returns null for evicted ids', () => {
      const sb = new Scrollback(80, 3);
      sb.appendLine(); sb.appendLine(); sb.appendLine(); sb.appendLine();
      expect(sb.getLine(0)).toBeNull();
      expect(sb.getLine(1)).not.toBeNull();
    });

    it('returns null for future (not-yet-appended) ids', () => {
      const sb = new Scrollback(80, 100);
      sb.appendLine();
      expect(sb.getLine(5)).toBeNull();
    });
  });

  describe('cell access', () => {
    it('setCell mutates the line; getCell reads it back', () => {
      const sb = new Scrollback(10, 5);
      const id = sb.appendLine();
      const cell = { char: 'X', fg: '#fff', bg: '#000' };
      sb.setCell(id, 3, cell);
      expect(sb.getCell(id, 3)).toEqual(cell);
    });

    it('setCell on an evicted line is a silent no-op (no throw)', () => {
      const sb = new Scrollback(10, 2);
      sb.appendLine(); sb.appendLine(); sb.appendLine();
      // id 0 is evicted — this must not throw.
      expect(() =>
        sb.setCell(0, 0, { char: 'X', fg: '#fff', bg: '#000' }),
      ).not.toThrow();
    });

    it('setCell with out-of-range col is a silent no-op', () => {
      const sb = new Scrollback(10, 5);
      const id = sb.appendLine();
      sb.setCell(id, -1, { char: 'X', fg: '#fff', bg: '#000' });
      sb.setCell(id, 100, { char: 'X', fg: '#fff', bg: '#000' });
      expect(sb.getCell(id, 0)).toEqual(emptyCell());
    });

    it('getCell on an evicted line throws RangeError', () => {
      const sb = new Scrollback(10, 2);
      sb.appendLine(); sb.appendLine(); sb.appendLine();
      expect(() => sb.getCell(0, 0)).toThrow(RangeError);
    });

    it('getCell on out-of-range col throws RangeError', () => {
      const sb = new Scrollback(10, 5);
      const id = sb.appendLine();
      expect(() => sb.getCell(id, -1)).toThrow(RangeError);
      expect(() => sb.getCell(id, 10)).toThrow(RangeError);
    });
  });

  describe('ring math (the key invariants)', () => {
    it('preserves stable absolute ids across many appends and evictions', () => {
      const sb = new Scrollback(2, 4); // capacity 4
      // Append 10 lines; only ids 6..9 should be retained.
      for (let i = 0; i < 10; i++) {
        const id = sb.appendLine();
        sb.setCell(id, 0, { char: String.fromCharCode(65 + i), fg: '#fff', bg: '#000' });
      }
      expect(sb.count).toBe(4);
      expect(sb.oldestId).toBe(6);
      expect(sb.nextLineId).toBe(10);
      // Each retained id still reads back its original content despite slot reuse.
      expect(sb.getCell(6, 0).char).toBe('G');
      expect(sb.getCell(7, 0).char).toBe('H');
      expect(sb.getCell(8, 0).char).toBe('I');
      expect(sb.getCell(9, 0).char).toBe('J');
      // Evicted reads are null.
      expect(sb.getLine(5)).toBeNull();
    });

    it('evicted slots come back as fresh empty cells (no leakage)', () => {
      const sb = new Scrollback(3, 2);
      const id0 = sb.appendLine();
      sb.setCell(id0, 0, { char: 'X', fg: '#fff', bg: '#000' });
      sb.appendLine();          // id 1
      sb.appendLine();          // id 2 — reuses the underlying slot that held id 0
      const line = sb.getLine(2);
      expect(line).not.toBeNull();
      expect(line![0]).toEqual(emptyCell()); // the 'X' from id 0 must not leak through
    });

    it('handles capacity 1 (degenerate but valid)', () => {
      const sb = new Scrollback(3, 1);
      const a = sb.appendLine();
      sb.setCell(a, 0, { char: 'A', fg: '#fff', bg: '#000' });
      expect(sb.getCell(a, 0).char).toBe('A');
      const b = sb.appendLine(); // evicts a
      expect(sb.getLine(a)).toBeNull();
      expect(sb.getCell(b, 0).char).toBe(' ');
    });
  });

  describe('wrap flags', () => {
    it('isWrapped is false by default for new lines', () => {
      const sb = new Scrollback(5, 10);
      const id = sb.appendLine();
      expect(sb.isWrapped(id)).toBe(false);
    });

    it('setWrapped(true) flips the flag; setWrapped(false) clears it', () => {
      const sb = new Scrollback(5, 10);
      const id = sb.appendLine();
      sb.setWrapped(id, true);
      expect(sb.isWrapped(id)).toBe(true);
      sb.setWrapped(id, false);
      expect(sb.isWrapped(id)).toBe(false);
    });

    it('setWrapped on an evicted id is a silent no-op', () => {
      const sb = new Scrollback(5, 2);
      const id0 = sb.appendLine();
      sb.setWrapped(id0, true);
      sb.appendLine(); sb.appendLine(); // evicts id0
      expect(() => sb.setWrapped(id0, true)).not.toThrow();
      expect(sb.isWrapped(id0)).toBe(false); // still false because id is invalid
    });

    it('setWrapped on a future id is a silent no-op', () => {
      const sb = new Scrollback(5, 10);
      sb.appendLine();
      sb.setWrapped(5, true);
      expect(sb.isWrapped(5)).toBe(false);
    });

    it('eviction clears the wrap flag for the evicted id', () => {
      const sb = new Scrollback(5, 2);
      const id0 = sb.appendLine();
      sb.setWrapped(id0, true);
      expect(sb.isWrapped(id0)).toBe(true);
      sb.appendLine();           // id 1
      sb.appendLine();           // id 2 → evicts id 0
      expect(sb.isWrapped(id0)).toBe(false);
      // Sanity: the new line at the same slot does not inherit the flag.
      expect(sb.isWrapped(2)).toBe(false);
    });
  });
});
