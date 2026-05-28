/**
 * compiler/diagnostics.ts — the one diagnostic shape the whole compiler speaks.
 *
 * Schema errors (zod) and semantic checks (later) both produce `Diagnostic`s with a *path* into
 * the AST, so the studio can point at exactly the offending field — the way `rustc`/`tsc`
 * surface errors, not a bare boolean "invalid".
 */

export type DiagnosticLevel = 'error' | 'warning';

export type Diagnostic = {
  level: DiagnosticLevel;
  /** Dotted path into the AST, e.g. "shell.aliases.1.name", or "(root)". */
  path: string;
  message: string;
};

export function formatDiagnostic(d: Diagnostic): string {
  return `${d.level} at ${d.path}: ${d.message}`;
}
