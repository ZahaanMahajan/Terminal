/**
 * input/resolver.ts — Phase 2, step 2: the mode-aware FSM that turns keys into actions.
 *
 * State = (current mode, pending key buffer, current trie node, staged action). On each key it
 * walks the active mode's trie one step from the current node and resolves one of:
 *
 *   FIRE     buffer reaches a node with an action and NO children → run it, reset.
 *   AWAIT    buffer reaches a node that is a prefix of longer bindings:
 *              · pure prefix (no action here)        → wait for more keys
 *              · prefix *and* a binding (ambiguous)  → stage the action, wait; fire on timeout
 *   UNBOUND  the very first key matches nothing → not bound; hand back to the host (e.g. insert).
 *   DISCARD  a multi-key sequence dead-ends → drop the buffer; if an action was staged, fire it
 *            first, then re-process the dead-ending key from a fresh buffer.
 *
 * Timeouts are *injected*, not owned: `feed()` is pure and synchronous; the host arms a timer
 * whenever `pending` is non-empty and calls `flushTimeout()` when it elapses. This keeps the
 * resolver deterministic and unit-testable (drive feed/flushTimeout by hand, no fake clocks).
 *
 * `FeedResult` is additive (arrays) so the rare compound case — a staged action firing *and*
 * the dead-ending key resolving — is expressible in one return value.
 */

import type { Key } from './key';
import { keyToken } from './key';
import type { ActionId, Mode, TrieNode } from './keymap';
import type { Keymap } from './keymap';

export type FeedResult = {
  /** Actions that fired due to this key (usually 0 or 1; up to 2 in the staged-then-deadend case). */
  actions: ActionId[];
  /** Keys not part of any binding — the host decides what to do (type them, beep, …). */
  unbound: Key[];
  /** The pending buffer after processing (empty when nothing is mid-sequence). */
  pending: Key[];
  /** True when an action is staged behind a timeout (host should arm/refresh its timer). */
  awaitingTimeout: boolean;
  /** The action that will fire if the timeout elapses now (null for a pure prefix). */
  stagedAction: ActionId | null;
};

export class KeyResolver {
  private readonly keymap: Keymap;
  private mode: Mode;
  readonly timeoutMs: number;

  private buffer: Key[] = [];
  private node: TrieNode | null = null;
  private staged: ActionId | null = null;

  constructor(keymap: Keymap, mode: Mode, timeoutMs: number = 600) {
    this.keymap = keymap;
    this.mode = mode;
    this.timeoutMs = timeoutMs;
  }

  get currentMode(): Mode {
    return this.mode;
  }

  /** Snapshot of the in-progress sequence (for a "pending" display). */
  get pending(): Key[] {
    return this.buffer.slice();
  }

  /** Switch modes; abandons any in-progress sequence. */
  setMode(mode: Mode): void {
    this.mode = mode;
    this.resetState();
  }

  /** Abandon any in-progress sequence. */
  reset(): void {
    this.resetState();
  }

  private resetState(): void {
    this.buffer = [];
    this.node = null;
    this.staged = null;
  }

  feed(key: Key): FeedResult {
    const result: FeedResult = {
      actions: [],
      unbound: [],
      pending: [],
      awaitingTimeout: false,
      stagedAction: null,
    };
    this.feedInto(key, result);
    result.pending = this.buffer.slice();
    result.awaitingTimeout = this.staged !== null;
    result.stagedAction = this.staged;
    return result;
  }

  private feedInto(key: Key, result: FeedResult): void {
    const cur =
      this.buffer.length === 0 ? this.keymap.root(this.mode) : this.node ?? this.keymap.root(this.mode);
    const token = keyToken(key);
    const next = cur.children.get(token);

    if (next) {
      this.buffer.push(key);
      this.node = next;
      const hasChildren = next.children.size > 0;
      if (next.action !== null && !hasChildren) {
        result.actions.push(next.action);
        this.resetState(); // unambiguous complete match
      } else if (next.action !== null && hasChildren) {
        this.staged = next.action; // ambiguous: complete, but also a prefix → await
      } else {
        this.staged = null; // pure prefix
      }
      return;
    }

    // Dead-end on this key.
    if (this.buffer.length === 0) {
      result.unbound.push(key); // first key, unbound entirely
      return;
    }
    const staged = this.staged;
    this.resetState();
    if (staged !== null) result.actions.push(staged); // fire the staged shorter binding
    this.feedInto(key, result); // re-process the dead-ending key from a fresh buffer
  }

  /** Host calls this when the pending timer elapses. Fires a staged action (if any), resets. */
  flushTimeout(): ActionId[] {
    const staged = this.staged;
    this.resetState();
    return staged !== null ? [staged] : [];
  }
}
