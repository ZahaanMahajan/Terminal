import { useEffect, useRef } from "react";
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
} from "../renderer";
import { InputLayer, KeyResolver, Keymap } from "../input";
import {
  Env,
  FileSystem,
  History,
  LineEditor,
  complete,
  renderPrompt,
  run,
  type SearchHit,
} from "../shell";

/**
 * ShellDemo — Phase 3 capstone (step 4). The REPL that connects all three phases:
 *   keystrokes  → Phase 2 InputLayer + KeyResolver (control keys → named editor actions)
 *   a command   → Phase 3 tokenizer → parser → executor (`run`)
 *   the display  → Phase 1 terminal (the shell emits ANSI; the renderer paints it)
 *
 * The line editor talks to the terminal exactly like a real shell + readline: it emits ANSI to
 * redraw the current line (`\r` + prompt + text + erase-to-EOL + CHA to position the cursor).
 * Single-line input only (no wrap handling) — the documented simplification.
 */

const STYLE: GridStyle = {
  fontFamily: '"JetBrains Mono", "Menlo", "Consolas", ui-monospace, monospace',
  fontSizePx: 15,
};
const COLS = 84;
const ROWS = 26;

function seedFs(): FileSystem {
  return FileSystem.from({
    home: {
      you: {
        "readme.md":
          "# Terminal\n\nA terminal built from scratch — renderer, keyboard, shell.\n",
        ".bashrc": "export EDITOR=termi\n",
        projects: {
          termi: {
            "TODO.txt":
              "phase 1: renderer\nphase 2: keyboard\nphase 3: shell\n",
            src: { "main.ts": 'console.log("hello")\n' },
          },
        },
        notes: { "todo.txt": "buy milk\n", "ideas.txt": "build a terminal\n" },
      },
    },
    etc: { hostname: "termi\n" },
    tmp: {},
  });
}

