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
├─ tokenizer.ts        ← hand-written lexer: input → word/op tokens (quote/escape aware)
├─ parser.ts           ← recursive-descent parser: tokens → Script AST
├─ filesystem.ts       ← in-memory POSIX-ish tree (resolve/read/write/mkdir/list/…)
├─ env.ts              ← variables + cwd + last exit code
├─ expand.ts           ← $VAR / ${VAR} / $? / ~ expansion (literal vs expandable)
├─ builtins.ts         ← the command set + RunContext/RunResult contract
├─ executor.ts         ← walk the AST: pipelines, redirects, &&/||, ; → run()
├─ index.ts            ← re-exports
├─ tokenizer.test.ts   ← 61 golden tests (input → exact tokens) + errors
├─ parser.test.ts      ← 23 tests (input → AST): structure, precedence, errors
├─ line-editor.ts      ← readline-style line buffer (insert/kill/word/home/end)
├─ history.ts          ← capped history + up/down draft-stash + reverse search
├─ completion.ts       ← Tab completion (builtins + path, subdirs, cd→dirs)
├─ prompt.ts           ← prompt segment model → ANSI + visible width
├─ filesystem.test.ts  ← path resolution + node ops
├─ expand.test.ts      ← $VAR/${VAR}/$?/~, literal-vs-expandable
├─ executor.test.ts    ← end-to-end: pipelines, redirects, and-or, builtins, exit codes
├─ line-editor.test.ts / history.test.ts / completion.test.ts / prompt.test.ts
└─ README.md           ← you are here
```

(The interactive REPL is `src/demos/ShellDemo.tsx` — it wires these modules to the Phase 1
terminal and Phase 2 input layer.)

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

## Step 2 (done): recursive-descent parser

`parse(input)` tokenizes (if given a string) and builds a `Script` AST. One method per grammar
production — the textbook recursive-descent shape:

```
script   := (andOr (';' | '&')?)*       Statement[] (background flag per statement)
andOr    := pipeline (('&&' | '||') pipeline)*
pipeline := command ('|' command)*
command  := (word | redirect)+          redirect-only (`> f`) allowed
redirect := ('>' | '>>' | '<') word
```

Operator precedence falls out of the nesting: `|` binds tighter than `&&`/`||`, which bind
tighter than `;`/`&`. A `Word` is the tokenizer's `WordPart[]` carried verbatim, so quoting
survives for the expander. `ShellError` on a leading/dangling operator, a redirect with no
filename, or a separator with nothing before it.

## Step 3 (done): filesystem + expansion + builtins + executor

- **`FileSystem`** — an in-memory dir/file tree; `resolvePath` normalizes `.`/`..` against a
  cwd; `FileSystem.from({...})` seeds a tree for tests/demos.
- **`Env`** — variables, cwd, and `lastExit` (`$?`).
- **`expand`** — `expandWord` walks a word's parts: `literal` verbatim, `expandable` scanned for
  `$NAME`/`${NAME}`/`$?`; leading bare `~` → `$HOME`. *This is where the tokenizer's tagging
  pays off.*
- **builtins** — `echo`/`pwd`/`cd`/`ls`/`cat`/`mkdir`/`touch`/`rm`/`cp`/`mv`/`which` plus
  `true`/`false` (for `&&`/`||`) and stdin filters `tr`/`grep`/`wc`. Each is
  `(ctx) => { stdout, stderr, code }` — the same contract a real PTY-backed command has, so the
  executor won't change when fake exec → real exec (Phase 5).
- **`executor`** — `execCommand` (expand argv, apply redirects, run builtin) → `execPipeline`
  (thread stdout→stdin) → `execAndOr` (`&&`/`||` short-circuit) → `execScript` (`;` sequence).
  `run(input, env, fs)` parses + executes; a `ShellError` becomes a printable line.

The exit criterion `echo "hello $USER" | tr a-z A-Z` runs end-to-end (tested).

### Known simplifications (documented)

- No word-splitting after expansion — one `Word` = one argument.
- Tilde doesn't distinguish bare vs double-quoted (`"~"` expands; `'~'` doesn't).
- Assignments are only the pure form (`X=1`); `VAR=v cmd` prefix scoping is deferred.
- `&` runs synchronously (no real job control); `cp`/`mv` are 2-arg; `tr` handles `a-z` ranges.

## Step 4 (done): line editor + history + completion + prompt + REPL

- **`LineEditor`** — a mutable line + cursor with readline ops (insert, backspace/del,
  left/right/home/end, C-w word-kill, C-k/C-u kills).
- **`History`** — capped, dedup-consecutive; Up/Down navigate (stashing the live draft);
  `reverseSearch` powers C-r.
- **`complete`** — first token → builtins; later tokens → filesystem paths (subdirectory split
  on `/`); `cd` offers only directories. Inserts the unique extension or the common prefix.
- **`renderPrompt`** — cwd (home → `~`, cyan) + a `❯` (green/red by exit code) → ANSI + the
  *visible* width so the REPL can position the cursor with CHA.

**The REPL** (`demos/ShellDemo.tsx`) is where the phases meet: keys flow through the Phase 2
`InputLayer` + `KeyResolver` (control keys → named editor actions; unbound printables insert via
`event.key`); a submitted line runs through `run()`; the shell emits ANSI to redraw the input
line (`\r` + prompt + text + `\x1b[K` + CHA), which the Phase 1 renderer paints. A focused
terminal captures Ctrl-W/R/L (custom `reservedGuard`), like a real terminal.

## Phase 3 complete — exit criteria

- ✅ `echo "hello $USER" | tr a-z A-Z` runs (tested end-to-end in `executor.test.ts`).
- ✅ Path completion works in subdirectories (`completion.test.ts`).
- ✅ History + reverse search behave like bash for the basics (`history.test.ts`).
- ✅ The tokenizer has ≥ 50 golden tests (61).

## Deferred (intentional)

Single-line input only (no wrap re-draw); no word-splitting after expansion; tilde doesn't
distinguish quoted/bare; pure assignments only; `&` is synchronous; no IndexedDB persistence
(the FS is in-memory per session). Real process I/O arrives with the **PTY in Phase 5** — and
the builtin contract (bytes in → bytes out + code) is shaped so the executor won't change.
