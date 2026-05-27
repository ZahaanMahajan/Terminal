/**
 * cursor.test.ts — unit tests for the absolute-lineId cursor model.
 */

import { describe, it, expect } from 'vitest';
import { Screen } from './screen';
import { cursorViewportRow, makeCursor, moveCursor } from './cursor';

describe('Cursor', () => {
  describe('cursorViewportRow', () => {
    it('returns the viewport row when the cursor is in view', () => {
      const s = new Screen(10, 4);
      const c = makeCursor(0, 2);
      expect(cursorViewportRow(c, s)).toBe(2);
    });

    it('returns null when the cursor is above the viewport (scrolled past)', () => {
      const s = new Screen(10, 4);
      for (let i = 0; i < 4; i++) s.appendLine(); // 8 lines total
      s.scrollToBottom(); // viewing [4..7]
      const c = makeCursor(0, 2); // line 2 is now above the viewport
      expect(cursorViewportRow(c, s)).toBeNull();
    });

    it('returns null when the cursor is below the viewport', () => {
      const s = new Screen(10, 4);
      for (let i = 0; i < 4; i++) s.appendLine();
      // viewportTop = 0; viewing [0..3]; line 7 is below.
      const c = makeCursor(0, 7);
      expect(cursorViewportRow(c, s)).toBeNull();
    });
  });

  describe('moveCursor', () => {
    it('clamps col to [0, cols - 1]', () => {
      const s = new Screen(10, 4);
      const c = makeCursor(0, 0);
      moveCursor(c, s, -5, 0);
      expect(c.col).toBe(0);
      moveCursor(c, s, 100, 0);
      expect(c.col).toBe(9);
    });

    it('clamps lineId to [oldestId, nextLineId - 1]', () => {
      const s = new Screen(10, 4); // ids 0..3 exist
      const c = makeCursor(0, 0);
      moveCursor(c, s, 0, -5);
      expect(c.lineId).toBe(0);
      moveCursor(c, s, 0, 100);
      expect(c.lineId).toBe(3);
    });

    it('sets visible=true (cursor reappears at the new position)', () => {
      const s = new Screen(10, 4);
      const c = makeCursor(0, 0);
      c.visible = false;
      moveCursor(c, s, 1, 1);
      expect(c.visible).toBe(true);
    });

    it('marks both old and new viewport rows dirty when both in view', () => {
      const s = new Screen(10, 4);
      const c = makeCursor(0, 0);
      s.clearDirty();
      moveCursor(c, s, 1, 2);
      expect(s.dirty.has(0)).toBe(true); // old viewport row
      expect(s.dirty.has(2)).toBe(true); // new viewport row
      expect(s.dirty.size).toBe(2);
    });

    it('marks only the in-view row when the other is scrolled out', () => {
      const s = new Screen(10, 4);
      for (let i = 0; i < 4; i++) s.appendLine(); // 8 lines
      s.scrollToBottom();                          // viewing [4..7]
      const c = makeCursor(0, 5);                  // viewport row 1
      s.clearDirty();
      moveCursor(c, s, 0, 0);                      // move to lineId 0 (scrolled out)
      expect(s.dirty.has(1)).toBe(true);
      expect(s.dirty.size).toBe(1);
    });

    it('marks no rows when both old and new are scrolled out', () => {
      const s = new Screen(10, 4);
      for (let i = 0; i < 4; i++) s.appendLine();
      s.scrollToBottom();             // viewing [4..7]
      const c = makeCursor(0, 0);     // off-screen (above)
      s.clearDirty();
      moveCursor(c, s, 0, 1);         // also off-screen
      expect(s.dirty.size).toBe(0);
    });
  });
});
