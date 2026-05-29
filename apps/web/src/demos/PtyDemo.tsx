import { useEffect, useRef, useState } from 'react';
import {
  AnsiParser,
  Screen,
  createDomGlyphCache,
  feed,
  fitCanvas,
  makeCursor,
  measureCell,
  startRenderLoop,
  type GridStyle,
} from '../renderer';
import { InputLayer } from '../input';
import { PtyClient, keyToBytes } from '../pty';

/**
 * PtyDemo — Phase 5, step 2: the in-browser terminal wired to a REAL shell.
 *
 * Keys → keyToBytes → WebSocket → PTY stdin; PTY stdout → WebSocket → the Phase 1 ANSI renderer.
 * No local executor, no fake filesystem — this is your actual `$SHELL`. The PTY's slave applies
 * `onlcr`, so its output already has `\r\n` (we feed it raw, unlike the fake-shell demo).
 *
 * Needs the backend running (`cd services/pty && npm install && npm start`); when it's down, the
 * status line shows how to start it. Line-oriented programs (bash, ls, git, python) work now;
 * full-screen apps (vim/htop) need alt-screen, which the renderer gains in the next step.
 */

const STYLE: GridStyle = {
  fontFamily: '"JetBrains Mono", "Menlo", "Consolas", ui-monospace, monospace',
  fontSizePx: 15,
};
const INITIAL_COLS = 80;
const ROWS = 24;
const COLS_CHOICES = [80, 100, 120];

type Status =
  | { kind: 'connecting' }
  | { kind: 'connected' }
  | { kind: 'exited'; code: number }
  | { kind: 'error'; message: string };

export function PtyDemo() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const connectRef = useRef<(() => void) | null>(null);
  const resizeRef = useRef<((cols: number) => void) | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'connecting' });
  const [activeCols, setActiveCols] = useState(INITIAL_COLS);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const probe = canvas.getContext('2d');
    if (!probe) return;

    const m = measureCell(probe, STYLE);
    const cssH = Math.ceil(m.cellHeight * ROWS);
    fitCanvas(canvas, Math.ceil(m.cellWidth * INITIAL_COLS), cssH);

    const screen = new Screen(INITIAL_COLS, ROWS, 5000);
    const cursor = makeCursor(0, 0, 'block');
    const parser = new AnsiParser();
    const cache = createDomGlyphCache(window.devicePixelRatio || 1);
    const feedT = (s: string) => feed(s, screen, cursor, parser); // PTY output already has \r\n

    let client: PtyClient | null = null;
    let cols = INITIAL_COLS;

    const connect = () => {
      client?.close();
      setStatus({ kind: 'connecting' });
      client = new PtyClient({
        onOpen: () => setStatus({ kind: 'connected' }),
        onData: (data) => feedT(data),
        onExit: (code) => {
          feedT(`\r\n\x1b[90m[process exited: ${code}]\x1b[0m\r\n`);
          setStatus({ kind: 'exited', code });
        },
        onError: (message) => setStatus({ kind: 'error', message }),
      });
      void client.connect({ cols, rows: ROWS });
    };
    connectRef.current = connect;

    resizeRef.current = (newCols: number) => {
      cols = newCols;
      screen.setCols(newCols, cursor);
      fitCanvas(canvas, Math.ceil(m.cellWidth * newCols), cssH);
      screen.markAllDirty();
      client?.resize(newCols, ROWS); // → SIGWINCH; the program reflows
    };

    const input = new InputLayer({
      // A focused terminal captures Ctrl-W/R/L etc. like the real thing; only Cmd stays with the browser.
      reservedGuard: (k) => k.mods.meta,
      onKey: (key, e) => {
        const bytes = keyToBytes(key, e.key);
        if (bytes !== null) client?.sendInput(bytes);
        return true;
      },
    });
    input.attach(canvas);

    const stop = startRenderLoop(canvas, screen, STYLE, cursor, { getCache: () => cache });
    connect();
    canvas.focus();

    return () => {
      stop();
      input.detach();
      client?.close();
      connectRef.current = null;
      resizeRef.current = null;
    };
  }, []);

  const onPickCols = (c: number) => {
    resizeRef.current?.(c);
    setActiveCols(c);
  };

  return (
    <main className="flex-1 flex flex-col items-center justify-center gap-4 p-6 font-mono">
      <header className="text-xs uppercase tracking-widest text-neutral-500">
        phase 5 — real PTY · step 2: your actual shell, in the browser
      </header>

      {/* status bar */}
      <div className="w-[min(900px,92vw)] flex flex-wrap items-center gap-3 text-[11px]">
        <StatusBadge status={status} />
        <span className="text-neutral-700">·</span>
        <span className="text-neutral-500">cols</span>
        {COLS_CHOICES.map((c) => (
          <button
            key={c}
            onClick={() => onPickCols(c)}
            className={[
              'px-2 py-0.5 rounded border transition-colors',
              c === activeCols
                ? 'border-violet-500 bg-violet-500/10 text-violet-300'
                : 'border-neutral-800 text-neutral-400 hover:border-neutral-600',
            ].join(' ')}
          >
            {c}
          </button>
        ))}
        {(status.kind === 'error' || status.kind === 'exited') && (
          <button
            onClick={() => connectRef.current?.()}
            className="px-2 py-0.5 rounded border border-emerald-700 text-emerald-300 hover:bg-emerald-900/20"
          >
            reconnect
          </button>
        )}
      </div>

      {status.kind === 'error' && (
        <div className="w-[min(900px,92vw)] text-[11px] text-amber-300 border border-amber-800/50 bg-amber-900/10 rounded px-3 py-2">
          {status.message}
        </div>
      )}

      <canvas
        ref={canvasRef}
        tabIndex={0}
        className="border border-neutral-800 rounded shadow-lg outline-none focus:border-violet-500/60 cursor-text"
        aria-label="A real shell running over a PTY"
      />

      <p className="text-xs text-neutral-500 max-w-xl text-center leading-relaxed">
        keystroke → <code className="text-neutral-300">keyToBytes</code> → WebSocket → PTY stdin;
        stdout → the ANSI renderer. try <code className="text-neutral-300">ls</code>,{' '}
        <code className="text-neutral-300">git status</code>, <code className="text-neutral-300">sleep 5</code>{' '}
        then <code className="text-neutral-300">Ctrl-C</code>. full-screen apps (vim/htop) need
        alt-screen — next step.
      </p>
    </main>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const map: Record<Status['kind'], { label: string; cls: string }> = {
    connecting: { label: '● connecting', cls: 'text-amber-300' },
    connected: { label: '● connected', cls: 'text-emerald-300' },
    exited: { label: '● exited', cls: 'text-neutral-400' },
    error: { label: '● offline', cls: 'text-red-400' },
  };
  const { label, cls } = map[status.kind];
  return <span className={cls}>{label}</span>;
}
