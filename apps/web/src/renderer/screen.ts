/**
 * renderer/screen.ts — Phase 1, step 5: the Screen as a view over Scrollback, with wrap.
 *
 * The Screen is no longer the source of truth for cells — the Scrollback is. The Screen owns:
 *   - the *viewport*: which `rows` consecutive lines (out of scrollback history) we're showing
 *   - the *dirty set*: which viewport rows need a repaint
 *   - the convenience API: `get`/`set`/`write`/`println`/`clear` in viewport coordinates
 *   - the scroll API: `scrollTo`/`scrollBy`/`scrollToBottom`
 *   - the resize API: `setCols` (calls into reflow.ts)
 *
 * Coordinate translation everyone now performs:
 *
 *     absolute line id  ↔  viewport row
 *     id = viewportTop + row
 *     row = id - viewportTop      (if 0 ≤ row < rows, otherwise off-screen)
 *
 * Step 5 adds wrap:
 *   - `write(col, row, text)` wraps within the viewport. When a write reaches col === cols,
 *     it marks the current line wrapped, advances to (col 0, row + 1), and continues until the
 *     text is exhausted or row goes past the viewport bottom (where it clips).
 *   - `println(text, …)` appends as many physical lines as needed (ceil(len / cols)), sets the
 *     wrap flag on all but the last, writes the text, and snaps to the bottom.
 *   - `setCols(newCols, cursor?)` calls `reflowScrollback`, replaces this Screen's internal
 *     Scrollback reference with the freshly built one, tops up so the viewport stays full,
 *     and snaps to the bottom. The cursor (if passed) is remapped in place by reflow.
 */

export type { Cell } from './cell';
export { DEFAULT_FG, DEFAULT_BG, emptyCell } from './cell';

import type { Cell } from './cell';
import { DEFAULT_FG, DEFAULT_BG } from './cell';
import { Scrollback } from './scrollback';
import type { Cursor } from './cursor';
import { reflowScrollback } from './reflow';

export { Scrollback } from './scrollback';
export type { Line } from './scrollback';

export class Screen {
  /** Replaced wholesale on `setCols`. Read via the `scrollback` getter. */
  private _scrollback: Scrollback;
  readonly rows: number;

  /** Absolute scrollback id corresponding to viewport row 0. */
  private _viewportTop: number;

  /**
   * When the alternate screen is active, holds the stashed primary buffer + viewport so
   * `exitAltScreen` can restore them verbatim. `null` ⇒ we're on the primary screen.
   */
  private _primary: { scrollback: Scrollback; viewportTop: number } | null = null;

  /** Viewport rows that have changed since the last successful paint. */
  readonly dirty: Set<number>;

  constructor(cols: number, rows: number, scrollbackCapacity: number = 10000) {
    if (cols <= 0 || rows <= 0) throw new Error('Screen: cols/rows must be > 0');
    this._scrollback = new Scrollback(cols, scrollbackCapacity);
    this.rows = rows;

    // Pre-fill so the viewport [0, rows) always references valid lines from construction.
    for (let r = 0; r < rows; r++) this._scrollback.appendLine();

    this._viewportTop = 0;
    this.dirty = new Set();
    this.markAllDirty();
  }

  get scrollback(): Scrollback {
    return this._scrollback;
  }

  get cols(): number {
    return this._scrollback.cols;
  }

  /** Absolute scrollback id at viewport row 0. */
  get viewportTop(): number {
    return this._viewportTop;
  }

  /** Absolute scrollback id one past viewport row (rows-1) — i.e., exclusive bottom. */
  get viewportBottom(): number {
    return this._viewportTop + this.rows;
  }

  /** True when the viewport's bottom row is at (or past) the newest line. */
  get atBottom(): boolean {
    return this.viewportBottom >= this._scrollback.nextLineId;
  }

  /** Number of lines hidden above the viewport. (0 when at top, positive otherwise.) */
  get linesAbove(): number {
    return Math.max(0, this._viewportTop - this._scrollback.oldestId);
  }

  /** Number of lines hidden below the viewport. (0 when at bottom.) */
  get linesBelow(): number {
    return Math.max(0, this._scrollback.nextLineId - this.viewportBottom);
  }

  // ─── Cell access in viewport coords ─────────────────────────────────────────

