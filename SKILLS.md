# Termi — Project Skills & Decision Log

> Living index for the **Termi** project. This file is the table of contents + decision journal.
> It is updated at the end of every working session. Detailed content lives in `docs/`.

**Project (one-liner):** A solo, learning-first systems project: build a terminal ecosystem
(renderer, parser, shell, compiler, PTY, persistence) from primitives, mastering every layer.

**Posture:** **NOT** a startup. **NOT** a SaaS. A self-taught senior-engineer curriculum disguised
as a terminal ecosystem. *Build engines before products. Understand every layer.*

**Phase:** `02 — Keyboard & Input Systems` (in progress; step 1 of ~4 done). Phase 1 ✅ complete.
**Repo state:** Phase 1 VT renderer complete; Phase 2 input layer landed (Key model + notation parser + scoped DOM capture). App is now a tab switcher (Terminal P1 / Keyboard P2). 150 Vitest tests (50ms)
**Last updated:** 2026-05-28

---

## Document index

| Doc | Purpose | Status |
|-----|---------|--------|
| [docs/PLANNING_AND_ARCHITECTURE.md](docs/PLANNING_AND_ARCHITECTURE.md) | Master roadmap — philosophy, phases, evolution | ✅ v1.0 (rewrite) |
| docs/ADRs/ | Architecture Decision Records (one file per decision) | ⏳ pending |
| docs/notes/ | Per-topic learning notes (your textbook) | ⏳ pending |

---

## Learning-phase map (the curriculum)

Status: ⬜ not started · 🟦 spec'd · 🟨 in progress · ✅ done · 🚫 explicitly deferred

| Phase | Build | Core concepts | Status |
|-------|-------|---------------|--------|
| 1 | Terminal Rendering Engine (Canvas, ANSI parser, scrollback, wrap) | render loops, FSMs, glyph caches, dirty regions, VT100, ring buffers, unit testing, wrap+reflow, ANSI/CSI/SGR, style attrs, LRU | ✅ done (steps 1–8) |
| 2 | Keyboard & Input Systems (modal FSM, tries, conflict detection) | events, FSMs, tries, layout-independent keys, a11y | 🟨 in progress (step 1/~4) |
| 3 | Fake Shell (line editor, parser, fake FS, history, completion) | tokenizers, recursive descent, REPL, replaceability | 🟦 |
| 4 | **Config Compiler** (AST → IR → emit, validation, golden tests) | compilers, IRs, schemas, migrations, diagnostics | 🟦 (the heart) |
| 5 | Real PTY Integration (node-pty/creack-pty, WS bridge) | TTYs, fork/exec, signals, line discipline, streams | 🟦 |
| 6 | Persistence + Tiny Backend (SQLite, own OAuth, REST) | SQL, sessions, OAuth PKCE, migrations | 🟦 |

---

## Stack (intentionally small)

| Layer | Choice | Why |
|-------|--------|-----|
| Frontend | **React + TypeScript + Vite + Tailwind** | Minimum scaffolding around your own code |
| Renderer | **Canvas 2D API**, hand-written | Learn the renderer by being the renderer |
| State | React state + small contexts | Defer Zustand/Redux until pain is real |
| Backend (Phase 5+) | **Node or Go, one binary** | Monolith-first; write the harder of the two for you |
| DB (Phase 6) | **SQLite + plain SQL** (no ORM) | Learn SQL, indexes, transactions, EXPLAIN |
| Auth (Phase 6) | **Own OAuth code+PKCE** from RFC | Lose fear of identity providers once and for all |
| API | **REST only** | No GraphQL/gRPC/WS until justified |

---

## Explicitly deferred (with triggers)

These are NOT in scope until specific pain shows up. See §5 of the architecture doc.