export function ShellDemo() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const probe = canvas.getContext("2d");
    if (!probe) return;

    // ── Terminal (Phase 1) ──
    const m = measureCell(probe, STYLE);
    fitCanvas(
      canvas,
      Math.ceil(m.cellWidth * COLS),
      Math.ceil(m.cellHeight * ROWS),
    );
    const screen = new Screen(COLS, ROWS, 5000);
    const cursor = makeCursor(0, 0, "block");
    const parser = new AnsiParser();
    const cache = createDomGlyphCache(window.devicePixelRatio || 1);
    // The terminal runs "cooked" (ONLCR): a bare `\n` becomes `\r\n` so every line starts at
    // column 0. Our VT interpreter keeps LF column-preserving (correct for a raw terminal) — on
    // a real system the tty layer does this translation; here the REPL is the tty. Without it,
    // command output that ends in `\n` leaves the cursor mid-line and the next prompt is offset.
    const feedT = (s: string) =>
      feed(s.replace(/\r?\n/g, "\r\n"), screen, cursor, parser);

    // ── Shell (Phase 3) ──
    const env = new Env(
      { USER: "you", HOME: "/home/you", SHELL: "/bin/termi" },
      "/home/you",
    );
    const fs = seedFs();
    const editor = new LineEditor();
    const history = new History();

    // ── Reverse-search state ──
    let rsActive = false;
    let rsQuery = "";
    let rsHit: SearchHit | null = null;

    const prompt = () => renderPrompt(env);

    /** Redraw the input line in place: CR, prompt+text, clear to EOL, position the cursor. */
    const redraw = () => {
      const p = prompt();
      feedT(
        "\r" +
          p.ansi +
          editor.text +
          "\x1b[K" +
          `\x1b[${p.width + editor.cursor + 1}G`,
      );
    };

    const redrawSearch = () => {
      const shown = rsHit ? rsHit.line : "";
      feedT("\r" + `(reverse-i-search)\`${rsQuery}': ${shown}` + "\x1b[K");
    };

    const newPrompt = () => {
      editor.clear();
      feedT(prompt().ansi);
    };

    const submit = () => {
      const line = editor.text;
      feedT("\r\n");
      if (line.trim()) {
        const result = run(line, env, fs);
        feedT(result.output);
        // Ensure the next prompt starts at column 0. Check the terminal cursor (robust) rather
        // than guessing from the output string — `clear` leaves the cursor homed with no \n.
        if (cursor.col !== 0) feedT("\r\n");
        history.add(line);
      } else {
        history.resetNav();
      }
      newPrompt();
    };

    const doComplete = () => {
      const r = complete(editor.text, editor.cursor, fs, env);
      if (r.insert) {
        editor.insert(r.insert);
        redraw();
      } else if (r.candidates.length > 1) {
        feedT("\r\n" + r.candidates.join("  ") + "\r\n");
        const p = prompt();
        feedT(p.ansi + editor.text + `\x1b[${p.width + editor.cursor + 1}G`);
      }
    };

    const acceptRS = () => {
      rsActive = false;
      if (rsHit) editor.set(rsHit.line);
      rsQuery = "";
      rsHit = null;
      redraw();
    };
    const cancelRS = () => {
      rsActive = false;
      rsQuery = "";
      rsHit = null;
      redraw();
    };

    const handleAction = (action: string): void => {
      // Reverse-search mode intercepts a few actions first.
      if (rsActive) {
        switch (action) {
          case "submit":
            acceptRS();
            submit();
            return;
          case "reverseSearch":
            rsHit = history.reverseSearch(
              rsQuery,
              rsHit ? rsHit.index : undefined,
            );
            redrawSearch();
            return;
          case "backspace":
            rsQuery = rsQuery.slice(0, -1);
            rsHit = history.reverseSearch(rsQuery);
            redrawSearch();
            return;
          case "cancel":
          case "rsCancel":
            cancelRS();
            return;
          default:
            acceptRS(); // any other key exits search, keeping the hit, then runs normally
            break;
        }
      }

      switch (action) {
        case "submit":
          submit();
          break;
        case "backspace":
          editor.backspace();
          redraw();
          break;
        case "delete":
          editor.del();
          redraw();
          break;
        case "left":
          editor.left();
          redraw();
          break;
        case "right":
          editor.right();
          redraw();
          break;
        case "home":
          editor.home();
          redraw();
          break;
        case "end":
          editor.end();
          redraw();
          break;
        case "killWordBack":
          editor.deleteWordBack();
          redraw();
          break;
        case "killEnd":
          editor.killToEnd();
          redraw();
          break;
        case "killStart":
          editor.killToStart();
          redraw();
          break;
        case "histPrev": {
          const l = history.prev(editor.text);
          if (l !== null) {
            editor.set(l);
            redraw();
          }
          break;
        }
        case "histNext": {
          const l = history.next();
          if (l !== null) {
            editor.set(l);
            redraw();
          }
          break;
        }
        case "complete":
          doComplete();
          break;
        case "reverseSearch":
          rsActive = true;
          rsQuery = "";
          rsHit = null;
          redrawSearch();
          break;
        case "cancel":
          feedT("^C\r\n");
          history.resetNav();
          newPrompt();
          break;
        case "clearScreen":
          feedT("\x1b[2J\x1b[H");
          redraw();
          break;
        case "rsCancel":
          break; // Esc outside search: no-op
      }
    };

    const keymap = new Keymap()
      .bind("line", "<enter>", "submit")
      .bind("line", "<C-m>", "submit")
      .bind("line", "<bspace>", "backspace")
      .bind("line", "<C-h>", "backspace")
      .bind("line", "<del>", "delete")
      .bind("line", "<left>", "left")
      .bind("line", "<C-b>", "left")
      .bind("line", "<right>", "right")
      .bind("line", "<C-f>", "right")
      .bind("line", "<C-a>", "home")
      .bind("line", "<C-e>", "end")
      .bind("line", "<C-w>", "killWordBack")
      .bind("line", "<C-k>", "killEnd")
      .bind("line", "<C-u>", "killStart")
      .bind("line", "<up>", "histPrev")
      .bind("line", "<C-p>", "histPrev")
      .bind("line", "<down>", "histNext")
      .bind("line", "<C-n>", "histNext")
      .bind("line", "<tab>", "complete")
      .bind("line", "<C-r>", "reverseSearch")
      .bind("line", "<C-c>", "cancel")
      .bind("line", "<C-l>", "clearScreen")
      .bind("line", "<esc>", "rsCancel")
      .bind("line", "<C-g>", "rsCancel");
    const resolver = new KeyResolver(keymap, "line");

    const input = new InputLayer({
      // A focused terminal captures Ctrl-W/R/L the way a real terminal does; only Cmd stays
      // with the browser. (Documented: Ctrl-R won't reload while this surface is focused.)
      reservedGuard: (k) => k.mods.meta,
      onKey: (key, e) => {
        const res = resolver.feed(key);
        for (const a of res.actions) handleAction(a);
        for (const _ of res.unbound) {
          const ch = e.key;
          if (
            ch.length === 1 &&
            !key.mods.ctrl &&
            !key.mods.alt &&
            !key.mods.meta
          ) {
            if (rsActive) {
              rsQuery += ch;
              rsHit = history.reverseSearch(rsQuery);
              redrawSearch();
            } else {
              editor.insert(ch);
              redraw();
            }
          }
        }
        return true;
      },
    });
    input.attach(canvas);

    // Welcome banner + first prompt.
    feedT(
      "\x1b[36mTermi shell\x1b[0m — a fake shell, built from scratch (Phase 3)\r\n",
    );
    feedT(
      "try: \x1b[33mls\x1b[0m · \x1b[33mcat readme.md\x1b[0m · " +
        '\x1b[33mecho "hi $USER" | tr a-z A-Z\x1b[0m · \x1b[33mcd projects\x1b[0m\r\n' +
        "\x1b[90mTab completes · ↑/↓ history · C-r search · C-a/C-e/C-w/C-k/C-u edit · C-l clear\x1b[0m\r\n\r\n",
    );
    newPrompt();
    canvas.focus();

    const stop = startRenderLoop(canvas, screen, STYLE, cursor, {
      getCache: () => cache,
    });

    return () => {
      stop();
      input.detach();
    };
  }, []);

  return (
    <main className="flex-1 flex flex-col items-center justify-center gap-4 p-6 font-mono">
      <header className="text-xs uppercase tracking-widest text-neutral-500">
        phase 3 — fake shell · step 4: line editor + history + completion + REPL
      </header>
      <canvas
        ref={canvasRef}
        tabIndex={0}
        className="border border-neutral-800 rounded shadow-lg outline-none focus:border-violet-500/60 cursor-text"
        aria-label="Interactive fake shell rendered in the terminal"
      />
      <p className="text-xs text-neutral-500 max-w-xl text-center leading-relaxed">
        a hand-written tokenizer → recursive-descent parser → executor over a
        fake filesystem, driven by the keyboard engine and painted by the
        terminal renderer. click to focus, then type. (a focused terminal
        captures <code className="text-neutral-300">Ctrl-R/W/L</code>.)
      </p>
    </main>
  );
}