  get(col: number, row: number): Cell {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) {
      throw new RangeError(`Screen.get(${col}, ${row}) out of bounds (${this.cols}×${this.rows})`);
    }
    return this._scrollback.getCell(this._viewportTop + row, col);
  }

  set(col: number, row: number, cell: Cell): void {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return;
    this._scrollback.setCell(this._viewportTop + row, col, cell);
    this.dirty.add(row);
  }

  /**
   * Write `text` starting at (col, row). Wraps to the next viewport row when col reaches cols,
   * setting the wrap flag on the source line. Clips at the viewport bottom (no auto-scroll —
   * use `println` for that). No-op if starting (col, row) is out of bounds.
   *
   * One code point per cell (via `for…of` on the string). Grapheme-cluster handling lives in a
   * future upgrade behind `Intl.Segmenter`.
   */
  write(
    col: number,
    row: number,
    text: string,
    fg: string = DEFAULT_FG,
    bg: string = DEFAULT_BG,
  ): void {
    if (col < 0 || col >= this.cols) return;
    if (row < 0 || row >= this.rows) return;
    let c = col;
    let r = row;
    for (const ch of text) {
      if (c >= this.cols) {
        // Wrap: mark the source line wrapped, advance to next viewport row.
        this._scrollback.setWrapped(this._viewportTop + r, true);
        c = 0;
        r++;
        if (r >= this.rows) return; // clipped at viewport bottom
      }
      this._scrollback.setCell(this._viewportTop + r, c, { char: ch, fg, bg });
      this.dirty.add(r);
      c++;
    }
  }

  /** Overwrite every cell *in the viewport* with empty cells. Doesn't touch history. */
  clear(fg: string = DEFAULT_FG, bg: string = DEFAULT_BG): void {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        this._scrollback.setCell(this._viewportTop + r, c, { char: ' ', fg, bg });
      }
      // Clear any leftover wrap flag on these viewport lines — `clear` is a hard reset.
      this._scrollback.setWrapped(this._viewportTop + r, false);
    }
    this.markAllDirty();
  }

  // ─── Alternate screen (full-screen apps: vim, htop, less) ────────────────────

  /** True while the alternate screen buffer is active. */
  get inAltScreen(): boolean {
    return this._primary !== null;
  }

  /**
   * Switch to a fresh alternate screen buffer (`CSI ?1049h` / `?1047h` / `?47h`). The primary
   * scrollback + viewport are stashed and restored verbatim by `exitAltScreen` — that's *why*
   * quitting vim leaves your shell history untouched.
   *
   * The alt buffer is exactly `rows` lines with **no scrollback** (capacity = rows): appending
   * at the bottom evicts the top line, which is precisely "scroll the fixed screen up by one."
   * Cursor positioning is the app's job (it sends CUP); we leave the cursor for the caller.
   * No-op if already in the alt screen.
   */
  enterAltScreen(): void {
    if (this._primary !== null) return;
    this._primary = { scrollback: this._scrollback, viewportTop: this._viewportTop };
    this._scrollback = new Scrollback(this._primary.scrollback.cols, this.rows);
    for (let r = 0; r < this.rows; r++) this._scrollback.appendLine();
    this._viewportTop = this._scrollback.oldestId;
    this.markAllDirty();
  }

  /** Restore the stashed primary buffer (`CSI ?1049l` / …). No-op if already on the primary. */
  exitAltScreen(): void {
    if (this._primary === null) return;
    const { scrollback, viewportTop } = this._primary;
    this._scrollback = scrollback;
    this._primary = null;
    // Clamp the restored top into the buffer's current valid range — it may have been reflowed
    // (and possibly shortened) by a resize while we were in the alt screen.
    const minTop = this._scrollback.oldestId;
    const maxTop = Math.max(minTop, this._scrollback.nextLineId - this.rows);
    this._viewportTop = Math.max(minTop, Math.min(maxTop, viewportTop));
    this.markAllDirty();
  }

  // ─── Scrolling ─────────────────────────────────────────────────────────────

  /** Set viewportTop, clamped so the viewport stays within [oldestId, nextLineId − rows]. */
  scrollTo(absoluteTop: number): void {
    const minTop = this._scrollback.oldestId;
    const maxTop = Math.max(minTop, this._scrollback.nextLineId - this.rows);
    const newTop = Math.max(minTop, Math.min(maxTop, absoluteTop));
    if (newTop !== this._viewportTop) {
      this._viewportTop = newTop;
      this.markAllDirty();
    }
  }

  /** Positive = toward newer lines. Negative = toward older history. */
  scrollBy(deltaLines: number): void {
    if (deltaLines === 0) return;
    this.scrollTo(this._viewportTop + deltaLines);
  }

  /** Snap so the last `rows` lines of scrollback fill the viewport. */
  scrollToBottom(): void {
    this.scrollTo(this._scrollback.nextLineId - this.rows);
  }

  // ─── Writing into history ──────────────────────────────────────────────────

  /** Append a new empty line at the bottom of scrollback. No viewport movement. */
  appendLine(fg?: string, bg?: string): number {
    return this._scrollback.appendLine(fg, bg);
  }

  /**
   * Append enough physical lines to hold `text` (wrapping at `cols`), write the text into
   * them, set wrap flags on all but the last, then snap to the bottom. The "auto-scroll +
   * wrap" terminal idiom in one function. Returns the id of the *first* line written.
   */
  println(text: string, fg: string = DEFAULT_FG, bg: string = DEFAULT_BG): number {
    // for…of yields code points (correctly handles surrogate pairs).
    const codePoints = Array.from(text);
    const linesNeeded = Math.max(1, Math.ceil(codePoints.length / this.cols));

    const firstId = this._scrollback.appendLine(fg, bg);
    for (let i = 1; i < linesNeeded; i++) this._scrollback.appendLine(fg, bg);

    // Wrap every line except the last of this println.
    for (let i = 0; i < linesNeeded - 1; i++) {
      this._scrollback.setWrapped(firstId + i, true);
    }

    for (let i = 0; i < codePoints.length; i++) {
      const lineIdx = Math.floor(i / this.cols);
      const colIdx = i % this.cols;
      this._scrollback.setCell(firstId + lineIdx, colIdx, { char: codePoints[i], fg, bg });
    }

    this.scrollToBottom();
    this.markAllDirty();
    return firstId;
  }

  // ─── Resizing (reflow) ─────────────────────────────────────────────────────

  /**
   * Change `cols` and reflow the entire scrollback. If `cursor` is provided, its
   * `(lineId, col)` is remapped to its equivalent position in the new buffer.
   *
   * After reflow we top up to keep `_scrollback.count >= rows` (so the viewport stays valid)
   * and snap to the bottom — the simplest UX. A scroll-lock policy is a future addition.
   */
  setCols(newCols: number, cursor?: Cursor): void {
    if (newCols <= 0) throw new Error('Screen.setCols: newCols must be > 0');
    if (newCols === this.cols) return;

    if (this._primary !== null) {
      // In the alt screen: reflow the *stashed* primary so it's the right width on exit, and
      // rebuild a blank alt grid at the new size — the foreground app repaints on SIGWINCH, so
      // there's nothing here worth reflowing. (The saved cursor for `?1049` is clamped into
      // bounds on exit; an exact remap of a detached cursor isn't worth the complexity.)
      this._primary.scrollback = reflowScrollback(this._primary.scrollback, newCols);
      while (this._primary.scrollback.count < this.rows) this._primary.scrollback.appendLine();
      this._scrollback = new Scrollback(newCols, this.rows);
      for (let r = 0; r < this.rows; r++) this._scrollback.appendLine();
      this._viewportTop = this._scrollback.oldestId;
      if (cursor) {
        cursor.lineId = this._viewportTop;
        cursor.col = Math.min(cursor.col, newCols - 1);
      }
      this.markAllDirty();
      return;
    }

    this._scrollback = reflowScrollback(this._scrollback, newCols, cursor);

    while (this._scrollback.count < this.rows) this._scrollback.appendLine();

    this.scrollToBottom();
    this.markAllDirty();
  }

  // ─── Dirty tracking ────────────────────────────────────────────────────────

  /**
   * Mark a single viewport row dirty. Used when the *visual* state of a row changes without a
   * cell changing — e.g. cursor blink, or the cursor moving in/out of that row.
   */
  markDirty(row: number): void {
    if (row >= 0 && row < this.rows) this.dirty.add(row);
  }

  /** Mark every viewport row dirty. Used after scroll, theme change, font change, resize. */
  markAllDirty(): void {
    for (let r = 0; r < this.rows; r++) this.dirty.add(r);
  }

  /** Called by the renderer after a successful paint of all `dirty` rows. */
  clearDirty(): void {
    this.dirty.clear();
  }
}
