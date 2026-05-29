/**
 * pty/key-to-bytes.ts — Phase 5, step 2: encode a keystroke into terminal input bytes.
 *
 * This is the *inverse* of the Phase 1 ANSI parser, and it closes the loop across the whole
 * stack: a physical keypress becomes a Phase 2 `Key`, this turns it into the byte sequence a
 * terminal program expects on stdin, the PTY delivers it, the program's response comes back as
 * ANSI which the Phase 1 parser renders. Key → bytes → PTY → bytes → Screen.
 *
 * The rules a terminal follows (xterm-ish, "normal" cursor mode):
 *   - printable char      → the character itself (the *logical* char, from `event.key`)
 *   - Ctrl-A … Ctrl-Z     → 0x01 … 0x1A  (and Ctrl-Space → NUL, Ctrl-[ → ESC, …)
 *   - Enter → CR (0x0D)   ·  Tab → 0x09  ·  Backspace → DEL (0x7F)  ·  Esc → 0x1B
 *   - arrows/Home/End/…   → CSI sequences (`\x1b[A`, `\x1b[H`, `\x1b[3~`, …)
 *   - F1–F12              → SS3 / CSI sequences
 *   - Alt+char            → ESC prefix (Meta), e.g. Alt-b → `\x1bb`
 *
 * `text` is the logical character (`event.key`) — needed for printables because the `Key` model
 * is *physical* (Shift+1 is `{key:'1', shift}` but should type `!`). Returns `null` for keys we
 * can't encode (e.g. a printable with no `text`).
 *
 * Documented simplification: modified CSI keys (Ctrl/Alt+Arrow) are sent as their base sequence,
 * not with xterm's `;` modifier parameters. The exit criteria (vim/htop/Ctrl-C/resize) don't
 * need them.
 */

import type { Key } from '../input';

const NAMED: Record<string, string> = {
  enter: '\r',
  tab: '\t',
  bspace: '\x7f', // DEL — what most terminals send for Backspace
  esc: '\x1b',
  up: '\x1b[A',
  down: '\x1b[B',
  right: '\x1b[C',
  left: '\x1b[D',
  home: '\x1b[H',
  end: '\x1b[F',
  del: '\x1b[3~',
  pageup: '\x1b[5~',
  pagedown: '\x1b[6~',
  f1: '\x1bOP',
  f2: '\x1bOQ',
  f3: '\x1bOR',
  f4: '\x1bOS',
  f5: '\x1b[15~',
  f6: '\x1b[17~',
  f7: '\x1b[18~',
  f8: '\x1b[19~',
  f9: '\x1b[20~',
  f10: '\x1b[21~',
  f11: '\x1b[23~',
  f12: '\x1b[24~',
};

export function keyToBytes(key: Key, text?: string): string | null {
  const k = key.key;
  const { ctrl, alt } = key.mods;

  // Control bytes: Ctrl-A…Z → 0x01…0x1A, plus the classic punctuation controls.
  if (ctrl && !alt) {
    if (/^[a-z]$/.test(k)) return String.fromCharCode(k.charCodeAt(0) - 96);
    if (k === 'space') return '\x00';
    if (k === '[') return '\x1b';
    if (k === '\\') return '\x1c';
    if (k === ']') return '\x1d';
    // other Ctrl combos fall through to named / printable handling
  }

  const named = NAMED[k];
  if (named !== undefined) return named;

  // Printable: send the logical character; Alt (Meta) prefixes with ESC.
  if (text && [...text].length === 1) {
    return alt ? '\x1b' + text : text;
  }

  return null;
}
