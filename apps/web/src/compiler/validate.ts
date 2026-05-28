/**
 * compiler/validate.ts — Phase 4, step 1: parse raw input into a typed Setup.
 *
 * `parseSetup` is the gate into the compiler: migrate the raw document to the current schema,
 * then zod-validate it. On success you get a fully-defaulted, typed `Setup`; on failure you get
 * `Diagnostic`s with paths (translated from zod's issues) rather than a thrown error — the
 * studio renders those next to the offending fields.
 *
 * (Semantic checks beyond shape — duplicate aliases, invalid identifiers, unknown plugins —
 * arrive in a later step as additional diagnostics over a successfully-parsed Setup.)
 */

import { SetupSchema, type Setup } from './ast';
import type { Diagnostic } from './diagnostics';
import { migrate } from './migrations';

export type ParseResult =
  | { ok: true; setup: Setup }
  | { ok: false; diagnostics: Diagnostic[] };

export function parseSetup(raw: unknown): ParseResult {
  const result = SetupSchema.safeParse(migrate(raw));
  if (result.success) return { ok: true, setup: result.data };
  const diagnostics: Diagnostic[] = result.error.issues.map((issue) => ({
    level: 'error',
    path: issue.path.length ? issue.path.join('.') : '(root)',
    message: issue.message,
  }));
  return { ok: false, diagnostics };
}
