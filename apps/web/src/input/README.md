# `src/input/` — Phase 2: Keyboard & Input Systems

> Per `docs/PLANNING_AND_ARCHITECTURE.md` §4 Phase 2. The "rubber-duck" doc for the module.

## What this module is

Turns raw keyboard events into a deterministic, layout-independent model of *what the user
pressed* — and (in later steps) resolves sequences of presses into named actions, with conflict
detection and an on-screen visualizer. Framework-free except the thin DOM capture layer.

## Module layout

```
src/input/
├─ key.ts           ← Key model, normalizeCode, keyFromEvent, keyToString/keyToken, parseKeys
├─ input-layer.ts   ← scoped DOM capture (events in → Keys out), browser-reserved guard
├─ keymap.ts        ← TrieNode, Keymap (bind/root/bindings), tokensToNotation
├─ resolver.ts      ← KeyResolver — the mode-aware FSM (feed / flushTimeout / setMode)
├─ conflicts.ts     ← findConflicts / findAllConflicts / describeConflict (prefix detection)
├─ text-buffer.ts   ← TextBuffer — the vim-motion sandbox (hjkl/w/b/e/gg/G/dd/dw/ciw) + applyMotion
├─ index.ts         ← re-exports
├─ key.test.ts      ← Vitest — normalization, serialize, parse, round-trips
├─ keymap.test.ts   ← Vitest — trie build, prefix sharing, bindings introspection
├─ resolver.test.ts ← Vitest — fire/prefix/ambiguous+timeout/unbound/dead-end/modes
├─ conflicts.test.ts← Vitest — strict-prefix, single/nested/multi-mode conflicts, messages
├─ text-buffer.test.ts ← Vitest — hjkl/word motions/edits, clamping, applyMotion dispatch
└─ README.md        ← you are here
```

(The on-screen keyboard overlay lives in `src/demos/OnScreenKeyboard.tsx` — it's presentational
and reuses the `Key` token vocabulary from `key.ts`.)

## Current state — step 1 (done): the keyboard abstraction layer

Three layers, separated on purpose:

1. **Physical** — `KeyboardEvent.code` (the key's *position*, layout-independent).
2. **Logical** — our `Key = { key, mods }` token (friendly physical-key name + modifier flags).
3. **Action** — *(step 2)* what a *sequence* of Keys is bound to (a named action, not a callback).

### Why `code`, not `key`

`event.key` is layout-dependent: on a Dvorak board the H position reports `"d"`. Binding on
`code` means `hjkl` are the home-row positions on *any* layout — which is what muscle memory
actually wants. Trade-off: punctuation glyphs on non-US keycaps won't match their labels.

### Notation (vim-like, for authoring keymaps)

| Form | Example | Meaning |
|------|---------|---------|
| bare letter/digit | `j`, `5` | that physical key (uppercase ⇒ shift: `G` = S-g) |
| bare punctuation | `;` `.` `/` | the *unshifted* physical key at that position |
| `<…>` special | `<C-w>` `<Esc>` `<leader>` `<S-Tab>` `<F1>` | modified / named keys |
| sequence | `ciw` `dd` `<C-b> c` | concatenated keys; spaces are separators |

Canonical serialization (`keyToString`) is the inverse: bare for simple keys, `<…>`-wrapped
otherwise; modifier order is fixed **C-A-S-M**; shift folds into letter case (`G`) but stays a
`S-` prefix for non-letters (`<S-1>`). `parseKeys(keysToString(keys))` round-trips.

**Known gap (intentional):** shifted punctuation like `:` (= Shift+`;`) has no bare token —
write `<S-;>`. All of this phase's exit-criteria motions are letters, so it doesn't block us.

### The input layer

`InputLayer` listens on a *specific element* (only fires when focused — no global hijack),
drops standalone modifier presses, converts each event to a `Key`, and calls `onKey`. It
`preventDefault`s a handled key **except** browser-reserved combos (`isBrowserReserved`:
Cmd+anything, Ctrl+W/T/N/Q/R/L) — we never trap the user's tab-close / reload.

## Step 2 (done): keymap + trie + mode-aware FSM

**`Keymap`** stores bindings per mode as a **trie** keyed by `keyToken(key)`. Each node may
carry an action and/or children. A node with *both* is a prefix binding (the ambiguity case).
`bind(mode, "dw", "delete.word")` is chainable; `bindings(mode)` walks the trie for
introspection (and feeds the conflict detector in step 3).

**`KeyResolver`** is the FSM. `feed(key)` walks one trie step and returns a `FeedResult`:

| Outcome | When | Result |
|---------|------|--------|
| **fire** | node has an action and no children | `actions:[id]`, buffer reset |
| **await (prefix)** | node is a pure prefix | `pending:[…]` |
| **await (ambiguous)** | node has an action *and* children | `pending:[…]`, `awaitingTimeout:true`, `stagedAction:id` |
| **unbound** | first key matches nothing | `unbound:[key]` |
| **discard** | mid-sequence dead-end | drop buffer; fire any staged action, then re-process the key |

Timeouts are **injected, not owned**: `feed` is synchronous and pure; the host arms a timer
whenever `pending` is non-empty and calls `flushTimeout()` (→ fires the staged action, resets)
when it elapses. This keeps the resolver deterministic and unit-testable with no fake clocks.

## Step 3 (done): conflict detection

`findConflicts(keymap, mode)` is a pure pass over `bindings(mode)`: for each binding it finds
every *longer* binding it's a strict token-prefix of. Each such pair is a **prefix conflict** —
the shorter binding pays a `timeoutMs` latency tax because the resolver must wait to see if the
longer sequence follows. `describeConflict(c, timeoutMs)` renders the latency cost in plain
language; `findAllConflicts(keymap)` sweeps every mode.

The right answer is usually to *leave the prefix unbound* (vim leaves `g` unbound so `gg`/`gd`/…
have no latency tax). The demo deliberately keeps one conflict (`<space>` vs `<space><space>`)
so the detector has something to flag — and so the timeout behavior is demonstrable.

> Not detected: duplicate-sequence rebinds (the trie overwrites on `bind`, so they can't coexist
> to be found). Catching those would require hooking `bind()` — out of scope.

## Step 4 (done): motion sandbox + on-screen keyboard

`TextBuffer` is a tiny mutable document (lines + a normal-mode cursor) with vim motions
(`hjkl`, `w`/`b`/`e` two-class word motion, `gg`/`G`) and edits (`dd`/`dw`/`ciw`). `applyMotion`
dispatches a named action onto it (returns whether it was a buffer op). The demo wires the
resolver's fired actions straight into the buffer, so motions actually move the cursor and edit
text. The `OnScreenKeyboard` overlay highlights held key tokens + live modifier flags (driven
by raw listeners in the demo; modifiers light even when pressed alone).

## Phase 2 complete — exit criteria

- ✅ Run `hjkl`/`w`/`b`/`e`/`gg`/`G`/`dw`/`ciw` correctly in a sandbox text buffer.
- ✅ The conflict detector flags a binding that is a prefix of another in the same mode.
- ✅ The on-screen keyboard lights up correctly for every chord.

## Deferred (intentional)

- **Insert/visual modes for real** — `ciw` deletes the inner word but doesn't enter insert (no
  text-entry surface yet); `setMode` exists and the resolver is mode-aware, but only `normal` is
  populated.
- **Shifted-punctuation notation** (`:` = Shift+`;`) — write `<S-;>`; all phase motions are letters.
- **Tutorial/practice/heatmap/analytics** modes from the planning doc — product features for later.

## Things NOT to do (per the planning doc)

- Bind to `event.key` (layout-dependent) — we use `event.code`.
- Wire keymaps to inline callbacks — actions are *named* (debuggable, remappable, analyzable).
- Capture on `window` — capture on a focused element only.
- Skip the conflict detector — it's the whole pedagogical point of the phase.
