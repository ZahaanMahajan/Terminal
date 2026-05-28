# `src/input/` — Phase 2: Keyboard & Input Systems

> Per `docs/PLANNING_AND_ARCHITECTURE.md` §4 Phase 2. The "rubber-duck" doc for the module.

## What this module is

Turns raw keyboard events into a deterministic, layout-independent model of *what the user
pressed* — and (in later steps) resolves sequences of presses into named actions, with conflict
detection and an on-screen visualizer. Framework-free except the thin DOM capture layer.

## Module layout

```
src/input/
├─ key.ts          ← Key model, normalizeCode, keyFromEvent, keyToString/keyToken, parseKeys
├─ input-layer.ts  ← scoped DOM capture (events in → Keys out), browser-reserved guard
├─ index.ts        ← re-exports
├─ key.test.ts     ← Vitest — normalization, serialize, parse, round-trips
└─ README.md       ← you are here
```

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

## Coming next (Phase 2, in order)

1. **Keymap + trie + mode-aware FSM.** `Keymap` maps key *sequences* → named action ids. A
   resolver FSM holds a pending buffer, matches against a trie, and fires / awaits (with a
   `timeoutMs`) / rejects. Modes: normal, insert, visual, prefix-pending.
2. **Conflict detection.** Static pass: flag any binding that is a prefix of another in the
   same mode (the shorter one incurs the timeout).
3. **On-screen keyboard overlay + "what did I just do?" action toast.**
4. **A vim-motion sandbox** to satisfy the exit criteria (hjkl/w/b/e/gg/G/dw/ciw).

## Exit criteria for Phase 2

- Run `hjkl`/`w`/`b`/`e`/`gg`/`G`/`dw`/`ciw` correctly in a sandbox text buffer.
- The conflict detector flags a binding that is a prefix of another in the same mode.
- The on-screen keyboard lights up correctly for every chord.

## Things NOT to do (per the planning doc)

- Bind to `event.key` (layout-dependent) — we use `event.code`.
- Wire keymaps to inline callbacks — actions are *named* (debuggable, remappable, analyzable).
- Capture on `window` — capture on a focused element only.
- Skip the conflict detector — it's the whole pedagogical point of the phase.
