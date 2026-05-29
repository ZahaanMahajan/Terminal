/**
 * renderer/cursor.ts — the terminal cursor (anchored to absolute scrollback ids).
 *
 * The cursor lives in *scrollback coordinates*: `{ col, lineId }` where `lineId` is the
 * absolute id of the line it sits on. A real terminal's cursor is anchored to a line; the
 * line scrolling out of view is what causes the cursor to vanish.
 *
 * Step 6 added a `pen` (fg, bg). Step 7 extends it with `attrs` — the same bit-field used on
 * Cell. PRINT stamps the pen (colors + attrs) into the cell at the cursor; SGR mutates the
 * pen. Cursor motion never touches the pen.
 */

import type { Screen } from './screen';
import type { CellMetrics } from './index';
import { DEFAULT_FG, DEFAULT_BG, ATTR_INVERSE } from './cell';

export type CursorShape = 'block' | 'beam' | 'underline';

/** The "write head": colors + style bit-flags. Each PRINT stamps these into the cell. */
export type Pen = {
  fg: string;
  bg: string;
  attrs: number;
};

/** A point-in-time snapshot of position + pen, for DECSC/DECRC and alt-screen save/restore. */
export type SavedCursor = { col: number; lineId: number; pen: Pen };

export type Cursor = {
  col: number;
  /** Absolute scrollback line id. */
  lineId: number;
  shape: CursorShape;
  /** Toggled by the blink timer in the render loop. */
  visible: boolean;
  /**
   * DECTCEM (`CSI ?25l/h`): when true the cursor is not drawn at all. Distinct from `visible`,
   * which is the blink phase — apps hide the cursor while redrawing, independent of blink.
   */
  hidden: boolean;
  /** Saved snapshot for DECSC/DECRC and the alt-screen combo (`?1048`, `?1049`). */
  saved: SavedCursor | null;
  /** Current foreground/background/attrs for printed characters. SGR mutates this. */
  pen: Pen;
};

export function makeCursor(
  col: number = 0,
  lineId: number = 0,
  shape: CursorShape = 'block',
): Cursor {
  return {
    col,
    lineId,
    shape,
    visible: true,
    hidden: false,
    saved: null,
    pen: { fg: DEFAULT_FG, bg: DEFAULT_BG, attrs: 0 },
  };
}

/** DECSC / `CSI ?1048h`: snapshot position + pen *by value* (the pen is mutated in place). */
export function saveCursor(cursor: Cursor): void {
  cursor.saved = { col: cursor.col, lineId: cursor.lineId, pen: { ...cursor.pen } };
}

/**
 * DECRC / `CSI ?1048l`: restore a saved snapshot, clamped into the *current* buffer's bounds.
 * Used on alt-screen exit, where the saved lineId belongs to the (now-restored) primary buffer.
 * No-op if nothing was saved.
 */
export function restoreCursor(cursor: Cursor, screen: Screen): void {
  const s = cursor.saved;
  if (!s) return;
  const minId = screen.scrollback.oldestId;
  const maxId = screen.scrollback.nextLineId - 1;
  cursor.col = Math.max(0, Math.min(screen.cols - 1, s.col));
  cursor.lineId = Math.max(minId, Math.min(maxId, s.lineId));
  cursor.pen = { ...s.pen };
}

/** Reset pen colors + attrs to defaults. SGR 0 / SGR with no params calls this. */
export function resetPen(pen: Pen): void {
  pen.fg = DEFAULT_FG;
  pen.bg = DEFAULT_BG;
  pen.attrs = 0;
}

/**
 * Translate the cursor's absolute lineId into a viewport row, or `null` if it's outside.
 * Pulled out so blink + drawCursor + moveCursor all share the same math.
 */
export function cursorViewportRow(cursor: Cursor, screen: Screen): number | null {
  const row = cursor.lineId - screen.viewportTop;
  if (row < 0 || row >= screen.rows) return null;
  return row;
}

/**
 * Move the cursor to (col, lineId) in *absolute* coordinates. Marks the old viewport row
 * (if visible) and the new viewport row (if visible) dirty.
 */
export function moveCursor(
  cursor: Cursor,
  screen: Screen,
  col: number,
  lineId: number,
): void {
  const oldRow = cursorViewportRow(cursor, screen);
  if (oldRow !== null) screen.markDirty(oldRow);

  cursor.col = Math.max(0, Math.min(screen.cols - 1, col));
  const minId = screen.scrollback.oldestId;
  const maxId = screen.scrollback.nextLineId - 1;
  cursor.lineId = Math.max(minId, Math.min(maxId, lineId));
  cursor.visible = true;

  const newRow = cursorViewportRow(cursor, screen);
  if (newRow !== null) screen.markDirty(newRow);
}

/**
 * Composite the cursor on top of a freshly painted cell. No-op if the cursor's line is not in
 * the viewport. Block cursors invert the underlying cell; if the underlying cell already has
 * ATTR_INVERSE, the two inversions cancel — net effect: cell renders in its "natural" colors
 * with no cursor highlight. That's an acceptable visual approximation for now.
 *
 * Visually clamps `cursor.col` to `cols - 1` when it sits at `cols` (the "pending wrap"
 * position used between writing the last cell of a line and the next print).
 */
export function drawCursor(
  ctx: CanvasRenderingContext2D,
  cursor: Cursor,
  screen: Screen,
  m: CellMetrics,
): void {
  if (cursor.hidden) return; // DECTCEM: cursor turned off by the foreground app
  const row = cursorViewportRow(cursor, screen);
  if (row === null) return;
  if (cursor.col < 0) return;

  const drawCol = cursor.col >= screen.cols ? screen.cols - 1 : cursor.col;
  const cell = screen.get(drawCol, row);

  // Resolve the cell's *displayed* fg/bg under any ATTR_INVERSE it carries.
  const cellInverse = ((cell.attrs ?? 0) & ATTR_INVERSE) !== 0;
  const cellFg = cellInverse ? cell.bg : cell.fg;
  const cellBg = cellInverse ? cell.fg : cell.bg;

  const x = drawCol * m.cellWidth;
  const y = row * m.cellHeight;

  switch (cursor.shape) {
    case 'block': {
      ctx.fillStyle = cellFg;
      ctx.fillRect(x, y, m.cellWidth, m.cellHeight);
      if (cell.char !== ' ') {
        ctx.fillStyle = cellBg;
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(cell.char, x, y + m.baseline);
      }
      return;
    }
    case 'beam': {
      const width = Math.max(1, Math.floor(m.cellWidth * 0.12));
      ctx.fillStyle = cellFg;
      ctx.fillRect(x, y, width, m.cellHeight);
      return;
    }
    case 'underline': {
      const thickness = Math.max(1, Math.floor(m.cellHeight * 0.1));
      ctx.fillStyle = cellFg;
      ctx.fillRect(x, y + m.cellHeight - thickness, m.cellWidth, thickness);
      return;
    }
  }
}
