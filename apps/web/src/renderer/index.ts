/**
 * renderer/index.ts — Phase 1 renderer entry.
 *
 * The renderer is framework-free. Module layout:
 *
 *   cell.ts        — Cell type, emptyCell (shared by Scrollback and Screen)
 *   scrollback.ts  — ring buffer of Lines (history) + per-id wrap flags
 *   screen.ts      — view over Scrollback (cols × rows viewport + dirty tracking) + setCols
 *   cursor.ts      — Cursor (absolute lineId + pen) + drawCursor + moveCursor
 *   reflow.ts      — reflowScrollback (extract → trim → rebuild at newCols, remap cursor)
 *   loop.ts        — startRenderLoop (rAF + blink + stats)
 *   ansi/          — VT100/ECMA-48 parser + interpreter + SGR
 *   index.ts       — measureCell, fitCanvas, drawCell, drawScreen, drawScreenDirty, re-exports
 */

export * from './cell';
export * from './screen';
export * from './cursor';
export * from './reflow';
export * from './loop';
export * from './ansi';
export * from './lru';
export * from './glyph-cache';

import type { Cell } from './cell';
import { ATTR_BOLD, ATTR_ITALIC, ATTR_UNDERLINE, ATTR_INVERSE } from './cell';
import type { Screen } from './screen';
import type { Cursor } from './cursor';
import { drawCursor, cursorViewportRow } from './cursor';
import { GlyphCache, type GlyphRenderer } from './glyph-cache';

/** Just the font configuration. Per-cell fg/bg live on each Cell. */
export type GridStyle = {
  /** Any valid CSS font-family list; a monospace family is required for the grid math to hold. */
  fontFamily: string;
  /** Logical font size in CSS pixels. */
  fontSizePx: number;
};

export type CellMetrics = {
  /** Advance width in CSS pixels (cell width on the grid). */
  cellWidth: number;
  /** Ascent + descent in CSS pixels (cell height on the grid). */
  cellHeight: number;
  /** Distance from the top of the cell to the alphabetic baseline. */
  baseline: number;
  /** Carried from GridStyle so `drawCell` can rebuild bold/italic font strings without it. */
  fontFamily: string;
  /** Carried from GridStyle. */
  fontSizePx: number;
};

/**
 * Set the active font on the context and measure a sample monospace glyph ("M").
 * Side effect: leaves `ctx.font` set to the requested style, so subsequent draws use it.
 */
export function measureCell(
  ctx: CanvasRenderingContext2D,
  style: GridStyle,
): CellMetrics {
  ctx.font = `${style.fontSizePx}px ${style.fontFamily}`;
  const m = ctx.measureText('M');
  const ascent = m.fontBoundingBoxAscent ?? style.fontSizePx * 0.8;
  const descent = m.fontBoundingBoxDescent ?? style.fontSizePx * 0.2;
  return {
    cellWidth: m.width,
    cellHeight: ascent + descent,
    baseline: ascent,
    fontFamily: style.fontFamily,
    fontSizePx: style.fontSizePx,
  };
}

/**
 * Size the canvas backing store to match device-pixel ratio so text is crisp on Retina/HiDPI.
 */
export function fitCanvas(
  canvas: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number,
): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  canvas.width = Math.floor(cssWidth * dpr);
  canvas.height = Math.floor(cssHeight * dpr);
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/**
 * Paint one cell with already-measured metrics.
 *
 * Step 7: honours `cell.attrs` (bit-flags) —
 *   ATTR_INVERSE   swap fg ↔ bg
 *   ATTR_BOLD      `bold` weight in the font string
 *   ATTR_ITALIC    `italic` style in the font string
 *   ATTR_UNDERLINE thin horizontal stroke at the cell baseline
 *
 * We always set `ctx.font` per-glyph (when there's a char to draw) because the previous cell
 * may have left a different weight/italic active. That's one cheap string allocation + parse
 * per non-space cell. Step 8's glyph cache reduces this further; numbers first.
 *
 * Spaces still skip `fillText`. Underline strokes draw even on spaces (so an "underlined
 * space" looks like the underscore-on-a-blank you'd see in xterm).
 */
export function drawCell(
  ctx: CanvasRenderingContext2D,
  cell: Cell,
  col: number,
  row: number,
  m: CellMetrics,
): void {
  paintCellAt(ctx, cell, col * m.cellWidth, row * m.cellHeight, m);
}

/**
 * Paint a cell's visual into `ctx` at pixel coordinates `(px, py)` (CSS pixels). The grid-aware
 * `drawCell` and the glyph cache's offscreen renderer (which paints at the origin) both delegate
 * here, so the styling logic lives in exactly one place.
 */