| Deferred | Trigger that would justify revisiting |
|----------|---------------------------------------|
| Next.js | Public, SEO-critical pages (Phase 6+) |
| xterm.js | After Phase 1 is solid; possibly as a swap, not before |
| node-pty | Phase 5 — after the fake shell is done |
| WebSockets | Phase 5 (PTY bridge); collab much later |
| Microservices | Two independent lifecycles + ops to support it |
| Kubernetes | 🚫 essentially never for this project |
| CRDTs / realtime collab | A real second user editing the same setup |
| Queues / event bus | First long-running job that times out HTTP |
| Plugin marketplace | A third party *asks* to publish a plugin |
| WASM plugin sandbox | The moment you accept untrusted code |
| AI features | After the AST is stable (AI emits AST patches) |
| Vector search | After Postgres FTS has been outgrown |
| Enterprise auth / SSO / SCIM | First enterprise customer with a check |
| Docker (dev) | When packaging for deploy |
| GraphQL | 3+ heterogeneous clients |
| ORMs | When you decide SQL boilerplate exceeds the learning |

---

## Operating principles (the rules)

- **Build engines before products.**
- **Read before you write.** Two real implementations + a notes file before any non-trivial module.
- **No library you cannot describe in a paragraph.**
- **Rule of three for abstractions.** First time: note. Second time: note. Third time: extract.
- **Golden tests for renderers, parsers, compilers.** Diffs are the teacher.
- **Defer until the cost of *not* having it has been felt, named, and dated three times.**

---

## Glossary

- **Phase** — a self-contained study unit with exit criteria (see roadmap §4).
- **Config AST** — typed source-of-truth tree for setups (Phase 4).
- **IR** — target-specific, ordered statement tree the compiler emits from the AST.
- **Target** — a concrete dotfile output (zsh, tmux.conf, init.lua, …).
- **Setup** — a user's full configuration (AST + meta).
- **Module** — a small pure function `(setup) → setup` that composes config.
- **Golden test** — `input fixture → expected output file`; the diff is the failure message.

---

## Changelog

- **2026-05-28** — **Phase 2, step 1: input layer + Key tokens.** New `src/input/`: `key.ts`
  (the keyboard abstraction layer — `Key = {key, mods}` from `event.code` not `event.key` for
  layout independence; `normalizeCode`, `keyFromEvent`, `keyToken`/`keyToString` canonical
  serialization with C-A-S-M order + shift-folds-to-uppercase-letter, vim-like `parseKeys`
  notation with `<…>` specials, round-trips). `input-layer.ts` (scoped DOM capture — listens on
  a focused element not window, drops standalone modifiers, `isBrowserReserved` guard so
  Cmd+…/Ctrl+W/T/N/Q/R/L are logged but never trapped). App refactored into a **tab switcher**;
  Phase 1 demo extracted to `src/demos/TerminalDemo.tsx`, new `src/demos/KeyboardDemo.tsx`
  shows live key capture + physical/modifier breakdown. **+26 tests** (`key.test.ts`) for **150
  total, 50ms**. Build: 221 KB JS / 69 KB gzip. Next: keymap + trie + mode-aware FSM (step 2).
- **2026-05-28** — **Phase 1, step 8: glyph cache — PHASE 1 COMPLETE.** New pure `lru.ts`
  (generic O(1) LRU over a single Map: insertion-order = recency) and `glyph-cache.ts`
  (`GlyphCache` + `glyphKey`, DOM-free via an injected renderer). `index.ts` extracted
  `paintCellAt` (shared by direct + cache paths), added `drawCellCached` (blit a pre-rendered
  bitmap; trivial blank cells fast-path to a single `fillRect`), and `createDomGlyphCache`
  (wires the DOM renderer where `paintCellAt` lives — keeps the cache module testable).
  `drawScreen`/`drawScreenDirty` thread an optional `cache`. Loop gained `getCache` +
  `forceFullRepaint` options and an `avgPaintMs` EMA stat. App got runtime toggles (glyph
  cache on/off, stress full-repaint-per-frame) so the speedup is measurable in the HUD —
  *measure before optimizing*. Fixed parameter-property syntax (constructor `private readonly`)
  → explicit fields for `erasableSyntaxOnly`. **+15 tests** (7 lru + 8 glyph-cache) for **124
  total, 34ms**. Build: 215 KB JS / 68 KB gzip. **Phase 1 exit criteria all met.**
