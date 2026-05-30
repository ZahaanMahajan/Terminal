# Terminal — A Roadmap for Becoming an Elite Engineer by Building a Terminal Ecosystem From Scratch

> **Version:** 1.0 (full rewrite — supersedes v0.1)
> **Audience:** one developer (you)
> **Posture:** solo, learning-first, anti-hype, anti-premature-abstraction
> **Promise:** if you finish even half of this honestly, you will understand renderers, parsers,
> compilers, shells, terminals, editors, and state systems at a depth most professional engineers
> never reach.

---

## 0. Preface — the pivot

The previous version of this document was a startup-grade SaaS plan: Kubernetes, microservices,
CRDTs, vector search, plugin marketplaces, multi-region edge, enterprise SSO. It is a perfectly
reasonable plan **for the wrong project**.

The actual project is this: **one engineer, learning the craft, building a terminal ecosystem
from primitives, and understanding every layer they touch.** That is a fundamentally different
optimization target. The metric is not ARR or DAUs. The metric is **how much of the stack you can
hold in your head and explain to a stranger.**

So this document throws the old plan away and starts over with a single principle:

> **Build engines before products. Build primitives before engines. Understand every layer.**

If at any point a section feels like it is preparing you for an investor pitch instead of preparing
you to understand a system, that section is wrong. Delete it.

---

## 1. The new operating philosophy

### 1.1 Five commitments

1. **Systems-first.** The interesting questions are "how does a terminal actually work?", "what is
   an ANSI escape sequence really?", "what does a compiler IR look like?". Not "what's our CDN?"
2. **Rendering-first.** You will paint pixels yourself before you let any library do it for you.
3. **Compiler-first.** The Config Compiler is the _intellectual core_ of this project. Everything
   else exists to make it interesting to use.
4. **Architecture-first.** Decisions are written down. Abstractions are introduced only when their
   absence has caused you measurable pain at least twice.
5. **Learning-first.** If a shortcut would teach you nothing, take the long way.

### 1.2 Anti-vibe-coding rules

Vibe coding = generating plausible code you cannot defend. The cure is not "type more by hand."
The cure is this discipline:

- **Read before you write.** Before implementing a thing, read at least two real implementations
  (`xterm.js`, `kitty`, `alacritty`, a real shell, a real parser). Take notes in `docs/notes/`.
- **Write a one-paragraph design before any non-trivial function.** What does it do, what's the
  input/output contract, what's the failure mode, what is intentionally _not_ solved? Comment-block
  it in the file.
- **No library you cannot describe.** Before `npm install X`, you must be able to write a paragraph
  explaining what X does and what part of it you're using. If you can't, you don't understand the
  problem yet.
- **Explain it to the rubber duck.** Before committing a tricky module, write a `README.md` in its
  folder explaining the algorithm to a fictional reader. If the explanation is hand-wavy, the code
  is hand-wavy.
- **Snapshot/golden tests over assertions.** For renderers, parsers, and compilers, the most
  educational tests are "given this input, here's the exact output." Diffs become a teacher.
- **Tracebacks are study material.** When something breaks, read the _full_ stack and the
  _library's own source_ before searching online. The bug is a free lecture; don't skip class.

### 1.3 Why simpler is better — _now_

A small architecture is not "less work." It is **more learning per unit of code**, because each
piece is something you wrote and understand. A microservice you copy-pasted from a tutorial
teaches you nothing about microservices; it teaches you tutorial-following. The same is true of
Kubernetes manifests, GraphQL federation, CRDT libraries, and OAuth providers. **You learn systems
by being the system.**

There is a second, subtler reason. Premature complexity hides your skill gaps. If you sit on a
huge stack, every bug routes through layers you didn't write, and you build a habit of _guessing
upward_ ("must be a Next.js thing"). A small stack forces every bug back to _your_ code. That is
where engineering intuition is grown.

### 1.4 When you'll know it's time to add something

A rule, calibrated for this project:

> **Add an abstraction only after the third time you've felt its absence as pain.** First time:
> note it. Second time: still note it. Third time: implement, and remove the workaround.

Examples in practice:

- A second consumer of "render a terminal frame" → still just a function call.
- A third surface that needs it, and the third one needs it slightly differently → _now_ extract
  a `TerminalRenderer` interface.
- One spot where two writers race over the same file → take the L, add a mutex, move on.
- Three spots → consider a `Store` with explicit transactions. Not before.

---

## 2. Minimal first architecture

Burn this diagram into your brain. This is the entire system for the first months of work.

```
                                ┌────────────────────────────┐
                                │         Browser (React)    │
                                │                            │
                                │   ┌──────────────────────┐ │
                                │   │   Terminal Renderer  │ │ ◀── you draw cells on <canvas>
                                │   │   (Canvas 2D)        │ │
                                │   └──────────┬───────────┘ │
                                │              │ frames      │
                                │   ┌──────────▼───────────┐ │
                                │   │   ANSI Parser        │ │ ◀── you implement VT100 subset
                                │   │   (state machine)    │ │
                                │   └──────────┬───────────┘ │
                                │              │ bytes       │
                                │   ┌──────────▼───────────┐ │
                                │   │   Fake Shell (REPL)  │ │ ◀── parses commands, fake FS
                                │   └──────────▲───────────┘ │
                                │              │             │
                                │   ┌──────────┴───────────┐ │
                                │   │  Keyboard Engine     │ │ ◀── modes, sequences, FSM
                                │   │  (Vim-style modal)   │ │
                                │   └──────────────────────┘ │
                                │                            │
                                │   ┌──────────────────────┐ │
                                │   │   Config Compiler    │ │ ◀── AST → IR → dotfiles
                                │   │   (TS, in-browser)   │ │
                                │   └──────────────────────┘ │
                                │                            │
                                │   ┌──────────────────────┐ │
                                │   │  Local Persistence   │ │ ◀── localStorage / IndexedDB
                                │   └──────────────────────┘ │
                                └──────────────┬─────────────┘
                                               │ (later, only when needed)
                                ┌──────────────▼──────────────┐
                                │   Tiny Node/Go API + SQLite │   ← Phase 6, not before
                                └─────────────────────────────┘
```

That is it. No queues. No event bus. No services. No containers. No CDNs. No clusters. No reverse
proxies. No "edge." A `vite dev` server in one terminal and (eventually) a `node`/`go run` in
another. **One process, one machine, one head.**

