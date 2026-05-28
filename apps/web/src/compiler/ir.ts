/**
 * compiler/ir.ts — Phase 4, step 2: the intermediate representations.
 *
 * An IR sits between the AST (intent) and the emitted text (a target's syntax). Why bother for
 * something this small? Because it's where *ordering* and *normalization* live: a `.zshrc` must
 * put env exports before plugins before the prompt init, and the IR is an explicit ordered list
 * of statements that captures that — the emitter then becomes a dumb statement→line printer.
 * This is the AST → IR → backend shape every real compiler uses (LLVM, Babel, swc).
 *
 * `ShellIR` serves both zsh and bash — they share statement kinds; only a few render
 * differently (`setopt` vs `shopt -s`, the plugin path extension, the prompt-init shell name),
 * which the emitter branches on `ir.shell` to handle. Two near-identical backends would be
 * duplication, not clarity. `StarshipIR` is its own thing (TOML, not shell statements).
 */

import type { ShellKind } from './ast';

export type ShellStmt =
  | { kind: 'comment'; text: string }
  | { kind: 'blank' }
  | { kind: 'export'; name: string; value: string }
  | { kind: 'alias'; name: string; value: string }
  | { kind: 'option'; name: string }
  | { kind: 'plugin'; id: string }
  | { kind: 'initPrompt'; engine: 'starship' };

export type ShellIR = {
  shell: ShellKind;
  statements: ShellStmt[];
};

export type StarshipSetting = { key: string; value: string | boolean };

export type StarshipIR = {
  /** Top-level `key = value` settings. */
  settings: StarshipSetting[];
  /** The assembled `format = "..."` string, e.g. `$directory$git_branch$character`. */
  format: string;
};
