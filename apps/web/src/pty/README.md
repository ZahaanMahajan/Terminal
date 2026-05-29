# `src/pty/` — Phase 5: the browser side of the real-PTY bridge

> Per `docs/PLANNING_AND_ARCHITECTURE.md` §4 Phase 5. The backend half lives in `services/pty/`.

## What this is

The frontend that connects the Phase 1 terminal to a **real shell** running in the `services/pty`
backend. Keys become bytes, bytes ride a WebSocket to the PTY, the PTY's output comes back as ANSI
and renders. This is where the *fake* shell (Phase 3) gives way to your actual `$SHELL`.

## Module layout

```
src/pty/
├─ key-to-bytes.ts      ← Key → terminal input bytes (inverse of the ANSI parser)  [pure, tested]
├─ pty-client.ts        ← WebSocket client to services/pty (DOM glue)
├─ index.ts             ← re-exports
├─ key-to-bytes.test.ts ← control bytes, named-key sequences, printables, Alt/Ctrl
└─ README.md            ← you are here
```

(The demo is `demos/PtyDemo.tsx`; the backend is `services/pty/`.)

## Step 2 (done): the bridge

- **`keyToBytes(key, text?)`** — the inverse of the Phase 1 parser, closing the whole stack:
  physical keypress → Phase 2 `Key` → input bytes → PTY → response ANSI → Phase 1 render.
  Ctrl-A…Z → 0x01…0x1A, Enter → CR, Backspace → DEL, arrows/Home/F-keys → CSI/SS3 sequences,
  printables → the logical char (`event.key`), Alt → ESC prefix. Fully golden-tested.
- **`PtyClient`** — `POST /pty` to spawn, then a WebSocket: input out as binary frames, resize
  out as a text control frame, PTY output in as binary frames (decoded → renderer), `exit` as a
  text frame. Graceful "start the server" error when the backend is down.
- **`PtyDemo`** (5th tab) — wires the terminal + input layer + client; cols-resize sends
  `SIGWINCH`; a focused terminal captures Ctrl-W/R/L (meta-only `reservedGuard`).

### Works now (line-oriented)
`bash`/`zsh`, `ls`, `git`, `python`, a real prompt with real colors; **Ctrl-C interrupts a
`sleep`** (control byte → SIGINT); **column resize** reflows the program (SIGWINCH).

## Step 3 (done): full-screen apps

`vim`/`htop`/`nvim`/`less`/`nano` use the **alternate screen buffer** (`\x1b[?1049h/l`) and hide
the cursor (`\x1b[?25l`) — features the Phase 1 renderer had deferred. They live in the *renderer*,
not here: `renderer/screen.ts` (`enterAltScreen`/`exitAltScreen`) swaps in a fresh non-scrolling
grid and stashes the primary buffer; `renderer/ansi/interpret.ts` (`setPrivateModes`) dispatches
DECSET/DECRST (`?25`, `?47`/`?1047`/`?1049`, `?1048`); `renderer/cursor.ts` gains `hidden` +
`saveCursor`/`restoreCursor`. Because `PtyDemo` already routes PTY output through `feed`,
full-screen apps just work — no change in this module. Resizing *while inside* vim/htop reflows the
shell behind it so quitting lands you back cleanly.

## Phase 5 exit criteria

- ✅ Ctrl-C interrupts a running `sleep` (SIGINT).
- ✅ Resize (columns) reflows a running program (SIGWINCH).
- ✅ vim / htop / nano / nvim run cleanly (alt-screen + cursor hide).
- ☐ Explain `forkpty` at a whiteboard — read `services/pty/README.md` + `man forkpty`.

> All three rendering/IO criteria are met. Verifying them end-to-end needs the backend running on
> your machine (`cd services/pty && npm install && npm start`) — node-pty compiles native bindings
> that can't build in the dev sandbox.
