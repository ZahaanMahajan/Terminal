/**
 * input/keymap.ts — Phase 2, step 2: bindings as a trie of named actions.
 *
 * A `Keymap` maps key *sequences* (per mode) to **named action ids** — strings like
 * `"cursor.left"` or `"vim.deleteWord"`, never callbacks. Named actions are:
 *   - debuggable    (the resolver emits the id; the host logs it),
 *   - remappable    (rebind a sequence without touching the action's implementation),
 *   - analyzable    (the conflict detector in step 3 reasons over ids + sequences).
 *
 * Storage is a **trie** keyed by `keyToken(key)` (the canonical inner string). Each node may
 * hold an action (terminal) and/or children (longer sequences). Matching a buffer is then
 * O(sequence length): walk one child per key. A node with BOTH an action and children is a
 * *prefix binding* (e.g. `g` bound while `gg` is also bound) — the ambiguity the resolver
 * handles with a timeout and the conflict detector flags in step 3.
 */

import type { Key } from './key';
import { keyToString, keyToken, parseKey, parseKeys } from './key';

export type ActionId = string;
export type Mode = string;

export class TrieNode {
  action: ActionId | null = null;
  readonly children = new Map<string, TrieNode>();
}

export type Binding = {
  /** Canonical key tokens, e.g. ['d','d'] or ['C-w','h']. */
  tokens: string[];
  action: ActionId;
};

/** Shared empty root returned for modes that have no bindings (so the resolver never crashes). */
const EMPTY_ROOT = new TrieNode();

/** Render a token path back into authoring notation: ['d','d'] → "dd", ['C-w','h'] → "<C-w>h". */
export function tokensToNotation(tokens: string[]): string {
  return tokens.map((t) => keyToString(parseKey(t))).join('');
}

export class Keymap {
  private readonly roots = new Map<Mode, TrieNode>();

  /** Get-or-create the root for a mode. */
  private rootFor(mode: Mode): TrieNode {
    let r = this.roots.get(mode);
    if (!r) {
      r = new TrieNode();
      this.roots.set(mode, r);
    }
    return r;
  }

  /** Root for resolving. Returns a shared empty node if the mode has no bindings. */
  root(mode: Mode): TrieNode {
    return this.roots.get(mode) ?? EMPTY_ROOT;
  }

  /** All modes that have at least one binding. */
  modes(): Mode[] {
    return [...this.roots.keys()];
  }

  /** Bind a key sequence (string notation or Key[]) to a named action in a mode. Chainable. */
  bind(mode: Mode, sequence: string | Key[], action: ActionId): this {
    const keys = typeof sequence === 'string' ? parseKeys(sequence) : sequence;
    if (keys.length === 0) throw new Error('Keymap.bind: empty key sequence');
    let node = this.rootFor(mode);
    for (const key of keys) {
      const token = keyToken(key);
      let child = node.children.get(token);
      if (!child) {
        child = new TrieNode();
        node.children.set(token, child);
      }
      node = child;
    }
    node.action = action; // rebinding overwrites
    return this;
  }

  /** Every terminal binding in a mode, depth-first. */
  bindings(mode: Mode): Binding[] {
    const root = this.roots.get(mode);
    if (!root) return [];
    const out: Binding[] = [];
    const walk = (node: TrieNode, tokens: string[]): void => {
      if (node.action !== null) out.push({ tokens: tokens.slice(), action: node.action });
      for (const [token, child] of node.children) {
        tokens.push(token);
        walk(child, tokens);
        tokens.pop();
      }
    };
    walk(root, []);
    return out;
  }
}
