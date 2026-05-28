/**
 * renderer/loop.ts — the rAF render loop.
 *
 * Pattern: a single requestAnimationFrame loop wakes ~60 times per second. On each tick:
 *   1. Compute the inter-frame delta (for the FPS HUD).
 *   2. If the cursor's blink interval has elapsed, toggle its visibility and mark the cursor's
 *      *current viewport row* dirty (computed from `cursor.lineId - screen.viewportTop`).
 *      If the cursor is scrolled out of the viewport, the blink is a no-op for the renderer.
 *   3. If `screen.dirty.size > 0`, run `drawScreenDirty` and clear the set.
 *      Otherwise: do nothing. This is the *whole point* of dirty-row tracking — when nothing
 *      changes, the loop runs but doesn't paint, and the HUD shows `idle`.
 *   4. Invoke `onFrame(stats)` so a HUD can observe (the consumer must throttle their own React
 *      state updates; the loop itself never touches React).
 *
 * The loop is `pause`-able by calling the returned `stop` function. Stopping cancels the
 * pending rAF and never schedules another. Not resumable on purpose — call `startRenderLoop`
 * again to get a fresh one.
 */

import { drawScreenDirty } from './index';
import type { GridStyle } from './index';
import type { GlyphCache } from './glyph-cache';
import type { Screen } from './screen';
import type { Cursor } from './cursor';
import { cursorViewportRow } from './cursor';

export type LoopStats = {
  /** Wall-clock ms between this rAF callback and the previous one. ~16.7 at 60Hz. */
  lastFrameMs: number;
  /** Wall-clock ms spent inside drawScreenDirty on this tick. 0 if no paint this tick. */
  lastPaintMs: number;
  /** Exponential moving average of paint ms (updated only on paint ticks). Stable for a HUD. */
  avgPaintMs: number;
  /** Number of rows painted on this tick. 0 if no paint this tick. */
  lastRowsPainted: number;
  /** Total rAF callbacks since loop start. */
  framesSeen: number;
  /** Total ticks that resulted in a paint since loop start. */
  paintsDone: number;
};

export type LoopOptions = {
  /** Cursor blink interval. xterm's classic value is ~530ms. */
  blinkIntervalMs?: number;
  /** Called after each rAF callback (paint or skip). Consumers must throttle React updates. */
  onFrame?: (stats: Readonly<LoopStats>) => void;
  /**
   * Called each paint to choose the glyph cache (or `null` for the direct path). A getter, not
   * a value, so the consumer can toggle the cache at runtime for an A/B comparison.
   */
  getCache?: () => GlyphCache | null;
  /**
   * Called each tick; if it returns true the loop marks every row dirty before painting. Used
   * by a "stress" mode to measure steady-state full-screen repaint cost.
   */
  forceFullRepaint?: () => boolean;
};

/**
 * Start the render loop. Returns a `stop()` function; call it on cleanup.
 *
 * The loop forces a full repaint on start by marking every row dirty.
 */
export function startRenderLoop(
  canvas: HTMLCanvasElement,
  screen: Screen,
  style: GridStyle,
  cursor: Cursor | null,
  opts: LoopOptions = {},
): () => void {
  const blinkIntervalMs = opts.blinkIntervalMs ?? 530;
  let rafId: number | null = null;
  let stopped = false;

  const stats: LoopStats = {
    lastFrameMs: 0,
    lastPaintMs: 0,
    avgPaintMs: 0,
    lastRowsPainted: 0,
    framesSeen: 0,
    paintsDone: 0,
  };

  let lastFrameTs = performance.now();
  let lastBlinkTs = lastFrameTs;

  // Force a full repaint on the first tick.
  screen.markAllDirty();

  const tick = (ts: number) => {
    if (stopped) return;

    // 1. Frame timing.
    stats.lastFrameMs = ts - lastFrameTs;
    lastFrameTs = ts;
    stats.framesSeen++;

    // 2. Stress mode: force a full repaint this tick (for measuring worst-case paint cost).
    if (opts.forceFullRepaint?.()) screen.markAllDirty();

    // 3. Cursor blink — toggles visibility, marks the cursor's current viewport row dirty.
    //    If the cursor's lineId is scrolled out of view, no row gets marked (correct).
    if (cursor && ts - lastBlinkTs >= blinkIntervalMs) {
      cursor.visible = !cursor.visible;
      const row = cursorViewportRow(cursor, screen);
      if (row !== null) screen.markDirty(row);
      lastBlinkTs = ts;
    }

    // 4. Paint, but only if there's anything to paint.
    if (screen.dirty.size > 0) {
      const cache = opts.getCache?.() ?? null;
      const t0 = performance.now();
      const rowsPainted = drawScreenDirty(canvas, screen, style, cursor, cache);
      const dt = performance.now() - t0;
      stats.lastPaintMs = dt;
      // EMA so the HUD reads a stable number instead of per-frame jitter.
      stats.avgPaintMs = stats.avgPaintMs === 0 ? dt : stats.avgPaintMs * 0.9 + dt * 0.1;
      stats.lastRowsPainted = rowsPainted;
      stats.paintsDone++;
    } else {
      stats.lastPaintMs = 0;
      stats.lastRowsPainted = 0;
    }

    // 5. Observability.
    opts.onFrame?.(stats);

    rafId = requestAnimationFrame(tick);
  };

  rafId = requestAnimationFrame(tick);

  return () => {
    stopped = true;
    if (rafId !== null) cancelAnimationFrame(rafId);
  };
}
