import { useEffect, useRef, useState } from 'react';
import {
  AnsiParser,
  Screen,
  feed,
  fitCanvas,
  makeCursor,
  measureCell,
  moveCursor,
  startRenderLoop,
  type GridStyle,
  type LoopStats,
} from './renderer';

/**
 * App — Phase 1, step 6 mount.
 *
 * The demo session is now a real ANSI byte-stream fed through the parser → interpreter rather
 * than hand-stamped colored lines. Same visual outcome, but every glyph and color comes from
 * the same code path a real terminal would use.
 *
 * Interactions still work: wheel scrolls, click moves the cursor, the cols selector triggers
 * reflow.
 */

const STYLE: GridStyle = {
  fontFamily: '"JetBrains Mono", "Menlo", "Consolas", ui-monospace, monospace',
  fontSizePx: 16,
};

const INITIAL_COLS = 80;
const ROWS = 16;
const SCROLLBACK = 4000;
const COLS_CHOICES = [40, 60, 80, 100, 120];

/** Format a `\x1b[38;2;R;G;Bm` truecolor SGR from a `#rrggbb` string. */
function sgrTruecolor(hex: string, bg = false): string {
  const m = hex.replace('#', '').match(/.{2}/g)!;
  const r = parseInt(m[0], 16);
  const g = parseInt(m[1], 16);
  const b = parseInt(m[2], 16);
  return `\x1b[${bg ? 48 : 38};2;${r};${g};${b}m`;
}
const RESET = '\x1b[0m';

/** Wrap a string in fg color via truecolor SGR. */
const fg = (color: string, text: string): string =>
  `${sgrTruecolor(color)}${text}${RESET}`;

const C_MUTED = '#6b7280';
const C_SUCCESS = '#34d399';
const C_WARN = '#f59e0b';
const C_DANGER = '#ef4444';
const C_INFO = '#06b6d4';

