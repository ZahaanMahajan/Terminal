/**
 * renderer/reflow.ts — Phase 1, step 5: line reflow on cols change.
 *
 * This is the hard half of "wrap + reflow." Writing past the right edge sets a wrap flag and
 * advances to the next line; reflow uses those flags to *undo* the previous chunking and
 * rebuild physical lines at a new width.
 *
 * The algorithm in three passes:
 *
 *   1. EXTRACT logical lines from the source scrollback.
 *      Walk ids from oldest to newest. A *logical line* is a contiguous run of physical lines
 *      where every line except the last has `isWrapped` set. Concatenate their cells.
 *      While walking, if the cursor's lineId is encountered, record its position as a single
 *      offset into the concatenated cells (`cursorLogicalCol`).
 *
 *   2. TRIM trailing fully-default cells per logical line.
 *      A user write of "abc" into an 80-cell line leaves 77 trailing empty cells. Without
 *      trimming, reflow would propagate that padding into new lines (silly). Trimming policy:
 *      drop trailing cells where `char === ' ' && fg === DEFAULT_FG && bg === DEFAULT_BG`.
 *      Cells with non-default styling are preserved (e.g., a colored EOL bar).
 *      The cursor's logical col is clamped to the new trimmed length (cursor sitting on
 *      trimmed padding snaps to "just past the content").
 *
 *   3. REBUILD a fresh Scrollback at newCols by chunking each logical line into pieces of up
 *      to newCols cells. Set the wrap flag on every chunk except the last of each logical
 *      line. While placing chunks, watch for the cursor's logical col and remap to a new
 *      (lineId, col) pair.
 *
 * Cursor remap is a destructive mutation of the caller's `Cursor`. The function returns a
 * brand-new `Scrollback`; callers replace their reference.
 *
 * Edge cases handled:
 *   - newCols === src.cols → return src unchanged (no work).
 *   - Empty logical line (all-default cells) → one empty physical line at newCols, no wrap.
 *     Cursor lands at (id, 0).
 *   - Cursor at "end of content" (logical col equals trimmed length) → land at the column
 *     past the last char on the last chunk; final clamp keeps it in [0, newCols - 1].
 *   - Cursor on an evicted or out-of-range line id → not found in extract; we don't remap and
 *     reset to a sane default (last valid line of the new scrollback).
 *   - Dangling wrap (last source line has `wrap = true` but no successor) → treated as
 *     "logical line ends here."
 */

import type { Cell } from './cell';
import { DEFAULT_FG, DEFAULT_BG } from './cell';
import { Scrollback } from './scrollback';
import type { Cursor } from './cursor';

function isFullyDefault(cell: Cell): boolean {
  // `!cell.attrs` handles both `undefined` and `0` — both mean "no styling."
  return (
    cell.char === ' ' &&
    cell.fg === DEFAULT_FG &&
    cell.bg === DEFAULT_BG &&
    !cell.attrs
  );
}

/**
 * Reflow a Scrollback to a new column width. Returns a freshly constructed Scrollback with
 * the same capacity. If `cursor` is provided, its `(lineId, col)` are mutated to point at the
 * equivalent position in the new buffer.
 */
export function reflowScrollback(
  src: Scrollback,
  newCols: number,
  cursor?: Cursor,
): Scrollback {
  if (newCols <= 0) throw new Error('reflowScrollback: newCols must be > 0');
  if (newCols === src.cols) return src;

  // ── Pass 1+2: extract & trim logical lines ───────────────────────────────────
  type LogicalLine = { cells: Cell[]; cursorCol: number | null };
  const logical: LogicalLine[] = [];

  let i = src.oldestId;
  while (i < src.nextLineId) {
    const cells: Cell[] = [];
    let cursorLogicalCol: number | null = null;

    // Walk through this logical line (one or more wrapped physical lines).
    while (true) {
      const line = src.getLine(i);
      if (!line) break; // defensive; shouldn't happen for ids in [oldestId, nextLineId)
      const before = cells.length;
      for (const cell of line) cells.push(cell);
      if (cursor && cursor.lineId === i) {
        cursorLogicalCol = before + cursor.col;
      }
      if (!src.isWrapped(i)) break;
      const next = i + 1;
      if (next >= src.nextLineId) break; // dangling wrap — treat as terminator
      i = next;
    }

    // Trim trailing fully-default cells (the padding from short writes).
    while (cells.length > 0 && isFullyDefault(cells[cells.length - 1])) {
      cells.pop();
    }

    // Cursor sitting on trimmed padding snaps to "just past content."
    if (cursorLogicalCol !== null) {
      cursorLogicalCol = Math.min(cursorLogicalCol, cells.length);
    }

    logical.push({ cells, cursorCol: cursorLogicalCol });
    i++;
  }

  // ── Pass 3: build the new scrollback ─────────────────────────────────────────
  const newSb = new Scrollback(newCols, src.capacity);
  let newCursorLineId: number | null = null;
  let newCursorCol: number | null = null;

  for (const { cells, cursorCol } of logical) {
    if (cells.length === 0) {
      // Empty logical line → one empty physical line, no wrap.
      const id = newSb.appendLine();
      if (cursorCol !== null) {
        newCursorLineId = id;
        newCursorCol = 0;
      }
      continue;
    }

    let pos = 0;
    while (pos < cells.length) {
      const id = newSb.appendLine();
      const chunkLen = Math.min(newCols, cells.length - pos);
      for (let c = 0; c < chunkLen; c++) {
        newSb.setCell(id, c, cells[pos + c]);
      }

      // Cursor falls into this chunk if its logical col is in [pos, pos + chunkLen).
      // Special case: cursor at end-of-content lands on the last chunk at column `chunkLen`.
      if (cursorCol !== null) {
        const inChunk = cursorCol >= pos && cursorCol < pos + chunkLen;
        const atEnd = cursorCol === pos + chunkLen && pos + chunkLen === cells.length;
        if (inChunk || atEnd) {
          newCursorLineId = id;
          newCursorCol = cursorCol - pos; // 0..chunkLen
        }
      }

      const more = pos + chunkLen < cells.length;
      if (more) newSb.setWrapped(id, true);
      pos += chunkLen;
    }
  }

  // ── Apply cursor remap ───────────────────────────────────────────────────────
  if (cursor) {
    if (newCursorLineId !== null && newCursorCol !== null) {
      cursor.lineId = newCursorLineId;
      cursor.col = Math.max(0, Math.min(newCols - 1, newCursorCol));
    } else if (newSb.count > 0) {
      // Cursor wasn't found in source (evicted/out-of-range). Park it at the end of the new
      // scrollback at col 0 — a sane default that's at least inside valid bounds.
      cursor.lineId = newSb.nextLineId - 1;
      cursor.col = 0;
    }
  }

  return newSb;
}