- **2026-05-27** — **Phase 1, step 7: cell style attrs (bold / italic / underline / inverse).**
  Added `ATTR_*` bit-flag constants and an *optional* `attrs?: number` on `Cell` (keeps
  emptyCell narrow and existing test literals stable). `Pen` got a required `attrs: number`.
  SGR now handles codes 1/3/4/7 (set) and 22/23/24/27 (clear) plus 0 (reset all). `printChar`
  stamps `pen.attrs` into a new cell *only when non-zero*. `CellMetrics` carries
  `fontFamily/fontSizePx` so `drawCell` can rebuild `ctx.font` for bold/italic on the fly.
  Underline draws a thin baseline stroke; inverse swaps fg/bg before paint. `reflow`'s
  `isFullyDefault` now treats any non-zero attrs as "not default" so styled trailing cells
  survive reflow. `drawCursor` resolves the cell's *displayed* fg/bg under ATTR_INVERSE so
  the block cursor paints correctly on inverted text. **+7 tests** in `interpret.test.ts`
  for **109 total, 27ms**. Build: 212 KB JS / 67 KB gzip (+1 KB).
- **2026-05-27** — **Phase 1, step 6: ANSI parser + interpreter (+ 256/truecolor SGR).** New
  subdirectory `renderer/ansi/` with three modules. `parser.ts` is Williams's VT100/ECMA-48
  state machine (8 states, anywhere transitions for ESC/CAN/SUB) emitting typed `Action[]`;
  state persists across `parse()` calls (chunked input safe). `sgr.ts` handles SGR with the
  16-color VGA-ish palette, the 256-color cube + grayscale ramp, and truecolor; unknown
  codes (bold/italic/underline) are skipped silently. `interpret.ts` walks Actions and
  mutates Screen+Cursor: print stamps `cursor.pen` and auto-wraps; LF preserves column
  (VT-correct); CSI A/B/C/D/G/d/H/f for motion, J/K for erase (using `cursor.pen.bg` as the
  erase background per spec), m for SGR. `Cursor` gained a `pen: { fg, bg }` field — the
  "write head" — non-breakingly via a default in `makeCursor`. App's demo session is now a
  real ANSI byte stream (16-color + 256-color ramp + truecolor) fed through the parser. Also
  fixed: replaced `enum State` with a const-object pattern to satisfy
  `erasableSyntaxOnly: true`. **+37 tests** (16 parser + 20 interpret + drive-by adjustments)
  for **102 total, 25ms**. Build: 211 KB JS / 67 KB gzip.
- **2026-05-27** — **Phase 1, step 5: line wrap + reflow.** Wrap state lives on `Scrollback`
  as a `Set<number>` of wrapped ids (keeps `Line = Cell[]` stable). New `Scrollback`
  methods: `isWrapped` / `setWrapped`; eviction clears the evicted id's flag. `Screen.write`
  now wraps within the viewport (sets wrap on source line, advances to next row, clips at
  viewport bottom). `Screen.println` appends `ceil(len/cols)` lines, sets wrap on all but the
  last. New `reflow.ts` with `reflowScrollback(src, newCols, cursor?)` — three passes
  (extract logical lines → trim trailing default cells → rebuild at newCols), mutates the
  cursor's `(lineId, col)` in place. New `Screen.setCols(newCols, cursor?)` swaps internal
  Scrollback for the reflow output. `Screen.scrollback` became a getter (private backing
  field) so reflow can replace it. App got a cols selector (40 · 60 · 80 · 100 · 120) that
  calls setCols + refits canvas. **23 new tests** (10 reflow + 13 wrap/setCols across screen
  and scrollback) for **65 total, 26ms**. Build: 204 KB JS / 64 KB gzip.
