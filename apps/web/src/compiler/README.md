# `src/compiler/` — Phase 4: the Config Compiler (the heart)

> Per `docs/PLANNING_AND_ARCHITECTURE.md` §4 Phase 4 — "the intellectual core." The
> rubber-duck doc for the module.

## Where it lives

The doc's folder sketch shows `packages/compiler/`. It lives in `apps/web/src/compiler/` for now,
alongside the other framework-free modules (`renderer/`, `input/`, `shell/`) — there's a single
consumer (the studio UI), so a workspace split is premature infra (the doc's own "defer
abstraction" rule). It extracts to `packages/` cleanly when the CLI (a second consumer) arrives
in Phase 6.

## What this module is

Turns a typed, tool-agnostic **Config AST** into real, idiomatic dotfiles. The pipeline that the
remaining steps build:

```
raw JSON ──parseSetup──▶ Setup (typed) ──lower──▶ IR (per target) ──emit──▶ dotfile text ──▶ format
                │
                └─ migrate (upgrade old schema versions) + zod validate (→ diagnostics)
```

This AST → IR → backend shape is the pattern behind every real compiler (LLVM, Babel, swc). The
IR exists so source (intent) and target (zsh/bash/starship) decouple, ordering/dedup happen on a
normalized form, and emitters stay simple.

## Module layout

```
src/compiler/
├─ ast.ts            ← the Config AST, defined once with zod (validator + static type)
├─ diagnostics.ts    ← Diagnostic { level, path, message }
├─ migrations.ts     ← SCHEMA_VERSION + forward migrations + migrate()
├─ validate.ts       ← parseSetup: migrate + zod-validate → Setup | Diagnostic[]
├─ ir.ts             ← ShellIR / StarshipIR (ordered statements between AST and text)
├─ lower.ts          ← AST → IR (the ordering pass: env→options→plugins→aliases→prompt)
├─ emit.ts           ← IR → idiomatic dotfile text (deterministic; quoting rules)
├─ semantic.ts       ← validateSemantics: checks beyond shape → Diagnostic[]
├─ modules.ts        ← Module = (setup)=>setup transforms + registry + applyModules
├─ compile.ts        ← orchestrator: semantics + module expansion → artifacts + requires
├─ __fixtures__/     ← <name>.ast.json + expected <name>.zshrc / .bashrc / .starship.toml
├─ index.ts          ← re-exports
├─ *.test.ts         ← ast · migrations · emit · compile (golden) · semantic · modules
└─ README.md         ← you are here
```

## Current state — step 1 (done): AST + validation + migrations

- **`ast.ts`** — `SetupSchema` (zod) → `Setup` (`z.infer`). One declaration is both the runtime
  validator and the static type; they can't drift. "Start tiny": shell (zsh/bash) with
  aliases/env/plugins/options + an optional starship prompt (segment list). Three emitter targets.
- **`parseSetup(raw)`** — migrate, then `safeParse`. Success → fully-defaulted typed `Setup`
  (missing arrays default to `[]`). Failure → `Diagnostic[]` with **dotted paths** translated
  from zod issues (`shell.kind`, `prompt.segments.1`, `(root)`) — never a thrown error.
- **`migrations.ts`** — versioned schema (`SCHEMA_VERSION = 2`) + a forward migration chain.
  Concrete example: v1 stored `meta.os` as a string; `migrations[1]` wraps it into an array.
  `migrate` applies the chain until current, so an old published setup loads and upgrades cleanly.

## Step 2 (done): IR + lowering + emit + golden tests

The full `Setup → IR → text` pipeline for all three targets:

- **`ir.ts`** — `ShellIR` (an ordered `ShellStmt[]`: comment/blank/export/alias/option/plugin/
  initPrompt) and `StarshipIR`. The IR is where *ordering* is explicit so the emitter can be a
  dumb printer. One `ShellIR` serves zsh and bash; the few dialect differences (`setopt` vs
  `shopt -s`, plugin path/extension, prompt-init shell) live in the emitter's `ir.shell` branch.
- **`lower.ts`** — `lowerShell` walks the AST in dependency order (env → options → plugins →
  aliases → prompt init), with blank+comment section headers. `lowerPrompt` assembles the
  starship `format` string. Choosing the order is the lowering's job.
- **`emit.ts`** — pure + **deterministic** (same IR → same bytes). Quoting by intent: exports
  double-quoted (`$` preserved, `"`/`\` escaped) so they expand; aliases single-quoted
  (`'\''` trick) so they're verbatim.
- **`compile.ts`** — `compile(setup)` → artifacts (`.zshrc`/`.bashrc` + optional `starship.toml`);
  `compileRaw(raw)` parses first and surfaces diagnostics on failure.
- **Golden tests** — `__fixtures__/<name>.ast.json` compiled and matched byte-for-byte against
  expected `<name>.zshrc` / `.starship.toml` / `.bashrc`. Re-bless by overwriting the fixtures.

## Step 3 (done): semantic validation + modules

- **`semantic.ts`** — `validateSemantics(setup)` runs *over a parsed Setup* and returns
  `Diagnostic`s beyond shape: errors for empty/invalid env-var and alias names; warnings for
  duplicate alias/env/plugin, unknown plugins (`KNOWN_PLUGINS`), and a prompt with no
  `character` segment. Errors inform; they don't block compilation.
- **`modules.ts`** — a `Module` is a pure `(setup) => setup` transform that contributes config
  (aliases/plugins/segments) and may `require` binaries. Merge helpers are *idempotent* (skip
  what's present), so modules compose without dups. Registry: `git-aliases`, `fzf`, `eza`,
  `prompt-rust`. `applyModules` folds a setup's `modules: string[]`, accumulating `requires` and
  warning on unknown ids.
- **`compile.ts`** now: semantic-checks the user setup, expands modules, lowers/emits the
  expanded setup, and returns `{ artifacts, diagnostics, requires }`. The AST gained a
  `modules: string[]` field (additive default — existing fixtures unchanged).

57 compiler tests (≥ 50 criterion met), incl. the `with-modules` golden (byte-for-byte).

## Step 4 (done): the live studio

`demos/StudioDemo.tsx` is a visual config builder over `compileRaw`. Toggle the shell, aliases,
env, plugins, options, prompt segments, and modules; every change recompiles via `useMemo` and
shows the generated dotfiles, diagnostics (with paths), the binary `requires`, and the
compile-time readout (well under the 1ms / "< 50ms" budget). Add a made-up plugin to see a
warning; drop the `character` segment to see the prompt lint.

## Phase 4 complete — exit criteria

- ✅ Edit config → compile → output updates in < 50ms (sub-millisecond `useMemo` recompile).
- ✅ Three real targets compile to outputs that work if pasted into a real shell (zsh/bash/starship).
- ✅ 50+ golden tests (57 compiler tests; fixtures matched byte-for-byte).
- ✅ AST → validate → (modules) → lower → IR → emit → format — the whole pipeline, end to end.

## Deferred (intentional)

Three emitter targets only (more tools = more backends, same pattern); no AST-patch diffing /
Monaco; no plugin sandbox or marketplace (modules are trusted in-repo functions); no AI
generation. The compiler stays a pure library in `src/`; it extracts to `packages/` when the
Phase 6 CLI becomes a second consumer.

## Exit criteria for Phase 4

- Edit config → compile → output updates in < 50ms (in-browser).
- Three real targets compile to outputs that work if pasted into a real shell.
- 50+ golden tests.
- You can explain AST → validate → lower → IR → emit → format at a whiteboard.
