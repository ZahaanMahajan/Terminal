# `src/shell/` — Phase 3: Fake Shell

> Per `docs/PLANNING_AND_ARCHITECTURE.md` §4 Phase 3. The "rubber-duck" doc for the module.

## What this module is

A believable in-browser shell: parse a command line, run a small command set against a fake
filesystem, with a line editor, history, and completion — rendered through the Phase 1 terminal
and driven by the Phase 2 input layer. Built so the "fake exec" can later be swapped for a real
PTY (Phase 5) with minimal change.

## Module layout

```
src/shell/
├─ tokenizer.ts       ← hand-written lexer: input → word/op tokens (quote/escape aware)
├─ index.ts           ← re-exports
├─ tokenizer.test.ts  ← 61 golden tests (input → exact tokens) + errors
└─ README.md          ← you are here
```

## Current state — step 1 (done): the tokenizer

`tokenize(input)` is a small state machine (NORMAL / single-quote / double-quote). It emits:

- **`word`** tokens — a list of **parts**, each tagged for later expansion:
  - `expandable` — bare or double-quoted text; a later phase expands `$VAR` / `${VAR}`.
  - `literal` — single-quoted or backslash-escaped text; verbatim, never expanded.
  - Adjacent quotes concatenate into one word (`foo'bar'baz` = one word, parts `foo|bar|baz`).
  - Empty quotes still produce a word with empty `parts` (an empty argument).
- **`op`** tokens — `|` `||` `&` `&&` `;` `<` `>` `>>` (greedy: `>>` before `>`, etc.).

### Why parts, not a flat string

`echo "hello $USER"` must expand `$USER`; `echo 'hello $USER'` must not. A flat unquoted string
loses that distinction. Tagging each part `literal` vs `expandable` lets the *expander* (a later
step) know exactly which spans to scan for variables. This is the honest way to do quoting.

### Why not `String.split(' ')`

It can't honour `"a b"` (one word), `'a|b'` (literal pipe), `a\ b` (escaped space), or glued
operators (`a|b`). The planning doc names this as a mistake to avoid; the 61 golden tests are the
proof it's handled.

### Deferred (intentional)

- **Expansion** (`$VAR`, `${VAR}`, `~`) — a later phase scans `expandable` parts.
- **Globbing** (`*`, `?`) — after the parser; "implement globbing before tokenization" is a
  named anti-pattern.
- **Comments (`#`), fd-redirection (`2>` as one token), line-continuation (`\\<newline>`)** —
  edge cases not needed for the exit criterion.

## Coming next (Phase 3, in order)

1. **Parser** — recursive descent over the tokens → AST (commands, pipelines, redirections,
   `;`/`&`/`&&`/`||`). Hand-written; no `nearley`/`pegjs`.
2. **Fake filesystem + builtins + executor** — in-memory tree; `cd`/`ls`/`cat`/`echo`/`pwd`/
   `mkdir`/`touch`/`rm`/`cp`/`mv`/`which`; `$VAR` expansion; pipelines wiring stdout→stdin.
3. **Line editor + history + completion + prompt REPL** — readline bindings via the Phase 2
   input layer, history ring buffer with reverse-search, pluggable completion, a prompt segment
   model rendered to ANSI, all feeding the Phase 1 terminal.

## Exit criteria for Phase 3

- `echo "hello $USER" | tr a-z A-Z` parses correctly (even if `tr` is a stub).
- Path completion works in subdirectories.
- History + reverse search behave like bash for the basics.
- The tokenizer has ≥ 50 golden tests. ✅ (61)
