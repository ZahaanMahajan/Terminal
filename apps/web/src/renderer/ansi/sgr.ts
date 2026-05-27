/**
 * renderer/ansi/sgr.ts — Select Graphic Rendition (CSI … m) handling.
 *
 * SGR is a sequence of integer parameters; each parameter (or small group of consecutive
 * parameters in the case of 256-color / truecolor) changes part of the pen state.
 *
 * What this module implements:
 *   - `0` (no param, or 0): reset all attributes (fg + bg back to defaults).
 *   - `30..37`           : standard 8-color foreground.
 *   - `38;5;N`           : 256-color foreground (where N is the palette index).
 *   - `38;2;R;G;B`       : truecolor foreground.
 *   - `39`               : reset foreground to default.
 *   - `40..47`, `48;…`, `49` : same for background.
 *   - `90..97` / `100..107`  : bright (high-intensity) foreground / background.
 *
 * What this module deliberately ignores (for now; one-line additions later when Cell carries
 * style attributes):
 *   - `1` bold / `2` dim / `3` italic / `4` underline / `5` blink / `7` inverse / `9` strikethrough
 *   - `22`/`23`/`24`/`25`/`27`/`29` corresponding "off" codes
 *
 * Unknown SGR codes are skipped silently. This is the standard posture — terminals are
 * supposed to be tolerant of styles they don't render.
 *
 * The 16-color palette is the "VGA"-ish set most terminals default to. It's close to xterm's
 * defaults. Themable later (a `palette` arg to `applySgr`) when we add the theme system.
 */

import type { Pen } from '../cursor';
import {
  DEFAULT_FG,
  DEFAULT_BG,
  ATTR_BOLD,
  ATTR_ITALIC,
  ATTR_UNDERLINE,
  ATTR_INVERSE,
} from '../cell';

/**
 * Standard 16-color palette. Indexes 0..7 are the normal set; 8..15 are the "bright" set used
 * for SGR 90..97 / 100..107. Colors chosen close to xterm defaults so demo output looks right.
 */
const ANSI_16: readonly string[] = [
  // normal
  '#000000', '#cc0000', '#4e9a06', '#c4a000',
  '#3465a4', '#75507b', '#06989a', '#d3d7cf',
  // bright
  '#555753', '#ef2929', '#8ae234', '#fce94f',
  '#729fcf', '#ad7fa8', '#34e2e2', '#eeeeec',
];

function clamp8(n: number): number {
  return Math.max(0, Math.min(255, n | 0));
}

function rgbHex(r: number, g: number, b: number): string {
  const h = (n: number) => clamp8(n).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/**
 * Look up a 256-color palette index. 0..15 are the 16-color set; 16..231 form a 6×6×6 cube;
 * 232..255 are a 24-step grayscale ramp.
 *
 * The cube uses the xterm step values: 0 for step 0, then 95 + 40·(step − 1) for steps 1..5.
 * (i.e. 95, 135, 175, 215, 255). The grayscale ramp uses 8 + 10·step.
 */
export function ansi256(n: number): string {
  if (n < 16) return ANSI_16[n];
  if (n < 232) {
    const i = n - 16;
    const r = Math.floor(i / 36);
    const g = Math.floor((i / 6) % 6);
    const b = i % 6;
    const step = (s: number) => (s === 0 ? 0 : 55 + s * 40);
    return rgbHex(step(r), step(g), step(b));
  }
  const gray = 8 + (n - 232) * 10;
  return rgbHex(gray, gray, gray);
}

/**
 * Apply an SGR parameter list to a pen, mutating it in place.
 *
 * Empty params (CSI m with no numbers) → reset, matching xterm behavior.
 */
export function applySgr(params: number[], pen: Pen): void {
  if (params.length === 0) {
    pen.fg = DEFAULT_FG;
    pen.bg = DEFAULT_BG;
    pen.attrs = 0;
    return;
  }

  let i = 0;
  while (i < params.length) {
    const p = params[i];

    if (p === 0) {
      pen.fg = DEFAULT_FG;
      pen.bg = DEFAULT_BG;
      pen.attrs = 0;
      i++;
      continue;
    }

    // ── Style attributes (step 7) ────────────────────────────────────────
    if (p === 1) { pen.attrs |= ATTR_BOLD;      i++; continue; }
    if (p === 3) { pen.attrs |= ATTR_ITALIC;    i++; continue; }
    if (p === 4) { pen.attrs |= ATTR_UNDERLINE; i++; continue; }
    if (p === 7) { pen.attrs |= ATTR_INVERSE;   i++; continue; }
    // 22 = "normal intensity" (bold off + dim off; we only track bold).
    if (p === 22) { pen.attrs &= ~ATTR_BOLD;      i++; continue; }
    if (p === 23) { pen.attrs &= ~ATTR_ITALIC;    i++; continue; }
    if (p === 24) { pen.attrs &= ~ATTR_UNDERLINE; i++; continue; }
    if (p === 27) { pen.attrs &= ~ATTR_INVERSE;   i++; continue; }

    // Foreground
    if (p >= 30 && p <= 37) {
      pen.fg = ANSI_16[p - 30];
      i++;
      continue;
    }
    if (p === 38) {
      const sub = params[i + 1];
      if (sub === 5) {
        pen.fg = ansi256(params[i + 2] ?? 0);
        i += 3;
        continue;
      }
      if (sub === 2) {
        pen.fg = rgbHex(params[i + 2] ?? 0, params[i + 3] ?? 0, params[i + 4] ?? 0);
        i += 5;
        continue;
      }
      i++; // malformed; skip just this code
      continue;
    }
    if (p === 39) {
      pen.fg = DEFAULT_FG;
      i++;
      continue;
    }
    if (p >= 90 && p <= 97) {
      pen.fg = ANSI_16[p - 90 + 8];
      i++;
      continue;
    }

    // Background
    if (p >= 40 && p <= 47) {
      pen.bg = ANSI_16[p - 40];
      i++;
      continue;
    }
    if (p === 48) {
      const sub = params[i + 1];
      if (sub === 5) {
        pen.bg = ansi256(params[i + 2] ?? 0);
        i += 3;
        continue;
      }
      if (sub === 2) {
        pen.bg = rgbHex(params[i + 2] ?? 0, params[i + 3] ?? 0, params[i + 4] ?? 0);
        i += 5;
        continue;
      }
      i++;
      continue;
    }
    if (p === 49) {
      pen.bg = DEFAULT_BG;
      i++;
      continue;
    }
    if (p >= 100 && p <= 107) {
      pen.bg = ANSI_16[p - 100 + 8];
      i++;
      continue;
    }

    // Unknown SGR (bold/italic/underline/…): silently skip for now.
    i++;
  }
}
