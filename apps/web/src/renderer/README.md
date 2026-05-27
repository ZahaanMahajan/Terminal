# `src/renderer/` — Phase 1: Terminal Rendering Engine

> Per `docs/PLANNING_AND_ARCHITECTURE.md` §4 Phase 1. This README is the "explain it to the
> rubber duck" doc for the module. Update it as the module grows.

## What this module is

The renderer turns terminal **state** (a `Scrollback` of lines + a viewport `Screen` + a
`Cursor`) into **pixels** on a `<canvas>`. It is framework-free — no React in here.

## Module layout

```
src/renderer/
├─ cell.ts             ← Cell, emptyCell, DEFAULT_FG/BG (shared by Scrollback + Screen)
├─ scrollback.ts       ← ring buffer of Lines + per-id wrap flags
├─ screen.ts           ← view over Scrollback + write/println/setCols (reflow integration)
├─ cursor.ts           ← Cursor (absolute lineId + pen) + drawCursor + moveCursor
├─ reflow.ts           ← extract logical lines → trim → rebuild at newCols + cursor remap
├─ loop.ts             ← LoopStats + startRenderLoop (rAF + blink + stats)
├─ ansi/
│  ├─ parser.ts        ← Williams's state machine: bytes → typed Action[]
│  ├─ sgr.ts           ← Select Graphic Rendition: SGR params → mutate pen (16/256/truecolor)
│  ├─ interpret.ts     ← apply Actions to (Screen, Cursor); exports `feed`
│  ├─ index.ts         ← public surface
│  ├─ parser.test.ts   ← state machine, params, OSC, abort/recovery, stream safety
│  └─ interpret.test.ts ← print/wrap/C0/CSI motion/CSI erase/SGR colors
├─ index.ts            ← measureCell, fitCanvas, drawCell, drawScreen, drawScreenDirty, re-exports
├─ scrollback.test.ts  ← Vitest — ring math, eviction, stable ids, wrap flags
├─ screen.test.ts      ← Vitest — viewport, scroll, wrap-on-write, setCols
├─ cursor.test.ts      ← Vitest — viewport translation, clamping, dirty bookkeeping
├─ reflow.test.ts      ← Vitest — shrink/grow, trim, cursor remap, dangling-wrap safety
└─ README.md           ← you are here
```

Tests live alongside their source files (co-located). Run them with `npm test` (one-shot) or
`npm run test:watch` (watch mode). 102 tests, ~25ms cold.

## Current state — steps 1–7 done

### `Cell` (step 1)

```ts
type Cell = { char: string; fg: string; bg: string };
```

### `Scrollback` (step 3) — the history, as a ring buffer

```ts
class Scrollback {
  readonly cols: number;
  readonly capacity: number;
  get count(): number;          // valid lines currently retained
  get oldestId(): number;       // smallest still-valid line id
  get nextLineId(): number;     // id the next appendLine() will assign

  appendLine(fg?, bg?): number; // returns the new line's absolute id
  getLine(id: number): Line | null;
  setCell(id: number, col: number, cell: Cell): void;
  getCell(id: number, col: number): Cell;
}
```

State is `(head, _count, _nextId)`:

- `head` — index in the underlying array of the oldest retained line.
- `_count` — number of valid lines (≤ capacity).
- `_nextId` — monotonic id of the next line to be appended.

Line ids are **absolute and never reassigned**. Evicted ids stay evicted. This stable-id
property is what lets the cursor anchor to a specific line that the viewport can scroll over.

### `Screen` (step 3) — a view, not a buffer

```ts
class Screen {
  readonly scrollback: Scrollback;
  readonly rows: number;
  readonly dirty: Set<number>;

  get cols(): number;
  get viewportTop(): number;    // absolute line id at viewport row 0
  get viewportBottom(): number; // exclusive: viewportTop + rows
  get atBottom(): boolean;
  get linesAbove(): number;     // hidden above viewport
  get linesBelow(): number;     // hidden below viewport

  // viewport coords:
  get(col, row), set(col, row, cell), write(col, row, text, fg?, bg?), clear()

  // scrolling — pure math, never memmove:
  scrollTo(absoluteTop), scrollBy(delta), scrollToBottom()

  // writing to history:
  appendLine(fg?, bg?), println(text, fg?, bg?)
}
```

The translation everyone runs:

```
absolute line id  ↔  viewport row
id = viewportTop + row
row = id - viewportTop   (if 0 ≤ row < rows; otherwise off-screen)
```

`scrollTo` clamps so `[viewportTop, viewportTop + rows)` stays within
`[oldestId, nextLineId)`. Scrolling marks every row dirty (everything moved).

### `Cursor` (step 3) — anchored to a line, not a row

```ts
type Cursor = { col: number; lineId: number; shape; visible };

cursorViewportRow(cursor, screen): number | null;  // null = scrolled out
moveCursor(cursor, screen, col, lineId);           // absolute lineId, clamped
drawCursor(ctx, cursor, screen, m);                // no-op if scrolled out
```

The cursor sits on a specific scrollback line. Scroll the viewport past that line and the
cursor visibly disappears; scroll back and it reappears in the right place. This is how every
real terminal models its cursor and is why scrollback is worth its own data structure.

### Render loop (step 2, updated)

`startRenderLoop(canvas, screen, style, cursor, opts)` returns `stop()`. Wakes ~60 Hz via
`requestAnimationFrame`. Each tick:

1. Time the frame.
2. If `530ms` since last blink → toggle `cursor.visible`, mark its **current viewport row**
   dirty via `cursorViewportRow`. If the cursor is scrolled out, blink is a no-op.
3. If `screen.dirty.size > 0` → `drawScreenDirty`. Else: skip the entire paint path.
4. `onFrame(stats)` for HUD subscription.

### Wrap (step 5) — line continuation as metadata

A *logical line* is a contiguous run of physical lines linked by the **wrap flag**:

- `Scrollback.isWrapped(id)` / `setWrapped(id, wrap)` — per-id `Set<number>` of wrapped ids.
- `Screen.write(col, row, text)` — when col reaches `cols`, sets the wrap flag on the source
  line and advances to (col 0, row + 1). Clips at viewport bottom (no auto-scroll).
- `Screen.println(text, …)` — computes `ceil(len / cols)` physical lines, appends them, sets
  the wrap flag on all but the last, then snaps to bottom.

Eviction clears the evicted id's wrap flag so reused slots don't inherit stale state.

### Reflow (step 5) — three passes

`reflowScrollback(src, newCols, cursor?)` builds a fresh Scrollback at `newCols`:

1. **Extract.** Walk ids oldest→newest, grouping consecutive wrap-linked physical lines into
   logical lines (one flat `Cell[]` per logical line). If the source's cursor sits in a logical
   line, record its position as a single offset into the concatenated cells.
2. **Trim.** Drop trailing fully-default cells per logical line (the padding from short writes
   in a wider buffer). Cursor logical col is clamped to the trimmed length.
3. **Rebuild.** Chunk each logical line into pieces of up to `newCols`; set the wrap flag on
   every chunk except the last; while placing chunks, watch for the recorded cursor offset and
   set the new `(lineId, col)`.

`Screen.setCols(newCols, cursor?)` calls reflow, replaces its internal Scrollback reference,
tops up the buffer so the viewport stays valid, and snaps to the bottom.

### ANSI (step 6) — parser + interpreter + SGR

A two-stage pipeline:

**Parser** (`ansi/parser.ts`) — Paul Williams's VT100/ECMA-48 state machine. Eight states
(GROUND, ESCAPE, ESCAPE_INTERMEDIATE, CSI_ENTRY, CSI_PARAM, CSI_INTERMEDIATE, CSI_IGNORE,
OSC_STRING) plus the "anywhere" transitions for ESC/CAN/SUB. Emits `Action[]`:

```ts
type Action =
  | { type: 'print'; char: string }
  | { type: 'execute'; code: number }              // C0 control byte
  | { type: 'csi'; final; params; intermediate; prefix }
  | { type: 'esc'; final; intermediate };
```

State and accumulators persist across `parse()` calls, so chunked input is byte-stream safe
(critical for the eventual PTY: escape sequences arrive in pieces).

**Interpreter** (`ansi/interpret.ts`) — `applyAction(action, screen, cursor)` mutates the
Screen + Cursor. Handles:

- `print`: stamps `cursor.pen` into the cell at cursor, advances col, auto-wraps at `cols`
  (sets the line's wrap flag, advances lineId, scrolls viewport if needed).
- C0 (`execute`): BS / HT / LF / CR. LF preserves column (VT-correct); use CR-LF for the
  "newline" idiom.
- CSI cursor motion: CUU / CUD / CUF / CUB (relative); CHA, VPA, CUP, HVP (absolute,
  1-indexed in the spec, 0-indexed internally).
- CSI erase: ED 0/1/2 (display) and EL 0/1/2 (line); erase fills with a space cell carrying
  the *current* `cursor.pen.bg` (VT spec: "erase with current background").
- CSI SGR (`m`): see below.
- ESC dispatches and OSC: parser handles them; interpreter currently ignores.

**SGR** (`ansi/sgr.ts`) — mutates `cursor.pen.fg/bg`:

- `0` (or empty params): reset.
- `30..37` / `40..47`: 16-color fg/bg (normal).
- `90..97` / `100..107`: 16-color fg/bg (bright).
- `38;5;N` / `48;5;N`: 256-color (16-color set, 6×6×6 cube, 24-step grayscale).
- `38;2;R;G;B` / `48;2;R;G;B`: truecolor.
- `39` / `49`: reset fg / bg.
- Style attrs (`1` bold, `3` italic, `4` underline, `7` inverse, …): parsed but ignored
  until `Cell` carries a `attrs` field.

**Cursor.pen** — new in step 6. The "write head" carries `{ fg, bg }`. Print stamps it into
cells; SGR mutates it; cursor motion does not touch it.

### Cell style attrs (step 7) — bold / italic / underline / inverse

`Cell.attrs?: number` carries bit-flags (`ATTR_BOLD`, `ATTR_ITALIC`, `ATTR_UNDERLINE`,
`ATTR_INVERSE`). Optional on purpose — most cells (untouched empty cells, normal text writes)
omit the field entirely, which keeps the buffer narrow and existing tests' `{char, fg, bg}`
literals stable.

`Pen.attrs: number` (required on the cursor) mirrors the same flags. SGR sets/clears them;
`printChar` stamps `pen.attrs` into the new cell **only when non-zero**.

| SGR codes | Effect |
|---|---|
| `1` / `22` | bold on / off |
| `3` / `23` | italic on / off |
| `4` / `24` | underline on / off |
| `7` / `27` | inverse (fg↔bg swap) on / off |
| `0` | reset attrs alongside colors |

`drawCell` renders attrs:
- **Bold/italic**: rebuilds `ctx.font` per cell as `<style> <weight> <size> <family>` (CSS
  shorthand order). Per-glyph cost; step 8's glyph cache will fold this away.
- **Underline**: extra `fillRect` of ~8% cell height at the bottom edge. Drawn even on
  spaces (so an "underlined space" renders correctly).
- **Inverse**: swaps `fg` and `bg` before the background fill and glyph stroke.

`reflow.isFullyDefault` was tightened: a cell with `attrs` set is *not* default and is not
trimmed, so a styled trailing background (e.g., a status bar) survives reflow.

### Optimizations already in (because they're cheap and obvious)

- `drawCell` **skips `fillText` for `' '`** — `fillRect` already painted the background.
- `drawScreen` / `drawScreenDirty` **measure the cell once per paint**, not per cell.
- The loop **skips the entire paint path** when `dirty.size === 0`. No `measureCell` call.
- Scrolling is **window-offset math** in the Screen; no buffer movement in Scrollback.

## Coming next (Phase 1, in order)

1. **Glyph cache.** Pre-render each `(char, fg, bg, attrs)` to an offscreen canvas; blit at
   runtime. Measure speedup before and after — `drawCell` now sets `ctx.font` per glyph for
   bold/italic, so a cache pays back even more than it would have at step 5.
2. **Alt-screen.** Two scrollbacks + a swap flag, for vim/htop-style fullscreen apps.

## Things NOT to use yet (intentional)

- `xterm.js` — you're building this to learn it; using it short-circuits Phase 1's purpose.
- Any "ansi" npm package — Williams's state diagram is the lesson.
- React for actual drawing — React owns the `<canvas>` element and the HUD, never per-frame paint.
- Any font-loading library — built-in CSS font stacks are exactly the experience you want.

## Exit criteria for the whole of Phase 1

(From the planning doc — you're not done with Phase 1 until **all four** are true.)

- Paste a chunk of `htop` output and it renders correctly, colors and all.
- Scrolling 10,000 lines stays smooth (≥ 60fps redraw, dirty rows only).
- Resizing reflows wrapped lines correctly.
- You can explain Williams's parser at a whiteboard without notes.
