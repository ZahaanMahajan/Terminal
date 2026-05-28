/**
 * input/key.ts — Phase 2, step 1: the keyboard abstraction layer.
 *
 * Three layers, separated on purpose (the lesson of this step):
 *
 *   1. PHYSICAL   `KeyboardEvent.code` — the key's position on the board ("KeyH" is the H
 *                 position regardless of QWERTY/Dvorak/Colemak). Layout-independent.
 *   2. LOGICAL    our normalized `Key` token: a friendly physical-key name + modifier flags.
 *   3. ACTION     (step 2) what a *sequence* of Keys is bound to — a named action, not a callback.
 *
 * Why `code`, not `key`:
 *   `event.key` is layout-dependent — on a Dvorak board the H position reports "d". A vim user
 *   who put `j`/`k` on the home row by muscle memory wants the *position*, not the letter the OS
 *   thinks it is. Binding on `code` is correct across layouts. The trade-off: punctuation glyphs
 *   on non-US keycaps won't match their labels (documented below).
 *
 * Notation (for authoring keymaps, vim-like):
 *   - bare letters/digits      `j`, `5`        → that physical key (uppercase ⇒ shift: `G` = S-g)
 *   - bare punctuation         `;`, `.`, `/`   → the *unshifted* physical key at that position
 *   - angle-bracket specials   `<C-w>`, `<Esc>`, `<leader>`, `<Space>`, `<S-Tab>`, `<F1>`
 *   - sequences just concatenate: `ciw` = c,i,w ; `dd` = d,d ; spaces are separators (`C-b c`)
 *
 * Known gap (intentional for step 1): shifted *punctuation* like `:` (= Shift+`;`) isn't
 * expressible as a bare token — write `<S-;>`. Every vim motion in the phase's exit criteria
 * (hjkl/w/b/e/gg/G/dw/ciw) is letters, so this gap doesn't block us.
 */

export type Mods = {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
};

export type Key = {
  /** Normalized physical-key name: 'a'..'z', '0'..'9', ';', '/', 'esc', 'space', 'up', 'f1', … */
  key: string;
  mods: Mods;
};

const NO_MODS: Mods = { ctrl: false, alt: false, shift: false, meta: false };

function mods(partial: Partial<Mods> = {}): Mods {
  return { ...NO_MODS, ...partial };
}

/** Map a `KeyboardEvent.code` to a friendly, layout-independent token name. */
export function normalizeCode(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase(); // KeyH → h
  if (/^Digit[0-9]$/.test(code)) return code.slice(5); // Digit1 → 1
  if (/^Numpad[0-9]$/.test(code)) return code.slice(6); // Numpad1 → 1
  if (/^F\d{1,2}$/.test(code)) return code.toLowerCase(); // F1 → f1
  switch (code) {
    case 'Space': return 'space';
    case 'Enter':
    case 'NumpadEnter': return 'enter';
    case 'Escape': return 'esc';
    case 'Tab': return 'tab';
    case 'Backspace': return 'bspace';
    case 'Delete': return 'del';
    case 'ArrowUp': return 'up';
    case 'ArrowDown': return 'down';
    case 'ArrowLeft': return 'left';
    case 'ArrowRight': return 'right';
    case 'Home': return 'home';
    case 'End': return 'end';
    case 'PageUp': return 'pageup';
    case 'PageDown': return 'pagedown';
    case 'Minus': return '-';
    case 'Equal': return '=';
    case 'BracketLeft': return '[';
    case 'BracketRight': return ']';
    case 'Backslash': return '\\';
    case 'Semicolon': return ';';
    case 'Quote': return "'";
    case 'Comma': return ',';
    case 'Period': return '.';
    case 'Slash': return '/';
    case 'Backquote': return '`';
    default: return code; // unknown: fall back to the raw code
  }
}

/** True for the standalone modifier keys (ShiftLeft, ControlRight, …) we don't dispatch alone. */
export function isModifierCode(code: string): boolean {
  return /^(Shift|Control|Alt|Meta)(Left|Right)$/.test(code);
}

/** Build a Key from a DOM KeyboardEvent (physical position + modifier flags). */
export function keyFromEvent(e: KeyboardEvent): Key {
  return {
    key: normalizeCode(e.code),
    mods: {
      ctrl: e.ctrlKey,
      alt: e.altKey,
      shift: e.shiftKey,
      meta: e.metaKey,
    },
  };
}

