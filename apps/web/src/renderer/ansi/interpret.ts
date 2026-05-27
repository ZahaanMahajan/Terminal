/**
 * renderer/ansi/interpret.ts — Phase 1, step 6: apply parsed Actions to Screen + Cursor.
 *
 * The parser is structural (bytes → typed Actions); the interpreter is semantic (Action →
 * mutate Screen + Cursor). Keeping them separate means each is independently testable.
 *
 * What we interpret in this step:
 *
 *   PRINT          stamp `cursor.pen` into the cell at cursor; advance col; auto-wrap on
 *                  reaching cols (set wrap on the source line, advance to a fresh line,
 *                  auto-scroll viewport to keep cursor visible).
 *
 *   EXECUTE (C0)
 *     0x08 BS      cursor.col-- (clamped at 0).
 *     0x09 HT      next tab stop (every 8 cols), clamped to cols-1.
 *     0x0A LF      advance to next line (append + scroll if needed); col preserved.
 *     0x0D CR      cursor.col = 0.
 *
 *   CSI
 *     A CUU        cursor up by N (default 1), clamped to viewport top.
 *     B CUD        cursor down by N.
 *     C CUF        cursor forward (right) by N, clamped to cols-1.
 *     D CUB        cursor back (left) by N, clamped to 0.
 *     G CHA        cursor to column N (1-indexed; default 1).
 *     d VPA        cursor to viewport row N (1-indexed).
 *     H/f CUP/HVP  cursor to (row N, col M), both 1-indexed; default (1,1).
 *     J ED         erase in display (0: cursor→end, 1: start→cursor, 2: all).
 *     K EL         erase in line   (0: cursor→end, 1: start→cursor, 2: all).
 *     m SGR        applySgr — mutates cursor.pen.
 *
 *   ESC / OSC      currently unhandled; silently dropped.
 *
 * Erase fills with a space cell whose fg/bg = cursor.pen.fg/bg, matching the VT spec ("erase
 * with current background"). The fg doesn't strictly matter for a space, but we keep it
 * symmetric.
 *
 * Newlines (LF) advance the cursor's absolute lineId. If that overruns the scrollback's end,
 * we appendLine (auto-extend history). If the cursor's resulting viewport row is past the
 * bottom, we snap viewportTop forward (auto-scroll). Manual scrolls performed by the user are
 * "broken" by output — same posture as a regular terminal.
 */

import type { Action } from './parser';
import type { Cell } from '../cell';
import type { Screen } from '../screen';
import type { Cursor } from '../cursor';
import { cursorViewportRow } from '../cursor';
import { applySgr } from './sgr';

/** Apply one parsed action. */
export function applyAction(action: Action, screen: Screen, cursor: Cursor): void {
  switch (action.type) {
    case 'print':
      printChar(action.char, screen, cursor);
      return;
    case 'execute':
      executeC0(action.code, screen, cursor);
      return;
    case 'csi':
      dispatchCsi(action.final, action.params, screen, cursor);
      return;
    case 'esc':
      // No ESC sequences are implemented yet; ignore.
      return;
  }
}

// ─── Print ───────────────────────────────────────────────────────────────────

function printChar(ch: string, screen: Screen, cursor: Cursor): void {
  // Pending-wrap: if the previous print pushed col to cols, do the wrap now.
  if (cursor.col >= screen.cols) {
    screen.scrollback.setWrapped(cursor.lineId, true);
    advanceLine(cursor, screen);
    cursor.col = 0;
  }
  // Narrow the cell: only attach `attrs` when the pen actually has styling. Untouched cells
  // stay shape-narrow (no `attrs` field) which matters for `toEqual`-style tests and for
  // `isFullyDefault` in reflow.
  const cell: Cell = { char: ch, fg: cursor.pen.fg, bg: cursor.pen.bg };
  if (cursor.pen.attrs) cell.attrs = cursor.pen.attrs;
  screen.scrollback.setCell(cursor.lineId, cursor.col, cell);
  const row = cursorViewportRow(cursor, screen);
  if (row !== null) screen.markDirty(row);
  cursor.col++;
}