- **2026-05-26** — **Phase 1, step 4: Vitest + first test wall.** Added `vitest@4.1.7` (one dev
  dep), configured via a `test` block in `vite.config.ts` with `/// <reference types="vitest/config" />`,
  scripts `test`/`test:watch`. Wrote 42 unit tests across three co-located files
  (`scrollback.test.ts`, `screen.test.ts`, `cursor.test.ts`) pinning down: ring-math
  invariants (eviction, monotonic ids, no-leakage on slot reuse, capacity-1 degenerate), the
  Screen's viewport contract (write clipping, dirty marking, scroll clamping, atBottom /
  linesAbove / linesBelow), and the Cursor's absolute-id model (viewport-row translation,
  clamping, dirty bookkeeping on moves in/out of view). All pass in ~17ms. Build remains
  201 KB JS / 64 KB gzip — tests aren't in the prod bundle.
- **2026-05-26** — **Phase 1, step 3: scrollback ring buffer + viewport Screen + line-anchored
  cursor.** Extracted `Cell` to `cell.ts` (breaks the Screen↔Scrollback import cycle). New
  `scrollback.ts` — fixed-capacity ring buffer of `Line`s with monotonic, never-reused absolute
  line ids; `appendLine` evicts oldest at capacity, `getLine` returns null for evicted ids.
  `Screen` refactored to a *view*: holds `viewportTop` (absolute id), reads/writes via the
  scrollback, scroll is pure math. New methods: `scrollTo`, `scrollBy`, `scrollToBottom`,
  `appendLine`, `println`. Cursor moved from `{col,row}` (viewport) to `{col,lineId}` (absolute);
  added `cursorViewportRow` helper used by blink, move, draw. App pre-fills 200 lines of demo
  history, mouse-wheel scrolls, HUD shows `scroll: bottom | −N (above/total/below)` and cursor
  scrolls out of view when its line leaves the viewport. Build: 201 KB JS / 64 KB gzip.
- **2026-05-26** — **Phase 1, step 2: render loop + dirty rows + cursor.** Added `Cursor` type
  (composited, not a Screen cell) with `block`/`beam`/`underline` shapes and `moveCursor` that
  marks old+new rows dirty. New `loop.ts` with `startRenderLoop` (rAF, 530ms blink, frame
  stats). New `drawScreenDirty` paints only `screen.dirty` rows + cursor overlay. App grew a
  throttled HUD (fps · paint ms · rows · paints) and a click-to-move-cursor handler. Build:
  197 KB JS / 62 KB gzip (+~1 KB for the loop + cursor + HUD).
- **2026-05-26** — **Phase 1, step 1: the Screen.** Added `Cell` type and `Screen` class (row-major
  flat buffer + dirty-row Set). Renderer gains `drawScreen` (main API) and a `drawCell`
  primitive. `drawCell` skips `fillText` on spaces; `drawScreen` measures the cell once per
  paint, not per cell. App renders a 60×12 demo Screen. Build: 193 KB JS / 61 KB gzip.
- **2026-05-26** — **Phase 1, step 0: scaffold + one cell.** Vite + React + TS + Tailwind v4 in
  `apps/web`. `renderer/` module with `measureCell`/`fitCanvas`/`drawSingleCell`. Phase folder
  placeholders. README at root pointing at SKILLS.md.
- **2026-05-26** — **Full pivot.** Rewrote the architecture doc as a solo, learning-first
  curriculum (v1.0). Threw out SaaS/Kubernetes/microservices/CRDTs/plugin-marketplace/vector-search
  and replaced them with a 6-phase build plan. Stack collapsed to React+Vite+TS / Canvas /
  one-binary-Node-or-Go / SQLite / own-OAuth. Established operating principles above.
- **2026-05-25** — Wrote v0.1 (SaaS-style architecture proposal). Superseded by v1.0.