export function keyEquals(a: Key, b: Key): boolean {
  return (
    a.key === b.key &&
    a.mods.ctrl === b.mods.ctrl &&
    a.mods.alt === b.mods.alt &&
    a.mods.shift === b.mods.shift &&
    a.mods.meta === b.mods.meta
  );
}

/**
 * The inner token form (no angle brackets). Modifier order is fixed C-A-S-M for canonicity.
 * Shift on a letter folds into the letter's case (`G`); shift on anything else uses the `S-`
 * prefix (`S-;`, `S-1`, `S-tab`).
 */
export function keyToken(key: Key): string {
  const isLetter = /^[a-z]$/.test(key.key);
  const parts: string[] = [];
  if (key.mods.ctrl) parts.push('C');
  if (key.mods.alt) parts.push('A');
  if (key.mods.shift && !isLetter) parts.push('S');
  if (key.mods.meta) parts.push('M');
  const base = key.mods.shift && isLetter ? key.key.toUpperCase() : key.key;
  return parts.length ? `${parts.join('-')}-${base}` : base;
}

/** Can this key be written without `<...>` in a sequence (a single bare char)? */
function isBareable(key: Key): boolean {
  if (key.key.length !== 1) return false; // named keys always wrap
  if (key.mods.ctrl || key.mods.alt || key.mods.meta) return false;
  if (key.mods.shift && !/^[a-z]$/.test(key.key)) return false; // shifted non-letter wraps
  return true;
}

/** Sequence-safe string: bare for simple keys, `<...>`-wrapped otherwise. */
export function keyToString(key: Key): string {
  const token = keyToken(key);
  return isBareable(key) ? token : `<${token}>`;
}

/** Join a sequence into a string that `parseKeys` round-trips back. */
export function keysToString(keys: Key[]): string {
  return keys.map(keyToString).join('');
}

const NAMED_ALIASES: Record<string, string> = {
  esc: 'esc', escape: 'esc',
  cr: 'enter', enter: 'enter', return: 'enter',
  space: 'space', spc: 'space',
  tab: 'tab',
  bs: 'bspace', backspace: 'bspace',
  del: 'del', delete: 'del',
  up: 'up', down: 'down', left: 'left', right: 'right',
  home: 'home', end: 'end', pageup: 'pageup', pagedown: 'pagedown',
  leader: 'leader',
};

function normalizeNamedAlias(name: string): string {
  const lower = name.toLowerCase();
  if (lower in NAMED_ALIASES) return NAMED_ALIASES[lower];
  if (/^f\d{1,2}$/.test(lower)) return lower; // f1..f12
  return name;
}

/**
 * Parse a single inner token (no angle brackets): `g`, `G`, `C-w`, `C-S-1`, `Esc`, `leader`.
 * Modifier prefixes may appear in any order; a single trailing uppercase letter implies shift.
 */
export function parseKey(token: string): Key {
  const m = mods();
  let rest = token;
  while (rest.length >= 2 && rest[1] === '-' && 'CASM'.includes(rest[0])) {
    const flag = rest[0];
    if (flag === 'C') m.ctrl = true;
    else if (flag === 'A') m.alt = true;
    else if (flag === 'S') m.shift = true;
    else if (flag === 'M') m.meta = true;
    rest = rest.slice(2);
  }
  if (rest.length === 0) throw new Error(`parseKey: empty base in "${token}"`);
  if (/^[A-Z]$/.test(rest)) {
    m.shift = true;
    rest = rest.toLowerCase();
  } else {
    rest = normalizeNamedAlias(rest);
  }
  return { key: rest, mods: m };
}

/**
 * Parse a key *sequence* in vim-like notation. Bare chars are individual keys; `<...>` wraps a
 * special token; spaces separate (and are otherwise ignored).
 */
export function parseKeys(notation: string): Key[] {
  const keys: Key[] = [];
  let i = 0;
  while (i < notation.length) {
    const ch = notation[i];
    if (ch === '<') {
      const end = notation.indexOf('>', i);
      if (end === -1) throw new Error(`parseKeys: unclosed '<' in "${notation}"`);
      keys.push(parseKey(notation.slice(i + 1, end)));
      i = end + 1;
    } else if (ch === ' ') {
      i++; // separator
    } else if (/[A-Z]/.test(ch)) {
      keys.push({ key: ch.toLowerCase(), mods: mods({ shift: true }) });
      i++;
    } else {
      keys.push({ key: ch, mods: mods() });
      i++;
    }
  }
  return keys;
}
