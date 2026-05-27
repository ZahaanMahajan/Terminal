/**
 * renderer/cell.ts — the smallest shared type.
 *
 * `Cell` is shared by Scrollback (which stores Cells) and Screen (which is a view over them).
 * Extracted to its own file to avoid a circular import between the two.
 *
 * Step 7 adds optional **style attributes** as bit-flags. Why optional:
 *   - Untouched empty cells (from `appendLine`) carry no styling; we don't want to allocate
 *     an extra field on every cell of a 10k-line history just to hold a 0.
 *   - Tests that build cells inline as `{char, fg, bg}` keep type-checking and `toEqual`'ing
 *     against stored cells without ceremony.
 *   - The writer (interpret.ts) sets `attrs` only when it's non-zero, so cells stay narrow by
 *     default and code that reads attrs uses `cell.attrs ?? 0`.
 */

export type Cell = {
  /** One visual cell's character. Single code-point string today; graphemes later. */
  char: string;
  /** CSS color for the glyph. */
  fg: string;
  /** CSS color for the cell background. */
  bg: string;
  /** Style bit-flags (ATTR_*). Absent or 0 means "no styling." */
  attrs?: number;
};

export const DEFAULT_FG = '#e5e7eb';
export const DEFAULT_BG = '#0a0a0a';

// Style attribute bit flags. Combined via bitwise OR; tested via `& ATTR_*`.
// Values matter only for ordering on output (we serialize bold-before-italic in `ctx.font`).
export const ATTR_BOLD      = 1 << 0; // 1
export const ATTR_ITALIC    = 1 << 1; // 2
export const ATTR_UNDERLINE = 1 << 2; // 4
export const ATTR_INVERSE   = 1 << 3; // 8

export function emptyCell(fg: string = DEFAULT_FG, bg: string = DEFAULT_BG): Cell {
  return { char: ' ', fg, bg };
}
