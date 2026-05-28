/**
 * shell/ — Phase 3: Fake Shell.
 *
 *   tokenizer.ts  — hand-written lexer: input → word/op tokens (quote- and escape-aware)
 *   parser.ts     — recursive-descent parser: tokens → Script AST
 *   filesystem.ts — in-memory POSIX-ish tree
 *   env.ts        — variables + cwd + last exit code
 *   expand.ts     — $VAR / ${VAR} / $? / ~ expansion (honours literal vs expandable)
 *   builtins.ts   — the command set (cd/ls/cat/echo/… + true/false/tr/grep/wc)
 *   executor.ts   — walk the AST: pipelines, redirects, &&/||, ; → run(input, env, fs)
 *
 * Coming: line editor + history + completion + prompt REPL wired to the Phase 1 terminal.
 */

export * from './tokenizer';
export * from './parser';
export * from './filesystem';
export * from './env';
export * from './expand';
export * from './builtins';
export * from './executor';
export * from './line-editor';
export * from './history';
export * from './completion';
export * from './prompt';