### 2.1 Why this beats the big architecture for learning

- **Every module is small enough to rewrite in a weekend.** That means you'll _actually_ rewrite
  it when you learn something, instead of carrying around your first naive implementation forever.
- **The data path is visible.** A keystroke goes: DOM event → keyboard engine → fake shell →
  bytes → parser → renderer → pixels. You can put a `console.log` at every step and watch a key
  travel. That is the entire mental model of a terminal in 50 lines of glue.
- **No black boxes.** When the cursor renders one pixel off, you don't blame "the framework."
  You open _your_ file and fix _your_ bug.
- **Refactor cost is near zero.** When you learn a better approach in week 8, week 1's code can
  be deleted with one keystroke. Big architectures resist their own evolution.

---

## 3. Tech stack — chosen for clarity, not resumes

### 3.1 Frontend

- **React + TypeScript + Vite + Tailwind.** That's the whole list.
- **Canvas 2D API** for the terminal renderer.
- **Plain functions and React context** for state, until that hurts.

#### Why React + Vite (not Next.js)

Next.js solves problems that **do not exist yet in this project**: server rendering for SEO,
route-level data loading, image optimization, edge middleware, server actions. Adopting it now
means you spend cognitive energy on RSC boundaries, server/client component rules, caching
semantics, and a build pipeline you didn't write — none of which teaches you anything about
_terminals_. Vite gives you the absolute minimum: a fast dev server, ES modules in the browser,
HMR, a build command. You can read its config in one sitting. Everything you don't understand in
your app is **yours**, not the framework's.

When does Next.js become justified? When you have _public, indexable_ setup pages that need to
load fast on cold visits (Phase 6+ at the earliest), and the team is more than just you. Until
then, Vite + a single SPA route is correct.

#### Why direct browser rendering matters

The browser is a renderer pretending to be a document model. Most web devs only learn the document
model. By going directly to `<canvas>` you learn what a renderer _is_: a loop that maps state to
pixels under a frame budget. You will learn to think in 16ms windows, in dirty regions, in glyph
atlases, in damage. That mental model transfers to every UI framework, every game engine, every
graphics API you ever touch.

#### Why Canvas is educational

Canvas is a deliberately small surface. You get `fillRect`, `fillText`, `drawImage`, a couple of
transforms, and the rest is up to you. That smallness is the lesson. To draw a terminal you have
to _think about_: text metrics and baselines, monospace cell math, cursor blink timing, scroll as
buffer-window arithmetic, double-buffering for flicker, glyph caching for performance. None of
that is hidden from you. Compare to "use xterm.js" — you'd be done in an hour and learn nothing.

You will _eventually_ graduate to WebGL (for glyph atlases on the GPU) and _eventually_ compare
your renderer to xterm.js. But you should be able to look at xterm.js source and recognize each
piece from having built a worse version of it yourself.

### 3.2 Backend

- **One service. Node or Go.** Pick the one you're weaker in — you're here to learn.
- **REST only.** No GraphQL. No gRPC. No WebSockets (yet).
- **SQLite** to start (file-based, zero ops). Migrate to PostgreSQL only when you need things
  SQLite doesn't have (full-text richness, concurrent writers under load, network access).
- **Plain files on disk** for early persistence — `~/.termi/setups/<id>.json`. A database is a
  glorified file with extra invariants. Earn the invariants by missing them.

#### Monolith-first

Service boundaries are _coordination cost_: extra network calls, two deploy pipelines, two error
surfaces, more security boundaries, distributed tracing, etc. They are sometimes worth it — when
two teams own different lifecycles, or when one component genuinely needs different scaling
characteristics. **You are one person.** A single binary, with internal module boundaries (e.g.,
Go packages, TS folders), gives you 90% of the benefit of services with 5% of the cost. When you
later split, you'll know exactly which seam to cut, because you'll have lived with the friction.

#### Why this stack will not embarrass you later

It scales further than people think. Stack Overflow ran on a handful of servers. Many famous
products started on one box with SQLite. The fancy stuff is for when measurements say you need it.

### 3.3 What you are explicitly **not** installing

| Tool                  | Why you're skipping it (for now)                                                      |
| --------------------- | ------------------------------------------------------------------------------------- |
| `xterm.js`            | You're building the renderer to learn the renderer.                                   |
| `node-pty`            | A real PTY in Phase 5; a fake shell first.                                            |
| `next`                | Solves zero problems you currently have.                                              |
| `graphql`, `apollo`   | REST is enough; GraphQL is for many-client fan-out you don't have.                    |
| `socket.io`, `ws`     | No realtime needs yet.                                                                |
| Redux/Zustand/Jotai   | React state + a few stores is fine; pick one only when context props cause real pain. |
| ORMs (Prisma/Drizzle) | Write SQL. You need to understand the queries you're running.                         |
| OAuth libraries       | Implement the code+PKCE flow yourself once. You'll never fear it again.               |
| Docker                | Run things on your machine. Containerize when deploying.                              |
| Kubernetes            | Not in this document, not in this decade.                                             |

---

## 4. The phases — a learning curriculum disguised as a product

