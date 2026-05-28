/**
 * input/conflicts.ts — Phase 2, step 3: static keymap conflict detection.
 *
 * The conflict that matters in a sequence-based keymap is the **prefix conflict**: one binding's
 * key sequence is a strict prefix of another's, in the same mode. When that happens, the shorter
 * (prefix) binding can't fire the instant it's typed — the resolver must wait `timeoutMs` to see
 * whether the longer sequence is coming. So the *prefix* binding pays a latency tax; the longer
 * one fires immediately on completion.
 *
 * Classic example: bind `g` → something AND `gg` → something else. Now every lone `g` is delayed.
 * Vim avoids this by leaving `g` unbound (a pure prefix). Detecting these statically is the whole
 * pedagogical point of this step — you find the latency traps before your fingers do.
 *
 * Pure function over `Keymap.bindings(mode)` — no trie internals, no DOM, trivially testable.
 * (Duplicate-sequence conflicts can't exist post-hoc: the trie overwrites on rebind. Catching
 * those would require hooking `bind()`; out of scope here.)
 */

import type { Binding, Keymap, Mode } from './keymap';
import { tokensToNotation } from './keymap';

export type Conflict = {
  mode: Mode;
  /** The binding whose sequence is a strict prefix of the others — it incurs the timeout. */
  prefix: Binding;
  /** The longer bindings that extend the prefix (each resolves only after the prefix times out). */
  shadowed: Binding[];
};

/** True if `short` is a strict (shorter, element-wise-equal) prefix of `long`. */
export function isStrictTokenPrefix(short: string[], long: string[]): boolean {
  if (short.length >= long.length) return false;
  for (let i = 0; i < short.length; i++) {
    if (short[i] !== long[i]) return false;
  }
  return true;
}

/** Find every prefix conflict within one mode. */
export function findConflicts(keymap: Keymap, mode: Mode): Conflict[] {
  const bindings = keymap.bindings(mode);
  const conflicts: Conflict[] = [];
  for (const candidate of bindings) {
    const shadowed = bindings.filter((b) => isStrictTokenPrefix(candidate.tokens, b.tokens));
    if (shadowed.length > 0) {
      conflicts.push({ mode, prefix: candidate, shadowed });
    }
  }
  return conflicts;
}

/** Find prefix conflicts across every mode in the keymap. */
export function findAllConflicts(keymap: Keymap): Conflict[] {
  return keymap.modes().flatMap((mode) => findConflicts(keymap, mode));
}

/** Human-readable explanation of a conflict, optionally naming the latency cost. */
export function describeConflict(conflict: Conflict, timeoutMs?: number): string {
  const prefix = tokensToNotation(conflict.prefix.tokens);
  const longer = conflict.shadowed.map((b) => tokensToNotation(b.tokens)).join(', ');
  const verb = conflict.shadowed.length === 1 ? 'extends' : 'extend';
  const cost = timeoutMs !== undefined ? ` (~${timeoutMs}ms)` : '';
  return `"${prefix}" resolves only after a timeout${cost} because ${longer} ${verb} it`;
}