// ─── C0 controls ─────────────────────────────────────────────────────────────

function executeC0(code: number, screen: Screen, cursor: Cursor): void {
  switch (code) {
    case 0x08: {
      // BS
      if (cursor.col > 0) cursor.col--;
      const row = cursorViewportRow(cursor, screen);
      if (row !== null) screen.markDirty(row);
      return;
    }
    case 0x09: {
      // HT — next tab stop (multiples of 8), clamped to cols-1.
      const next = (Math.floor(cursor.col / 8) + 1) * 8;
      cursor.col = Math.min(screen.cols - 1, next);
      const row = cursorViewportRow(cursor, screen);
      if (row !== null) screen.markDirty(row);
      return;
    }
    case 0x0A: {
      // LF — advance to next line (column preserved).
      advanceLine(cursor, screen);
      return;
    }
    case 0x0D: {
      // CR — col := 0.
      cursor.col = 0;
      const row = cursorViewportRow(cursor, screen);
      if (row !== null) screen.markDirty(row);
      return;
    }
    // Everything else (BEL, ENQ, NUL, …) is ignored for now.
  }
}

/**
 * Move the cursor one line forward. If we're at the end of scrollback, append a new line
 * (extends history). If the cursor's new viewport row is past the bottom, scroll the viewport
 * forward so the cursor stays visible.
 */
function advanceLine(cursor: Cursor, screen: Screen): void {
  const oldRow = cursorViewportRow(cursor, screen);
  if (oldRow !== null) screen.markDirty(oldRow);

  const nextId = cursor.lineId + 1;
  if (nextId >= screen.scrollback.nextLineId) {
    // Append a new bottom line; its id will equal nextId.
    screen.appendLine(cursor.pen.fg, cursor.pen.bg);
  }
  cursor.lineId = nextId;

  // Auto-scroll if the cursor's new row would be off-bottom.
  const row = cursorViewportRow(cursor, screen);
  if (row === null || row >= screen.rows) {
    screen.scrollToBottom();
  }

  const newRow = cursorViewportRow(cursor, screen);
  if (newRow !== null) screen.markDirty(newRow);
}

// ─── CSI dispatch ────────────────────────────────────────────────────────────

function dispatchCsi(
  final: string,
  params: number[],
  screen: Screen,
  cursor: Cursor,
): void {
  /** Read params[i]; default to `def` when missing or zero (the VT default-1 idiom). */
  const p1 = (i: number, def: number = 1): number => {
    const v = params[i];
    return v === undefined || v === 0 ? def : v;
  };
  /** Read params[i]; default to `def` (allows zero to be meaningful, as in ED/EL). */
  const p = (i: number, def: number = 0): number => params[i] ?? def;

  switch (final) {
    case 'A': // CUU — up
      moveByRows(cursor, screen, -p1(0));
      return;
    case 'B': // CUD — down
      moveByRows(cursor, screen, p1(0));
      return;
    case 'C': // CUF — forward
      moveCol(cursor, screen, cursor.col + p1(0));
      return;
    case 'D': // CUB — back
      moveCol(cursor, screen, cursor.col - p1(0));
      return;
    case 'G': // CHA — to column N (1-indexed)
      moveCol(cursor, screen, p1(0) - 1);
      return;
    case 'd': // VPA — to row N (1-indexed)
      moveAbsRow(cursor, screen, p1(0) - 1);
      return;
    case 'H': // CUP
    case 'f': // HVP
      moveAbsRow(cursor, screen, p1(0) - 1);
      moveCol(cursor, screen, p1(1) - 1);
      return;
    case 'J': // ED — erase in display
      eraseInDisplay(screen, cursor, p(0, 0));
      return;
    case 'K': // EL — erase in line
      eraseInLine(screen, cursor, p(0, 0));
      return;
    case 'm': // SGR
      applySgr(params, cursor.pen);
      return;
    // CSI n (DSR), CSI s/u (save/restore), etc. — not implemented yet.
  }
}

