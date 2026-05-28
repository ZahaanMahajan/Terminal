/**
 * key.test.ts — the Key model: normalization, serialization, parsing, round-trips.
 */

import { describe, it, expect } from 'vitest';
import {
  isModifierCode,
  keyEquals,
  keyFromEvent,
  keysToString,
  keyToString,
  keyToken,
  normalizeCode,
  parseKey,
  parseKeys,
  type Key,
} from './key';

const k = (key: string, m: Partial<Key['mods']> = {}): Key => ({
  key,
  mods: { ctrl: false, alt: false, shift: false, meta: false, ...m },
});

describe('normalizeCode', () => {
  it('maps letter/digit codes to friendly names', () => {
    expect(normalizeCode('KeyH')).toBe('h');
    expect(normalizeCode('KeyZ')).toBe('z');
    expect(normalizeCode('Digit1')).toBe('1');
    expect(normalizeCode('Numpad5')).toBe('5');
  });

  it('maps named keys and function keys', () => {
    expect(normalizeCode('Space')).toBe('space');
    expect(normalizeCode('Escape')).toBe('esc');
    expect(normalizeCode('ArrowUp')).toBe('up');
    expect(normalizeCode('F1')).toBe('f1');
    expect(normalizeCode('Enter')).toBe('enter');
  });

  it('maps punctuation by physical position', () => {
    expect(normalizeCode('Semicolon')).toBe(';');
    expect(normalizeCode('Slash')).toBe('/');
    expect(normalizeCode('Minus')).toBe('-');
  });

  it('falls back to the raw code for unknowns', () => {
    expect(normalizeCode('MediaPlayPause')).toBe('MediaPlayPause');
  });
});

describe('isModifierCode', () => {
  it('detects standalone modifier keys', () => {
    expect(isModifierCode('ShiftLeft')).toBe(true);
    expect(isModifierCode('ControlRight')).toBe(true);
    expect(isModifierCode('MetaLeft')).toBe(true);
    expect(isModifierCode('KeyA')).toBe(false);
  });
});

describe('keyFromEvent', () => {
  it('uses physical code, independent of layout (event.key)', () => {
    // On a Dvorak board, pressing the physical H key reports event.key="d" but code="KeyH".
    const e = { code: 'KeyH', key: 'd', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false } as KeyboardEvent;
    expect(keyFromEvent(e)).toEqual(k('h'));
  });

  it('captures modifier flags', () => {
    const e = { code: 'KeyW', key: 'w', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false } as KeyboardEvent;
    expect(keyFromEvent(e)).toEqual(k('w', { ctrl: true }));
  });
});

describe('keyToken (canonical inner form)', () => {
  it('plain key', () => {
    expect(keyToken(k('g'))).toBe('g');
  });
  it('shift on a letter folds to uppercase', () => {
    expect(keyToken(k('g', { shift: true }))).toBe('G');
  });
  it('shift on a non-letter uses S- prefix', () => {
    expect(keyToken(k('1', { shift: true }))).toBe('S-1');
    expect(keyToken(k(';', { shift: true }))).toBe('S-;');
  });
  it('modifier order is C-A-S-M', () => {
    expect(keyToken(k('x', { ctrl: true }))).toBe('C-x');
    expect(keyToken(k('x', { ctrl: true, alt: true, meta: true }))).toBe('C-A-M-x');
    expect(keyToken(k('1', { ctrl: true, shift: true }))).toBe('C-S-1');
  });
});

describe('keyToString (sequence-safe)', () => {
  it('leaves bareable keys bare', () => {
    expect(keyToString(k('h'))).toBe('h');
    expect(keyToString(k('g', { shift: true }))).toBe('G');
    expect(keyToString(k('5'))).toBe('5');
  });
  it('wraps anything with modifiers or named keys', () => {
    expect(keyToString(k('w', { ctrl: true }))).toBe('<C-w>');
    expect(keyToString(k('esc'))).toBe('<esc>');
    expect(keyToString(k('1', { shift: true }))).toBe('<S-1>');
    expect(keyToString(k('leader'))).toBe('<leader>');
  });
});

describe('parseKey (inner token)', () => {
  it('plain and shifted letters', () => {
    expect(parseKey('g')).toEqual(k('g'));
    expect(parseKey('G')).toEqual(k('g', { shift: true }));
  });
  it('modifier prefixes in any order', () => {
    expect(parseKey('C-w')).toEqual(k('w', { ctrl: true }));
    expect(parseKey('C-S-1')).toEqual(k('1', { ctrl: true, shift: true }));
  });
  it('the Minus key as a base', () => {
    expect(parseKey('-')).toEqual(k('-'));
    expect(parseKey('C--')).toEqual(k('-', { ctrl: true }));
  });
  it('named-key aliases (case-insensitive)', () => {
    expect(parseKey('Esc')).toEqual(k('esc'));
    expect(parseKey('CR')).toEqual(k('enter'));
    expect(parseKey('Space')).toEqual(k('space'));
    expect(parseKey('leader')).toEqual(k('leader'));
  });
  it('throws on an empty base', () => {
    expect(() => parseKey('C-')).toThrow();
  });
});

describe('parseKeys (sequence)', () => {
  it('bare chars are individual keys (vim-style)', () => {
    expect(parseKeys('ciw')).toEqual([k('c'), k('i'), k('w')]);
    expect(parseKeys('dd')).toEqual([k('d'), k('d')]);
  });
  it('uppercase ⇒ shift', () => {
    expect(parseKeys('G')).toEqual([k('g', { shift: true })]);
    expect(parseKeys('dG')).toEqual([k('d'), k('g', { shift: true })]);
  });
  it('angle-bracket specials', () => {
    expect(parseKeys('<C-w>j')).toEqual([k('w', { ctrl: true }), k('j')]);
    expect(parseKeys('<leader>ff')).toEqual([k('leader'), k('f'), k('f')]);
    expect(parseKeys('<Esc>')).toEqual([k('esc')]);
  });
  it('spaces separate (tmux-style)', () => {
    expect(parseKeys('<C-b> c')).toEqual([k('b', { ctrl: true }), k('c')]);
  });
  it('throws on an unclosed angle bracket', () => {
    expect(() => parseKeys('<C-w')).toThrow();
  });
});

describe('round-trips', () => {
  it('keysToString → parseKeys is identity', () => {
    const samples = ['ciw', 'dd', 'G', 'dG'];
    for (const s of samples) {
      expect(keysToString(parseKeys(s))).toBe(s);
    }
  });
  it('parseKeys → keysToString → parseKeys is stable for specials', () => {
    const seqs = ['<C-w>j', '<leader>ff', '<Esc>', '<S-1>a'];
    for (const s of seqs) {
      const keys = parseKeys(s);
      expect(parseKeys(keysToString(keys))).toEqual(keys);
    }
  });
});

describe('keyEquals', () => {
  it('compares structurally', () => {
    expect(keyEquals(k('a'), k('a'))).toBe(true);
    expect(keyEquals(k('a', { ctrl: true }), k('a'))).toBe(false);
    expect(keyEquals(k('a'), k('b'))).toBe(false);
  });
});