/** Compose a demo session as a single ANSI byte-string. CR-LF between lines (VT-correct). */
function buildSession(): string {
  const lines: string[] = [];
  const NL = '\r\n';

  // Use real CSI 16-color sequences for the prompts ("\x1b[33m" = yellow fg) — mixes
  // 16-color and truecolor in one stream so both code paths are exercised in the demo.
  const prompt = `\x1b[33m$\x1b[0m`;

  lines.push(`${prompt} git log --oneline -5`);
  lines.push(fg(C_WARN, 'a1b2c3d  ansi parser: VT100 state machine + SGR + cursor + erase'));
  lines.push(fg(C_WARN, 'f4e5d6c  wrap + reflow + 65→? tests'));
  lines.push(fg(C_WARN, '987abcd  scrollback ring buffer + viewport Screen + line-anchored cursor'));
  lines.push(fg(C_WARN, '654321a  scaffold: Vite + React + TS + Tailwind v4'));
  lines.push(fg(C_WARN, '012345b  init: empty Termi repo'));
  lines.push('');

  // Demo using \x1b[31m / \x1b[1;33m style sequences directly:
  lines.push(`${prompt} printf "${'\\033[31m'}red${'\\033[32m'} green${'\\033[33m'} yellow${'\\033[34m'} blue${'\\033[0m'}\\n"`);
  lines.push(`\x1b[31mred\x1b[32m green\x1b[33m yellow\x1b[34m blue\x1b[0m`);
  lines.push('');

  // Style attrs demo (step 7): bold, italic, underline, inverse — alone and combined.
  lines.push(`${prompt} styles:  \x1b[1mbold\x1b[0m  \x1b[3mitalic\x1b[0m  \x1b[4munderline\x1b[0m  \x1b[7minverse\x1b[0m  \x1b[1;3;4mbold-italic-underline\x1b[0m`);
  lines.push(`${prompt} colored: \x1b[1;31mbold red\x1b[0m  \x1b[3;32mitalic green\x1b[0m  \x1b[4;33munderline yellow\x1b[0m  \x1b[7;34minverse blue\x1b[0m`);
  lines.push('');

  // 256-color ramp
  const ramp = `${prompt} for i in 196 202 208 214 220 226 190 154 118 82 46 47 48 49 50 51; do echo -n "${'\\033[38;5;'}\${i}m██${'\\033[0m'}"; done; echo`;
  lines.push(ramp);
  let band = '';
  for (const n of [196, 202, 208, 214, 220, 226, 190, 154, 118, 82, 46, 47, 48, 49, 50, 51, 75, 105, 135, 165, 201]) {
    band += `\x1b[38;5;${n}m██`;
  }
  band += RESET;
  lines.push(band);
  lines.push('');

  lines.push(`${prompt} printf "the screen is a view; scrollback is the truth; ansi is the protocol${RESET}\\n"`);
  lines.push(fg(C_SUCCESS, 'the screen is a view; scrollback is the truth; ansi is the protocol'));
  lines.push('');

  lines.push(`${prompt} ls -la src/renderer`);
  lines.push(fg(C_INFO, 'drwxr-xr-x  cell.ts       — Cell + emptyCell'));
  lines.push(fg(C_INFO, 'drwxr-xr-x  scrollback.ts — ring buffer of lines + per-id wrap flags'));
  lines.push(fg(C_INFO, 'drwxr-xr-x  screen.ts     — view over scrollback + write/println/setCols'));
  lines.push(fg(C_INFO, 'drwxr-xr-x  cursor.ts     — anchored to absolute lineId + pen'));
  lines.push(fg(C_INFO, 'drwxr-xr-x  reflow.ts     — extract → trim → rebuild + cursor remap'));
  lines.push(fg(C_INFO, 'drwxr-xr-x  loop.ts       — rAF + blink + LoopStats'));
  lines.push(fg(C_INFO, 'drwxr-xr-x  ansi/         — parser + interpreter + SGR'));
  lines.push(fg(C_INFO, 'drwxr-xr-x  index.ts      — drawing primitives'));
  lines.push('');

  lines.push(`${prompt} vitest run`);
  lines.push(fg(C_SUCCESS, ' RUN  v4.1.7  passed (90+ tests across 6 files)'));
  lines.push('');

  // some "log" lines with warn/error sprinkled, varying length so wrap is visible
  for (let i = 0; i < 60; i++) {
    if (i % 11 === 0) {
      lines.push(`${fg(C_WARN, '[warn ]')} a long-ish line so wrap is visible at cols=40 and cols=60 — ${i}`);
    } else if (i % 17 === 0) {
      lines.push(`${fg(C_DANGER, '[error]')} something went wrong in the imaginary build pipeline — ${i}`);
    } else if (i % 5 === 0) {
      lines.push(`${fg(C_MUTED, '[info ]')} a routine log line of moderate length — ${i}`);
    } else {
      lines.push(fg(C_MUTED, `... build event ${i} (mundane)`));
    }
  }

  lines.push('');
  lines.push(`${prompt} `); // empty final prompt; cursor will land just after the space

  return lines.join(NL);
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const resizeRef = useRef<((cols: number) => void) | null>(null);
  const [activeCols, setActiveCols] = useState(INITIAL_COLS);
  const [hud, setHud] = useState({
    fps: 0,
    paintMs: 0,
    rowsPainted: 0,
    paints: 0,
    idle: true,
    linesAbove: 0,
    linesBelow: 0,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const probe = canvas.getContext('2d');
    if (!probe) return;

    const m = measureCell(probe, STYLE);
    const cssH = Math.ceil(m.cellHeight * ROWS);
    fitCanvas(canvas, Math.ceil(m.cellWidth * INITIAL_COLS), cssH);

    const screen = new Screen(INITIAL_COLS, ROWS, SCROLLBACK);
    const cursor = makeCursor(0, 0, 'block');
    const parser = new AnsiParser();
    feed(buildSession(), screen, cursor, parser);

    const onClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const col = Math.floor(x / m.cellWidth);
      const viewportRow = Math.floor(y / m.cellHeight);
      if (col < 0 || col >= screen.cols) return;
      if (viewportRow < 0 || viewportRow >= screen.rows) return;
      moveCursor(cursor, screen, col, screen.viewportTop + viewportRow);
    };
    canvas.addEventListener('click', onClick);

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const lines = Math.round(e.deltaY / m.cellHeight);
      if (lines !== 0) screen.scrollBy(lines);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });

    resizeRef.current = (newCols: number) => {
      screen.setCols(newCols, cursor);
      fitCanvas(canvas, Math.ceil(m.cellWidth * newCols), cssH);
      screen.markAllDirty();
    };

    let lastHudUpdate = 0;
    const updateHud = (stats: Readonly<LoopStats>) => {
      const now = performance.now();
      if (now - lastHudUpdate < 200) return;
      lastHudUpdate = now;
      setHud({
        fps: stats.lastFrameMs > 0 ? 1000 / stats.lastFrameMs : 0,
        paintMs: stats.lastPaintMs,
        rowsPainted: stats.lastRowsPainted,
        paints: stats.paintsDone,
        idle: stats.lastRowsPainted === 0,
        linesAbove: screen.linesAbove,
        linesBelow: screen.linesBelow,
      });
    };

    const stop = startRenderLoop(canvas, screen, STYLE, cursor, { onFrame: updateHud });

    return () => {
      stop();
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('wheel', onWheel);
      resizeRef.current = null;
    };
  }, []);

  const onPickCols = (cols: number) => {
    resizeRef.current?.(cols);
    setActiveCols(cols);
  };

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-200 flex flex-col items-center justify-center gap-6 p-8 font-mono">
      <header className="text-xs uppercase tracking-widest text-neutral-500">
        termi · phase 1 · step 6 — ansi parser
      </header>

      <canvas
        ref={canvasRef}
        className="border border-neutral-800 rounded shadow-lg cursor-crosshair"
        aria-label="Terminal viewport rendered from an ANSI byte stream"
      />

      <div className="flex items-center gap-2 text-[11px]">
        <span className="text-neutral-500">cols</span>
        {COLS_CHOICES.map((c) => (
          <button
            key={c}
            onClick={() => onPickCols(c)}
            className={[
              'px-2 py-1 rounded border font-mono transition-colors',
              c === activeCols
                ? 'border-violet-500 bg-violet-500/10 text-violet-300'
                : 'border-neutral-800 text-neutral-400 hover:border-neutral-600 hover:text-neutral-200',
            ].join(' ')}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="font-mono text-[11px] text-neutral-400 flex flex-wrap gap-4 items-center bg-neutral-900/60 border border-neutral-800 rounded px-3 py-1.5">
        <span>
          <span className="text-neutral-500">fps</span>{' '}
          <span className="text-neutral-200">{hud.fps.toFixed(1)}</span>
        </span>
        <span className="text-neutral-700">·</span>
        <span>
          <span className="text-neutral-500">paint</span>{' '}
          {hud.idle ? (
            <span className="text-emerald-400">idle</span>
          ) : (
            <span className="text-neutral-200">{hud.paintMs.toFixed(2)}ms</span>
          )}
        </span>
        <span className="text-neutral-700">·</span>
        <span>
          <span className="text-neutral-500">rows</span>{' '}
          <span className="text-neutral-200">{hud.rowsPainted}</span>
        </span>
        <span className="text-neutral-700">·</span>
        <span>
          <span className="text-neutral-500">paints</span>{' '}
          <span className="text-neutral-200">{hud.paints}</span>
        </span>
        <span className="text-neutral-700">·</span>
        <span>
          <span className="text-neutral-500">scroll</span>{' '}
          {hud.linesBelow === 0 ? (
            <span className="text-emerald-400">bottom</span>
          ) : (
            <span className="text-amber-400">−{hud.linesBelow}</span>
          )}
          <span className="text-neutral-600">
            {' '}({hud.linesAbove}/{hud.linesAbove + ROWS + hud.linesBelow})
          </span>
        </span>
      </div>

      <p className="text-xs text-neutral-500 max-w-xl text-center leading-relaxed">
        every glyph and color above came from a real ANSI byte stream fed through the parser →
        interpreter — including 16-color, 256-color, and truecolor SGR.
      </p>
    </main>
  );
}