function moveByRows(cursor: Cursor, screen: Screen, delta: number): void {
  const row = cursorViewportRow(cursor, screen);
  const oldRow = row ?? 0;
  if (row !== null) screen.markDirty(row);
  const newRow = Math.max(0, Math.min(screen.rows - 1, oldRow + delta));
  cursor.lineId = screen.viewportTop + newRow;
  screen.markDirty(newRow);
}

function moveAbsRow(cursor: Cursor, screen: Screen, viewportRow: number): void {
  const old = cursorViewportRow(cursor, screen);
  if (old !== null) screen.markDirty(old);
  const r = Math.max(0, Math.min(screen.rows - 1, viewportRow));
  cursor.lineId = screen.viewportTop + r;
  screen.markDirty(r);
}

function moveCol(cursor: Cursor, screen: Screen, col: number): void {
  cursor.col = Math.max(0, Math.min(screen.cols - 1, col));
  const row = cursorViewportRow(cursor, screen);
  if (row !== null) screen.markDirty(row);
}

// ─── Erase ──────────────────────────────────────────────────────────────────

function eraseCell(cursor: Cursor): Cell {
  // VT spec: "erase with current background." Fg colour for a space doesn't matter visually
  // but we keep both for symmetry / future style preservation.
  return { char: ' ', fg: cursor.pen.fg, bg: cursor.pen.bg };
}

function eraseInLine(screen: Screen, cursor: Cursor, mode: number): void {
  const row = cursorViewportRow(cursor, screen);
  if (row === null) return;
  let start = 0;
  let end = screen.cols;
  if (mode === 0) {
    start = cursor.col;
  } else if (mode === 1) {
    end = cursor.col + 1;
  }
  // mode 2: keep [0, cols)
  for (let c = start; c < end; c++) {
    screen.scrollback.setCell(cursor.lineId, c, eraseCell(cursor));
  }
  screen.markDirty(row);
}

function eraseInDisplay(screen: Screen, cursor: Cursor, mode: number): void {
  const cRow = cursorViewportRow(cursor, screen);
  if (cRow === null) {
    // Cursor is off-screen: 2 (full) still works using viewport coords; 0/1 we just skip.
    if (mode === 2) clearViewport(screen, cursor);
    return;
  }
  if (mode === 0) {
    // From cursor → end of cursor's line, then all rows below.
    eraseInLine(screen, cursor, 0);
    for (let r = cRow + 1; r < screen.rows; r++) {
      eraseRow(screen, cursor, r);
    }
    return;
  }
  if (mode === 1) {
    // All rows above, then from start of cursor's line → cursor.
    for (let r = 0; r < cRow; r++) eraseRow(screen, cursor, r);
    eraseInLine(screen, cursor, 1);
    return;
  }
  if (mode === 2) {
    clearViewport(screen, cursor);
    return;
  }
}

function eraseRow(screen: Screen, cursor: Cursor, viewportRow: number): void {
  const lineId = screen.viewportTop + viewportRow;
  for (let c = 0; c < screen.cols; c++) {
    screen.scrollback.setCell(lineId, c, eraseCell(cursor));
  }
  screen.markDirty(viewportRow);
}

function clearViewport(screen: Screen, cursor: Cursor): void {
  for (let r = 0; r < screen.rows; r++) eraseRow(screen, cursor, r);
}

// ─── High-level entry: feed an input chunk ───────────────────────────────────

import { AnsiParser } from './parser';

/**
 * Feed a chunk of input into a parser, applying every emitted action to (screen, cursor).
 * The parser carries state across calls, so chunked input is safe.
 */
export function feed(
  input: string,
  screen: Screen,
  cursor: Cursor,
  parser: AnsiParser,
): void {
  for (const action of parser.parse(input)) {
    applyAction(action, screen, cursor);
  }
}