Each phase is a self-contained study unit. It defines: **what you build**, **what you learn**,
**what to read**, **what to avoid**, **exit criteria** (how you know you're done). Resist the urge
to jump phases — the order is the curriculum.

> **Heuristic for duration:** each phase is "as long as it takes to honestly meet exit criteria."
> If you're moving fast, you might be skimming. If you're stuck for two weeks, that's normal —
> you're learning the thing the phase exists to teach.

---

### Phase 1 — Terminal Rendering Engine

**Goal:** paint a faithful terminal grid on a `<canvas>` yourself, with a cursor, ANSI colors, a
scrollback buffer, line wrapping, and at least 60fps for normal use.

**What you build, in roughly this order:**

1. **A monospace grid.** Pick a font. Measure a character with `measureText` to get
   `cellWidth` and `cellHeight` (advance + ascent + descent). Draw a grid of cells.
2. **A `Screen` data structure.** A 2D array of `Cell { char, fg, bg, attrs }`. The renderer's
   only job is to map `Screen` → pixels. The screen is the truth.
3. **A render loop.** `requestAnimationFrame` driven; redraw only **dirty rows** (track which
   rows changed since last frame). Measure your frame time.
4. **A cursor.** Position, shape (block/beam/underline), blink. Blink without re-drawing the
   whole screen.
5. **A scrollback buffer.** Decouple "what's on screen" (a window) from "what's been written"
   (a ring buffer). Implement scroll as window-offset math.
6. **Line wrapping.** Hard wrap at the right edge; track the "wrap" property so you can later
   un-wrap when resizing.
7. **ANSI parsing.** Implement the VT100/ECMA-48 subset (SGR colors, CSI cursor movement, EL/ED
   erase, scroll regions). State machine, not regex. The canonical reference is **Paul Williams's
   parser state diagram** — implement it directly.
8. **256-color and truecolor** (24-bit RGB via `38;2;r;g;b`).
9. **A glyph cache.** Pre-render each (char, style) to an offscreen canvas; blit at runtime.
   Measure the speedup.

**What you'll learn (the actual point):**

- The **render loop** as a concept (state → frame → present → repeat). Frame budget, jank,
  vsync, the difference between _redraw_ and _re-layout_.
- **Text rendering**: baselines, advance widths, why monospace matters, why ligatures break the
  cell model, fallback fonts, kerning (and why terminals ignore it).
- **Damage / dirty-region tracking** — the single biggest perf trick in any UI system.
- **Off-screen buffers** and the double-buffer pattern.
- **State machines** done properly (Williams's parser is a beautiful one to copy).
- **Ring buffers** and the window-into-a-buffer idiom that powers all scrollback.
- **Color systems** (palette indexing, 256-color cube math, truecolor blending).
- **Coordinate systems** — origin, padding, top-left vs. baseline-anchored text.

**What to read while you build:**

- **Paul Williams**, "A Parser for DEC's ANSI-Compatible Video Terminals" — the parser state
  diagram you should implement.
- The **ECMA-48** standard (skim, then keep open).
- `xterm` (the original, in C) for ANSI handling reference; `alacritty/vte` (Rust) for a modern
  parser; `kitty` for performance ideas. You're not copying — you're triangulating.
- The Canvas chapter in MDN; "Inside a font" articles on baselines and metrics.

**Mistakes to avoid:**

- Re-rendering the whole canvas every frame. (Measure first, then implement dirty rows.)
- Drawing each character one `fillText` call without caching. (Slow; that's where the glyph
  cache lesson lives.)
- Storing styled text as HTML strings or with embedded escape codes in your `Screen`. The
  `Screen` is _parsed state_, not raw bytes. Parse once; render many.
- Treating wrap as "just keep drawing past the edge." Wrap is data; record it.
- Using `key` events to drive rendering directly. Input is a separate phase; keep them
  decoupled.

**Libraries to avoid in this phase:**

- `xterm.js` (the whole point is to _be_ it for one phase of your life)
- React for the renderer itself — render on a `<canvas>` ref, not via JSX
- Any "ANSI parser" npm package
- A font rendering library; the built-in Canvas text is exactly the experience you want

**Exit criteria (you're done with Phase 1 when):**

- You can `paste` a chunk of `htop` output and it renders correctly, colors and all.
- Scrolling 10,000 lines stays smooth (≥ 60fps redraw on dirty rows only).
- Resizing the window reflows wrapped lines correctly.
- You can explain Williams's parser at a whiteboard without notes.

---

### Phase 2 — Keyboard & Input Systems

**Goal:** a modal keyboard engine that understands Vim-style motions, tmux-style prefix chords,
and shell-style readline bindings — and resolves them deterministically.

**What you build:**

1. **An input layer.** A single `KeyboardEvent` listener (on the focused surface) that turns
   browser events into an internal `Key` token: `{ key: "h", mods: { ctrl, alt, shift, meta } }`.
   Use `event.code` (physical key) not `event.key` (layout-sensitive).
2. **A `Keymap` type** that maps key sequences to **named actions** (not callbacks). Names give
   you debuggability, conflict detection, and remappability.
3. **A mode-aware FSM.** Modes: `normal`, `insert`, `visual`, `prefix-pending`. The FSM holds a
   _pending buffer_ of keys, attempts to match against the active keymap's trie, and either fires
   an action, awaits more keys (with `timeoutMs`), or rejects.
4. **A keymap trie.** Multi-key sequences (`gg`, `<leader>ff`, `Ctrl-b "`) live in a trie so
   resolution is `O(sequence length)`.
5. **Conflict detection.** Static pass: any two bindings where one is a prefix of the other in
   the same mode is flagged with the resulting latency cost (because the longer one will incur
   the timeout).
6. **An on-screen keyboard overlay.** Reuses the same `Key` token type to highlight keys.
7. **A "what action did I just do?" toast.** Resolved action name + description, fed by the FSM.

**What you'll learn:**

- **Event systems**: capture vs. bubble, focus management, why `preventDefault` matters and how
  to scope it (never globally hijack `Cmd+W`).
- **Finite state machines** for real (modes are textbook FSMs; vim and tmux are case studies).
- **Tries** as a practical data structure, not a Leetcode answer.
- **Keyboard abstraction layers**: separating _physical key_ from _logical key_ from _action_.
  This three-layer model is the right answer in every input system you'll ever touch (games,
  editors, accessibility tools).
- **Determinism under timeouts** — the subtle UX of `timeoutlen`.
- **Accessibility**: focus rings, ARIA live regions for actions, `prefers-reduced-motion`,
  never trapping browser-critical keys.

**What to read:**

- The Vim manual sections on `:map`, modes, and `timeoutlen`.
- Tmux's prefix-key model in `man tmux`.
- Readline's keybinding docs (`man 3 readline`).
- The MDN page on `KeyboardEvent.code` vs `.key` (read it twice; this is the source of 100% of
  cross-keyboard bugs).

**Mistakes to avoid:**

- Binding to `event.key`. Your Dvorak users will hate you.
- Wiring keymaps to inline callbacks. Named actions are the right abstraction.
- Global key capture. Capture only on focused surfaces; provide a visible "capture is on" hint
  and an obvious escape.
- Skipping the conflict detector "for now." It's the entire pedagogical point.

**Exit criteria:**

- You can run `hjkl`/`w`/`b`/`e`/`gg`/`G`/`dw`/`ciw` correctly in a sandbox text buffer.
- Your conflict detector flags `gg` vs `gG` in the same mode.
- An on-screen keyboard lights up correctly for every chord.

---

### Phase 3 — Fake Shell

**Goal:** a believable in-browser shell — parses commands, has a history, completes paths, runs
a small command set against a fake filesystem, and renders through your Phase 1 terminal.

**What you build:**

1. **A line editor.** Cursor-positioned editing with readline-style bindings: `Ctrl-a/e`,
   `Ctrl-w`, `Ctrl-k`, history up/down. Reuses Phase 2's input layer.
2. **A tokenizer + parser.** A hand-written lexer that splits on whitespace (respecting single
   and double quotes and backslash escapes), then a tiny parser for pipelines (`|`), background
   (`&` — printed-only at first), and redirections (`>`, `>>`, `<`). **Hand-written, recursive
   descent.** No `nearley`, no `pegjs`. The grammar is small; do it yourself.
3. **A fake filesystem.** An in-memory tree: `{ kind: 'dir', children }` and
   `{ kind: 'file', contents }`. Implement `cwd`, `cd`, `ls`, `cat`, `echo`, `pwd`, `mkdir`,
   `touch`, `rm`, `cp`, `mv`, `which`. Persist to IndexedDB so it survives reload.
4. **A history ring buffer** with reverse-search (`Ctrl-r`).
5. **A completion engine.** Pluggable per-command: default = path completion; per-builtin = its
   own completer (e.g., `cd` only completes directories). This is your first taste of "plugins"
   without inventing a plugin system.
6. **A prompt renderer.** A small segment model (cwd, git-branch-fake, exit-code, time) that
   renders to ANSI and feeds Phase 1.

**What you'll learn:**

- **Parsers** from the ground up — tokenizer/parser separation, lookahead, recursive descent,
  how shells actually parse (with their quirky tokenization).
- **Shell internals** — what a built-in is, what a pipeline is, what `stdin/stdout/stderr` are
  even before you have real ones (Phase 5).
- **REPL architecture** — the read/eval/print/loop pattern, history, completion as a separate
  concern from execution.
- **State machines** again — line-edit modes (normal/incremental-search), completion menu state.
- **Designing for replaceability.** Your "fake exec" function will later be swapped for a real
  PTY. If your shell is structured well, that swap is small.

**What to read:**

- `bash` manual sections on quoting and word splitting (they're famously gnarly; that's the
  lesson).
- Crafting Interpreters (Chapters 4–6) — Bob Nystrom's tokenizer/parser is exactly the right
  level of zoom.
- `xonsh`, `fish` source for shell-as-program inspirations.

**Mistakes to avoid:**

- Using `String.split(' ')` as your tokenizer. (You will burn yourself on `echo "hello world"`.)
- Implementing globbing before you've nailed tokenization. One thing at a time.
- Building a fake `git` _now_. The shell renders something _like_ a git prompt segment; the
  segment is fake data. Don't simulate the world.
- Making `cd` change the React tree directly. The shell owns `cwd`; the renderer subscribes.

**Exit criteria:**

- `echo "hello $USER" | tr a-z A-Z` parses correctly (even if `tr` is a stub).
- Path completion works in subdirectories.
- History + reverse search behave like bash for the basics.
- Your tokenizer has at least 50 golden tests (`input → tokens`).

---

### Phase 4 — Config Compiler (the heart of the project)

**Goal:** a typed AST for terminal/shell/editor configuration; transforms that lower it to
intermediate representations per target; emitters that produce real, idiomatic dotfiles. All
in TypeScript, all in-browser, all comprehensible end-to-end.

This is **the** phase. Other phases are interesting; this one is _yours_. It is the thing that
will most clearly distinguish you as an engineer.

**What you build:**

1. **The AST schema.** Start tiny: `Setup { shell: ZshConfig | BashConfig, prompt: StarshipConfig }`.
   Define it with TS types and validate with `zod`. Resist boiling the ocean — three targets is
   plenty for Phase 4.

   ```ts
   // packages/compiler/src/ast.ts
   type Setup = {
     schemaVersion: 1;
     shell: ShellConfig; // { kind: 'zsh' | 'bash'; aliases, env, plugins }
     prompt?: PromptConfig; // { engine: 'starship'; segments: PromptSegment[] }
     meta: { name: string; os: Array<"macos" | "linux"> };
   };
   ```

2. **Validation.** `zod` parses the AST; semantic checks (referenced plugins exist, env keys
   are valid identifiers, no duplicate aliases) run after parsing and produce a _list_ of
   diagnostics with file-position-style paths into the AST.
3. **Lowering to an IR.** For each target (zsh, starship, etc.), define an IR — an ordered list
   of _statements_ in the natural shape of the target. For zsh: `[Export, Alias, SourcePlugin,
InitPrompt]`. The lowering pass walks the AST and emits IR statements in dependency order.
4. **Emitters.** IR → string. A pretty-printer per target. Pure, deterministic.
5. **Golden tests.** A fixtures folder with `*.ast.json` → `*.expected.zshrc`. The test runner
   compiles each AST and `diff`s against the expected file. **This is the soul of the project.**
   When you change the compiler, the diff tells you exactly what changed in your output. You will
   come to love this feedback loop.
6. **A diff view in the UI.** Two Monaco editors side-by-side: current output vs. previous
   output, updated as you edit the AST.
7. **Migrations.** When you change the AST shape, write a one-function migration
   (`v1 → v2(setup)`). Run on load. Never break an old setup.
8. **A tiny "modules" idea.** A module is a _function_ `(setup) → setup` that adds aliases,
   env, plugins. That's it. No registry yet. No marketplace. A module is a TS file in `packages/
compiler/src/modules/`. You'll know if you need more later.

**Folder shape:**

```
packages/compiler/
├─ src/
│  ├─ ast.ts                # types + zod schemas
│  ├─ validate.ts           # semantic checks → Diagnostic[]
│  ├─ lower/
│  │  ├─ zsh.ts             # AST → ZshIR
│  │  ├─ bash.ts
│  │  └─ starship.ts
│  ├─ ir/
│  │  ├─ zsh.ts             # ZshIR statement types
│  │  └─ ...
│  ├─ emit/
│  │  ├─ zsh.ts             # ZshIR → string
│  │  └─ ...
│  ├─ modules/              # tiny composable transforms
│  │  ├─ fzf.ts
│  │  └─ catppuccin.ts
│  └─ migrations.ts
├─ test/
│  ├─ fixtures/
│  │  ├─ minimal-rust.ast.json
│  │  └─ minimal-rust.expected.zshrc
│  └─ golden.test.ts
└─ README.md                # explain the AST → IR → emit pipeline
```

**What you'll learn (this is the gold):**

- **Compilers** as a _practical_ topic, not a theoretical one. You will internalize the
  AST → IR → backend pattern that powers every real compiler (LLVM, Roslyn, swc, Babel).
- **Intermediate representations** and _why_ they exist (decoupling source from target;
  enabling multiple front-ends and back-ends; making optimizations local).
- **Schema design and evolution.** Versioned schemas + migrations are how all real long-lived
  software handles change. Doing it once for your AST inoculates you against years of bad
  decisions in real jobs.
- **Tree transformations** — pure functions on data trees, the foundation of compilers, codemods,
  build systems, and anything you'll ever use Babel/swc for.
- **Deterministic code generation** — why determinism makes diffs informative, caches valid, and
  bugs reproducible.
- **Diagnostics design** — error messages with paths, levels, suggested fixes. (Compare to the
  awful errors you've all suffered.)
- **Golden testing** — a discipline that becomes second nature after this phase.

**What to read:**

- _Crafting Interpreters_, Part II (it's a tree-walking compiler; perfect calibration).
- The first few chapters of _Engineering a Compiler_ (Cooper & Torczon) — IR design.
- `swc` or `Babel`'s source for a real-world AST + visitor pattern.
- `stylua`/`shfmt`/`prettier` for emitter inspiration (how do _they_ keep output stable?).
- _Stages of Compilation_ (any classic compilers textbook) — the lowering pipeline.

**Mistakes to avoid:**

- Emitting strings directly from the AST. (You skipped the IR; you'll regret it within a week.)
- Putting logic in templates. Logic in transforms; templates emit _only_ strings.
- Adding 12 targets before one works perfectly. Depth over breadth in Phase 4.
- Skipping golden tests because "I'll see if it looks right." You won't, for long.
- Generating output that's "right" but ugly. Run real formatters (`shfmt`, `stylua`) on your
  output — it's a free taste of "what does the community consider idiomatic?"

**Concepts to rebuild yourself in this phase:**

- A tiny visitor pattern (walk an AST, dispatch by node type).
- A diagnostic type + a pretty error printer (à la `rustc`).
- A simple effect/order-aware topological sort for modules with dependencies.

**Exit criteria:**

- Edit a slider in the UI → AST changes → compiler runs → output diff updates in < 50ms.
- Three real targets compile to outputs that _actually work_ if pasted into a real shell.
- 50+ golden tests, all green.
- You can describe at a whiteboard: AST → validate → lower → IR → emit → format. Without notes.

---

### Phase 5 — Real PTY Integration

By now your fake shell has taught you what a shell _does_. Now you learn what one _is_, on a
real operating system.

**Goal:** run a real shell (`zsh`, `bash`) inside your in-browser terminal via a tiny local
backend that owns a PTY, and bridge stdin/stdout through a stream.

**What you build:**

1. **A tiny local backend** (Node or Go), single binary, two endpoints:
   - `POST /pty` → spawn a PTY (size, cwd, env, shell) → returns a session id.
   - `WS /pty/:id` → bidirectional bytes (browser typing → PTY stdin; PTY stdout → browser).
2. **Use `node-pty` (Node)** or **`creack/pty` (Go)**. Read their source. Understand that under
   the hood you are talking to `openpty(3)` / `forkpty(3)` / `ioctl(TIOCSWINSZ)`.
3. **Resize plumbing.** Window resize → SIGWINCH → terminal app reflows. Test with `htop`.
4. **Bytes, not strings.** The browser ↔ server protocol is binary. Convert at exactly one
   boundary; never inside the parser.
5. **Process lifecycle.** On disconnect, kill the child (after a grace period). On reconnect,
   you may attach to an existing session if you wired session ids.

**What you'll learn:**

- **What a TTY actually is** — a kernel character device, with line discipline (`stty`, raw vs.
  cooked mode), special characters (`Ctrl-C` = SIGINT via line discipline), window size as an
  `ioctl`.
- **`fork` + `exec` + the controlling terminal** — the dance every shell does on startup.
- **Stdio and streams** — `read(2)` semantics, partial reads, backpressure, why your parser
  must be byte-stream-safe (don't assume escape sequences arrive whole; buffer them).
- **Process signals** — SIGINT, SIGHUP, SIGWINCH; how they reach a child and what they do.
- **WebSockets** at a level that matters — framing, backpressure, lifecycle, and why you
  shouldn't use them for everything.

**What to read:**

- `man 4 pty`, `man 2 forkpty`, `man 3 termios`, `man 7 signal`.
- Julia Evans's TTY zines / blog posts — best primer ever written.
- `node-pty` source — it's small and instructive.
- The `WebSocket` MDN page (you'll only need the basics).

**Mistakes to avoid:**

- Treating the stream as a string of characters. Multi-byte UTF-8 will bite you mid-codepoint.
- Re-creating the ANSI parser. Your Phase 1 parser already handles this — just feed it bytes.
- Skipping resize. A terminal that doesn't reflow is a toy.
- Exposing the PTY backend to the open internet. **Bind to `127.0.0.1` only.** A PTY endpoint
  is remote code execution by design; treat it as such.

**Exit criteria:**

- `vim`, `htop`, `nano`, `nvim` all run inside the browser terminal.
- Resize works during a live `htop`.
- `Ctrl-C` interrupts a running `sleep`.
- You can explain `forkpty` at a whiteboard without notes.

---

### Phase 6 — Persistence & a Tiny Backend

Only now — after you have a renderer, an input system, a shell, a compiler, and PTYs — do you
introduce the network and the database. By this point you know exactly what you need them for,
which is the entire point of waiting.

**Goal:** save and load setups across devices, with a small REST API and a simple, owned auth
flow.

**What you build:**

1. **One backend service** (the same one from Phase 5, expanded). Routes:
   - `POST /auth/github` (OAuth Authorization Code + PKCE).
   - `GET /me`.
   - `GET/POST/PATCH/DELETE /setups`.
   - `POST /setups/:id/publish` (snapshot to a version).
2. **SQLite** at `./termi.db`. Tables: `users`, `sessions`, `setups`, `setup_versions`. Plain
   SQL via `better-sqlite3` (Node) or `mattn/go-sqlite3` (Go). **No ORM.**
3. **Auth done by you.** OAuth code+PKCE implemented from the RFCs (it's ~150 lines). Sessions
   = signed httpOnly cookie containing a session id; sessions table holds the metadata. Rotate
   on login; expire on disuse.
4. **A tiny migrations system.** A `migrations/` folder of `001_init.sql`, `002_...sql`; the
   app applies any unapplied migrations on startup. (Don't reach for a migration library yet —
   this is also a learning moment.)
5. **Optional sync to git.** A `POST /sync/push` that uses a per-user GitHub token to write
   compiled outputs + the AST JSON to a private repo. This is a small, contained feature; do it
   only when you actually want it.

**What you'll learn:**

- **Real OAuth** — PKCE, `state`, redirect URI validation, scope minimization. You'll lose all
  fear of identity providers after doing this once.
- **Cookies and sessions** the right way — httpOnly, SameSite, signed values, rotation, idle
  expiry, the difference between authentication and a session.
- **SQL** as a _language_, not an ORM-mediated set of method calls. You will write joins. You
  will understand indexes. You will run `EXPLAIN`.
- **Migrations** as a _practice_ — irreversible, forward-only, owned by the app.
- **HTTP semantics** — idempotency, status codes, caching headers, content negotiation. (REST
  becomes natural once you've designed a small one.)
- **Error handling at boundaries** — what the client sees vs. what you log.

**What to read:**

- RFC 6749 (OAuth 2.0) and RFC 7636 (PKCE). Yes, read the RFCs. They are short.
- SQLite's documentation pages on WAL mode and `PRAGMA`s — surprisingly enlightening.
- _Designing Data-Intensive Applications_, chapters 2–3 (data models and storage engines) —
  not because you need them yet, but because now you have hooks to hang the ideas on.

**Mistakes to avoid:**

- Reaching for an ORM. You're here to learn SQL.
- Storing tokens in `localStorage`. Cookies are right; XSS exposure of tokens is real.
- "Just make it work" auth. Auth bugs are silent and catastrophic; this is one of the few
  places to slow down and be paranoid.
- Adding Redis/queues/etc. SQLite + the request thread is enough. _Far_ enough.

**Exit criteria:**

- A real friend can sign in on their computer, save a setup, and load it on another browser.
- You can rebuild the schema from `migrations/` on an empty machine in one command.
- You can describe at a whiteboard: full OAuth code+PKCE flow, session lifecycle, and how a
  request is authenticated end-to-end.

---

## 5. What's been removed — and _why_ and _when_ (maybe)

Each of these belongs in a different project, or in this project years from now after a
specific, observed pain. Don't add any of them sooner.

| Removed                                | Why it's premature now                                                                                                          | When it might become relevant                                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Microservices**                      | One process is comprehensible; many is not. The bug surface multiplies before the load does.                                    | When two genuinely independent lifecycles or scaling profiles emerge, _and_ you have ops to support it.                       |
| **Kubernetes**                         | A solution to a problem you don't have (orchestrating many containers across many machines).                                    | If you ever run dozens of services across many nodes with real SLOs. For one Node/Go binary, `systemd` is plenty.             |
| **CRDTs**                              | They solve concurrent multi-writer convergence. Your "concurrency" is one user on one device.                                   | If/when you ship realtime multiplayer editing of setups. Read CRDT papers earlier for fun; ship them only when you need them. |
| **Realtime collab (WebSocket)**        | No second user to collaborate with.                                                                                             | After Phase 6, if user research says people pair on setups.                                                                   |
| **Event-driven architecture / queues** | One request, one handler, one DB call. You'll know when you need a queue because a long-running job times out the HTTP request. | First long-running async job (e.g., heavy compile, repo import). Start with one queue (Redis Streams), not Kafka.             |
| **Plugin marketplace**                 | You have no community, no plugins, no moderation problem.                                                                       | Only after a genuine third party has _asked_ to write a plugin.                                                               |
| **WASM plugin sandbox**                | Sandboxes solve "running untrusted code safely." You have zero untrusted code.                                                  | When you accept third-party transforms. Until then, modules are just TS files in your repo.                                   |
| **AI features**                        | Hallucinated text dotfiles are dangerous; AI shines _after_ the compiler exists (because the compiler validates AI output).     | Once the AST is stable, AI can emit AST patches. Don't bolt it on before.                                                     |
| **Vector search**                      | You don't have a corpus.                                                                                                        | Only when you have lots of community setups and a real "find similar" UX problem. Postgres FTS first.                         |
| **Multi-region infra**                 | One region serves a few users at low latency.                                                                                   | When real users in a far region complain about real latency. Until then, one region per continent at most.                    |
| **Enterprise auth (SSO/SAML/SCIM)**    | No enterprise customers.                                                                                                        | When the first one shows up with a check.                                                                                     |
| **Team features**                      | No teams.                                                                                                                       | When real users ask to share private setups with a group.                                                                     |
| **GraphQL**                            | Avoids over-fetch across many clients. You have one client and you wrote both ends.                                             | When 3+ heterogeneous clients or a public schema-driven API justify it.                                                       |
| **OAuth provider libraries**           | Black-boxing the one auth flow you should have learned the hard way.                                                            | After you've implemented it once by hand.                                                                                     |
| **ORMs**                               | Hides the queries you need to read.                                                                                             | When _you_ think the boilerplate exceeds the learning, not when the internet thinks so.                                       |
| **Docker (dev)**                       | Adds a layer between you and the process.                                                                                       | When you're packaging for deploy.                                                                                             |
| **Multi-cloud**                        | You have zero clouds.                                                                                                           | Functionally never for this project.                                                                                          |

The principle: **defer until the cost of not having it has been felt, named, and dated in your
notes at least three times.**

---

## 6. Deep learning sections

### 6.1 What you will learn (compressed cross-phase map)

| Layer                | Concepts you'll own                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| Browser rendering    | Canvas, render loops, frame budget, double buffering, glyph caches, dirty regions, text metrics |
| Parsing              | Lexers, recursive descent, parser state machines (Williams), shell tokenization quirks          |
| Compilers            | AST design, IR design, lowering passes, visitors, emitters, diagnostics, golden tests           |
| Schemas & versioning | Typed schemas (`zod`/TS), forward migrations, deterministic serialization                       |
| Input systems        | Event capture, focus, FSMs, tries, layout-independent keys, accessibility                       |
| Shells               | Tokenization, pipelines, redirects, line editors, completion, history                           |
| Terminals            | VT/ANSI, palettes, scrollback, line wrap, cursor, modes, PTYs, line discipline                  |
| OS / processes       | `fork`, `exec`, `openpty`, signals, `ioctl(TIOCSWINSZ)`, stdio, raw vs cooked                   |
| Networking           | HTTP semantics, REST design, cookies, WebSockets (later), backpressure                          |
| Storage              | SQL (writing it), SQLite internals, indexes, transactions, migrations                           |
| Identity             | OAuth code+PKCE, sessions, cookie security, scope minimization                                  |
| State                | React state, store-vs-prop boundaries, derived state, controlled vs. uncontrolled               |
| Engineering practice | Golden testing, design notes, ADRs, deferred abstraction, reading source                        |

### 6.2 Why this matters

Most engineers learn the **shape** of a system (the names of the layers, where files go in a
framework) without learning the **physics** of it (what a render loop does each frame, what
bytes flow through a pipe, what an index is doing under your query). The former lets you ship
features in a known stack. The latter lets you walk into _any_ stack and feel oriented within a
day. Terminal is constructed to teach the second kind of knowledge.

This is also why this is the right project. A terminal touches every interesting layer of a
modern computer: pixels, fonts, input, parsing, processes, streams, OS, storage, and identity.
You can build a CRUD app and only learn HTTP. You build a terminal and you learn the whole
machine.

### 6.3 Mistakes to avoid (the cross-cutting ones)

- **Optimizing before measuring.** No glyph cache before you've profiled a frame. No index
  before you've EXPLAINed a slow query. Performance work without numbers is theatre.
- **Refactoring without symptoms.** A bored refactor produces a different shape, not a better
  one. Refactor when a real change is hard, and refactor _toward_ that change.
- **Building abstractions for hypothetical futures.** Every "we might want X someday" line in
  your code is rent you'll pay forever. Build for the present; design for change.
- **Copy-pasting from the internet without reading.** The worst learning path. If you copy,
  type it out by hand and add a comment explaining each line in your own words.
- **Skipping tests for "obvious" code.** Golden tests for the compiler and parser are not
  optional; they are the curriculum. Skipping them is skipping class.
- **Treating libraries as magic.** When you depend on one, open its source the same day. You
  don't have to read all of it, but you should know _where the interesting parts live_.
- **Ignoring errors.** Every `try { ... } catch {}` is a future debugging session you've already
  paid for. At minimum, log.

### 6.4 Concepts to rebuild yourself (the list)

- A render loop with dirty-region redraw.
- A VT/ANSI parser, from Williams's state diagram.
- A monospace text grid with cursor, scrollback, and reflow.
- A keymap FSM with modes, tries, and timeouts.
- A shell tokenizer + recursive-descent parser.
- A line editor with history and reverse search.
- A typed AST with `zod`, plus migrations.
- A lowering pass to an IR; an emitter from the IR.
- A golden-test runner (the whole thing is ~80 lines).
- A diagnostic type and a pretty printer (à la `rustc`).
- A signed-cookie session system, by hand.
- An OAuth code+PKCE flow, by hand.
- A migrations runner, by hand.

This list is not exhaustive — it's the spine. Each item is small enough to do, and big enough
to matter.

### 6.5 Libraries you should avoid initially (and what they would teach you to skip)

| Library                       | What it does for you      | What you'd skip learning by using it now                         |
| ----------------------------- | ------------------------- | ---------------------------------------------------------------- |
| `xterm.js`                    | Full terminal emulator    | Render loops, ANSI parsing, scrollback, line wrap, glyph caching |
| `node-pty` _(early)_          | PTYs in Node              | What a TTY is (use _after_ understanding)                        |
| `next.js`                     | Framework on top of React | Where rendering, routing, and data fetching actually live        |
| `redux` / `zustand` _(early)_ | Global state              | What a controlled-component data flow really looks like          |
| `prisma` / `drizzle`          | SQL + types               | SQL itself, indexes, transactions, query plans                   |
| `apollo` / `urql`             | GraphQL client            | HTTP, REST, cache semantics                                      |
| `nearley` / `peg.js`          | Parser generators         | How to _write_ a recursive-descent parser                        |
| any OAuth library             | Identity flows            | RFC 6749/7636 — the easiest RFCs to read                         |
| `socket.io`                   | Sugar over WebSockets     | The framing/lifecycle of plain WS                                |
| any ANSI parsing npm          | ANSI handling             | Williams's state diagram                                         |
| any "kbd-shortcut" lib        | Keyboard handling         | FSMs, tries, layout-independent keys                             |
| `docker` _(early)_            | Reproducible local env    | What runs on your machine and how                                |

The principle is _not_ "libraries are bad." It is "use a library when you have already
understood, or chosen not to understand, what it does." That ordering preserves your education.

### 6.6 When to introduce abstractions (a checklist)

Before extracting anything (a hook, a service, an interface, a queue, an event bus), confirm:

- [ ] There are **three** real callers, not one or two.
- [ ] The current pain is **named** in your notes with dates.
- [ ] Removing the duplication would have prevented a real bug or sped up a real change.
- [ ] You can explain the abstraction's contract in one paragraph.
- [ ] You've considered "do nothing" and "duplicate" and rejected them on evidence.

If you can check all five, extract. If not, wait.

### 6.7 How to read source code effectively

A specific recipe, because this is the most underrated engineering skill:

1. **Have a question.** "How does xterm.js scroll?" beats "let me read xterm.js." Reading
   without a question is sightseeing.
2. **Find the entry point.** `package.json` → `main`, or the README, or `src/index.*`.
3. **Follow one type/name.** Pick a noun in your question (e.g., `Buffer`, `Renderer`) and grep
   for its definition. Read just that file.
4. **Skim, don't read.** First pass: read function _signatures_ and top-of-file comments.
   Second pass: read the function bodies that look closest to your question.
5. **Read tests.** Tests are the _spec_. Often clearer than the implementation.
6. **Run it in a debugger.** Set a breakpoint at your question's most-likely site, trigger the
   behavior, watch the stack.
7. **Write a five-line summary in your notes.** "In xterm.js, scrolling is the `Buffer`
   advancing its viewport pointer; the renderer reads `viewport.start..end` each frame."
8. **Implement a 50-line version.** Reading without implementing is a hobby.

Apply this recipe to: `xterm.js`, `node-pty`, `bash` (lex/parse), `nvim` (event loop),
`alacritty/vte` (parser), `swc` (visitor), `sqlite` (skim the _architecture_ page).

---

## 7. Architecture evolution — earned, not pursued

Architecture is an _artifact of growth_, not a starting position. Here's a plausible decade-long
shape, with each step _triggered by need_, not by trend. None of these should be implemented
preemptively.

```
Year 0:  React + Vite SPA · localStorage · Canvas renderer · Fake shell · Compiler in TS · Golden tests.
            │ triggers: "I want to save my setup across browsers"
Year 1:  + tiny Node/Go API + SQLite + own-OAuth + sessions.
            │ triggers: "I want to use real vim/htop in the browser"
Year ~1: + node-pty/creack-pty backend (local first; bind 127.0.0.1).
            │ triggers: "drawing 200 frames/sec strains the CPU at large font sizes"
Year ~2: + WebGL glyph atlas for the renderer (your Canvas version still works as fallback).
            │ triggers: "Canvas + my parser is missing edge cases real terminals have"
Year ~2: optionally swap to xterm.js for the *display surface*, keeping your renderer code
         around as a project you can defend at any interview.
            │ triggers: "my dotfiles repo is on GitHub and I want bidirectional sync"
Year ~2: + GitHub sync (push compiled outputs, pull AST on signed-in devices).
            │ triggers: "I want to share my setup with friends and have them fork it"
Year ~3: + public setup pages (server-rendered with cached snapshot images).
         At this point Next.js *might* be justified for the public surface — and only the
         public surface. The studio stays SPA.
            │ triggers: a real third party asks to write a transform
Year ~3+: extract a plugin SDK (still just TS modules with a typed API, no sandbox).
         A sandbox arrives only when you accept code from people you don't know.
            │ triggers: a long compile blocks an HTTP request
Year ~4: + a single job queue (Redis Streams or a SQLite queue table). One queue. One worker.
            │ triggers: multi-user editing of the same setup
Year ~4+: + WebSockets for presence; CRDT only when last-write-wins observably breaks UX.
            │ triggers: the API + queue + sync now logically belong to a different team/owner
Year ~5: split a second service. Not before. Even then, only one.
```

Notice: there is no Kubernetes here. There is no edge compute. There is no microservices. There
is no marketplace. None of those are _bad_; all of them are _premature_. The architecture
arrives where it needs to be, by being pushed there by real users and real measurements.

---

## 8. Daily practice — turning this into an education

A few habits that make the project compound:

- **Keep `docs/notes/`.** Per topic (e.g., `ansi-parser.md`, `tty-vs-pty.md`,
  `oauth-pkce.md`). Each note is a few paragraphs you'd be willing to teach from. Add to them
  as you learn; they become _your_ textbook.
- **Write ADRs in `docs/ADRs/`** for any decision you'd be uncomfortable reversing without
  thought. One file each, dated, with: context, options, decision, consequences. Five paragraphs
  is plenty.
- **Commit messages are micro-essays.** "Why," not "what." The diff already says what.
- **Pause before every dependency.** A line in `notes/dependencies.md`: "I added `zod` because
  I needed runtime schema validation for the AST. I considered hand-writing it but the API
  surface is small enough to be a fair trade." Tiny essays beat package bloat.
- **One thing at a time.** Phase order is the curriculum; don't peek at Phase 4 while building
  Phase 1. The temptation to "wire everything end-to-end" is the temptation to skim every layer.
- **Re-implement small things on purpose.** Once a quarter, throw away one of your modules and
  rebuild it in a weekend with what you now know. You will be shocked how much better it
  becomes. This is the single highest-leverage learning habit in software.

---

## 9. Repository shape — small and obvious

```
termi/
├─ apps/
│  └─ web/                   # the Vite + React app
│     ├─ src/
│     │  ├─ renderer/        # Phase 1
│     │  ├─ input/           # Phase 2
│     │  ├─ shell/           # Phase 3 (fake shell)
│     │  ├─ studio/          # UI for editing the AST
│     │  ├─ persistence/     # localStorage / IndexedDB
│     │  └─ main.tsx
│     └─ index.html
├─ packages/
│  └─ compiler/              # Phase 4 — the heart
│     ├─ src/
│     └─ test/
├─ services/
│  └─ api/                   # Phase 5/6 — one binary
│     ├─ migrations/
│     └─ src/
├─ docs/
│  ├─ PLANNING_AND_ARCHITECTURE.md   ← this file
│  ├─ ADRs/
│  └─ notes/
├─ package.json
└─ README.md
```

That's it. No `infra/`. No `k8s/`. No `terraform/`. No `helm/`. No `.github/workflows/` until
you need CI (and when you do, one workflow: lint + test).

---

## 10. The standard you're holding yourself to

When you're done with any phase, you should be able to do all of this without notes:

- Open a terminal and run the project.
- Open the relevant module and walk a stranger through the data flow.
- Reproduce one bug you found, explain it, and show the fix in the diff.
- Name one library that "would have done this for you" and explain what you would have not
  learned by using it.
- Point at one place in the code where you _resisted_ a premature abstraction, and explain how
  you'd add it later if needed.

If those five things are true, you didn't just write the phase — you _learned_ it. That is the
only metric this document cares about.

---

## 11. Closing word

This is not a startup plan. It is a syllabus written in code. The end state is not a $X million
company; it is _you_, sitting in front of any unfamiliar codebase, feeling oriented within a
day, because you've built a tiny version of every layer at least once.

Most of the engineers you admire didn't get there from courses. They got there from picking one
ambitious project and refusing to let any part of it stay magic. Terminal can be that project.

Pick up Phase 1. Open an empty file called `renderer/index.ts`. Draw a single cell on a canvas.
Tomorrow, draw the second one. The rest is just doing that, on purpose, for years.

— _End of v1.0._
