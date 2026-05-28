/**
 * compiler/ — Phase 4: the Config Compiler (the heart).
 *
 *   ast.ts          — the Config AST, defined once with zod (runtime validator + static type)
 *   diagnostics.ts  — the Diagnostic shape (path + message) the whole compiler speaks
 *   migrations.ts   — forward schema migrations (versioned schema, upgrade on read)
 *   validate.ts     — parseSetup: migrate + validate raw input → typed Setup | diagnostics
 *
 * Coming: per-target IRs + lowering (AST → IR), emitters (IR → dotfiles) with golden tests,
 * semantic validation, modules, and the studio demo.
 */

export * from './ast';
export * from './diagnostics';
export * from './migrations';
export * from './validate';
export * from './ir';
export * from './lower';
export * from './emit';
export * from './semantic';
export * from './modules';
export * from './compile';