export function paintCellAt(
  ctx: CanvasRenderingContext2D,
  cell: Cell,
  px: number,
  py: number,
  m: CellMetrics,
): void {
  const attrs = cell.attrs ?? 0;
  const inverse = (attrs & ATTR_INVERSE) !== 0;
  const fg = inverse ? cell.bg : cell.fg;
  const bg = inverse ? cell.fg : cell.bg;

  ctx.fillStyle = bg;
  ctx.fillRect(px, py, m.cellWidth, m.cellHeight);

  if (cell.char !== ' ') {
    const bold = (attrs & ATTR_BOLD) !== 0;
    const italic = (attrs & ATTR_ITALIC) !== 0;
    // CSS font shorthand order: <style> <weight> <size> <family>.
    ctx.font =
      (italic ? 'italic ' : '') +
      (bold ? 'bold ' : '') +
      `${m.fontSizePx}px ${m.fontFamily}`;
    ctx.fillStyle = fg;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(cell.char, px, py + m.baseline);
  }

  if ((attrs & ATTR_UNDERLINE) !== 0) {
    const thickness = Math.max(1, Math.floor(m.cellHeight * 0.08));
    ctx.fillStyle = fg;
    ctx.fillRect(px, py + m.cellHeight - thickness, m.cellWidth, thickness);
  }
}

/**
 * Paint a cell via the glyph cache: blit a pre-rendered bitmap instead of re-running
 * fillRect + font-set + fillText. Trivial cells (a blank with no underline/inverse) take a
 * fast path — a single `fillRect` beats a `drawImage` of a solid rectangle — so the cache only
 * holds the cells where it actually pays off (styled glyphs).
 */
export function drawCellCached(
  ctx: CanvasRenderingContext2D,
  cell: Cell,
  col: number,
  row: number,
  m: CellMetrics,
  cache: GlyphCache,
): void {
  const attrs = cell.attrs ?? 0;
  const x = col * m.cellWidth;
  const y = row * m.cellHeight;

  if (cell.char === ' ' && (attrs & (ATTR_UNDERLINE | ATTR_INVERSE)) === 0) {
    ctx.fillStyle = cell.bg;
    ctx.fillRect(x, y, m.cellWidth, m.cellHeight);
    return;
  }

  const bmp = cache.getOrRender(cell, m);
  ctx.drawImage(bmp, x, y, m.cellWidth, m.cellHeight);
}

/**
 * Build a glyph cache that renders cells with `paintCellAt` into DPR-scaled offscreen canvases.
 * Lives here (not in glyph-cache.ts) so the cache module stays DOM-free and testable.
 */
export function createDomGlyphCache(dpr: number, maxEntries: number = 4096): GlyphCache {
  const renderer: GlyphRenderer = (cell, m) => {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(m.cellWidth * dpr));
    c.height = Math.max(1, Math.ceil(m.cellHeight * dpr));
    const offCtx = c.getContext('2d');
    if (!offCtx) throw new Error('createDomGlyphCache: 2d context unavailable');
    // Draw in CSS pixels; the DPR transform scales to the backing store 1:1 with the main ctx.
    offCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintCellAt(offCtx, cell, 0, 0, m);
    return c;
  };
  return new GlyphCache(renderer, maxEntries);
}

/** Paint a row's worth of cells. Used by both `drawScreen` and `drawScreenDirty`. */
function paintRow(
  ctx: CanvasRenderingContext2D,
  screen: Screen,
  row: number,
  m: CellMetrics,
  cache: GlyphCache | null,
): void {
  for (let c = 0; c < screen.cols; c++) {
    const cell = screen.get(c, row);
    if (cache) drawCellCached(ctx, cell, c, row, m, cache);
    else drawCell(ctx, cell, c, row, m);
  }
}

/**
 * Paint the entire Screen onto a canvas. Unconditional "paint everything." Composites the
 * cursor on top if it's visible and within the viewport. Clears `screen.dirty` at the end.
 */
export function drawScreen(
  canvas: HTMLCanvasElement,
  screen: Screen,
  style: GridStyle,
  cursor: Cursor | null = null,
  cache: GlyphCache | null = null,
): CellMetrics {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('drawScreen: 2d context unavailable');
  const m = measureCell(ctx, style);

  for (let r = 0; r < screen.rows; r++) paintRow(ctx, screen, r, m, cache);
  if (cursor && cursor.visible) drawCursor(ctx, cursor, screen, m);

  screen.clearDirty();
  return m;
}

/**
 * Paint only the rows in `screen.dirty`. Composites the cursor on top if its current viewport
 * row was among those painted. Clears `screen.dirty` at the end. Returns rows painted.
 */
export function drawScreenDirty(
  canvas: HTMLCanvasElement,
  screen: Screen,
  style: GridStyle,
  cursor: Cursor | null = null,
  cache: GlyphCache | null = null,
): number {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('drawScreenDirty: 2d context unavailable');
  const m = measureCell(ctx, style);

  // Decide whether the cursor needs compositing *before* we clear dirty.
  const cursorRow = cursor ? cursorViewportRow(cursor, screen) : null;
  const cursorRowDirty = cursorRow !== null && screen.dirty.has(cursorRow);

  let rowsPainted = 0;
  for (const r of screen.dirty) {
    paintRow(ctx, screen, r, m, cache);
    rowsPainted++;
  }
  if (cursor && cursor.visible && cursorRowDirty) {
    drawCursor(ctx, cursor, screen, m);
  }

  screen.clearDirty();
  return rowsPainted;
}
