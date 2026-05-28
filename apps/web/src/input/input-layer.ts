/**
 * input/input-layer.ts — DOM keyboard capture, scoped to a focused element.
 *
 * The InputLayer is the only place that touches the DOM keyboard API. It:
 *   - listens on a specific element (not `window`), so it only fires when that element is
 *     focused — no global hijacking;
 *   - drops standalone modifier presses (Shift/Ctrl/Alt/Meta alone);
 *   - converts each event to a `Key` and hands it to `onKey`;
 *   - calls `preventDefault()` only when `onKey` reports the key was handled AND the key isn't
 *     a browser-reserved combo (Cmd+anything, Ctrl+W/T/N/Q/R/L). The doc is emphatic: never
 *     trap the user's tab-close / new-tab / reload. We log such keys but let the browser act.
 *
 * Everything stateful about *interpreting* sequences (the FSM, the keymap, the trie) lives one
 * layer up (step 2). This layer is deliberately dumb: events in, Keys out.
 */

import type { Key } from './key';
import { keyFromEvent, isModifierCode } from './key';

export type KeyHandler = (key: Key, e: KeyboardEvent) => boolean | void;

export type InputLayerOptions = {
  /** Called for each non-modifier keydown. Return `true` to mark handled (→ preventDefault). */
  onKey: KeyHandler;
  /** Optional keyup hook (e.g. to un-highlight an on-screen key). */
  onKeyUp?: (key: Key, e: KeyboardEvent) => void;
  /** preventDefault handled keys? Default true (browser-reserved combos are always exempt). */
  preventDefaultWhenHandled?: boolean;
};

/** Browser-reserved combos we must never `preventDefault` (would trap the user). */
export function isBrowserReserved(key: Key): boolean {
  if (key.mods.meta) return true; // Cmd+… on macOS is almost always the OS/browser's
  if (key.mods.ctrl && ['w', 't', 'n', 'q', 'r', 'l'].includes(key.key)) return true;
  return false;
}

export class InputLayer {
  private el: HTMLElement | null = null;
  private readonly opts: InputLayerOptions;

  constructor(opts: InputLayerOptions) {
    this.opts = opts;
  }

  attach(el: HTMLElement): void {
    this.detach();
    this.el = el;
    el.addEventListener('keydown', this.handleKeyDown);
    el.addEventListener('keyup', this.handleKeyUp);
  }

  detach(): void {
    if (!this.el) return;
    this.el.removeEventListener('keydown', this.handleKeyDown);
    this.el.removeEventListener('keyup', this.handleKeyUp);
    this.el = null;
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (isModifierCode(e.code)) return;
    const key = keyFromEvent(e);
    const handled = this.opts.onKey(key, e) === true;
    if (
      handled &&
      (this.opts.preventDefaultWhenHandled ?? true) &&
      !isBrowserReserved(key)
    ) {
      e.preventDefault();
    }
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    if (isModifierCode(e.code)) return;
    this.opts.onKeyUp?.(keyFromEvent(e), e);
  };
}
