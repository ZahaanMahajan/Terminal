/**
 * key-to-bytes.test.ts — keystroke → terminal input bytes.
 */

import { describe, it, expect } from 'vitest';
import { keyToBytes } from './key-to-bytes';
import type { Key } from '../input';

const key = (k: string, mods: Partial<Key['mods']> = {}): Key => ({
  key: k,
  mods: { ctrl: false, alt: false, shift: false, meta: false, ...mods },
});

describe('keyToBytes — control bytes', () => {
  it('Ctrl-A … Ctrl-Z map to 0x01 … 0x1A', () => {
    expect(keyToBytes(key('a', { ctrl: true }))).toBe('\x01');
    expect(keyToBytes(key('c', { ctrl: true }))).toBe('\x03'); // SIGINT
    expect(keyToBytes(key('d', { ctrl: true }))).toBe('\x04'); // EOF
    expect(keyToBytes(key('z', { ctrl: true }))).toBe('\x1a');
  });
  it('Ctrl + punctuation controls', () => {
    expect(keyToBytes(key('space', { ctrl: true }))).toBe('\x00');
    expect(keyToBytes(key('[', { ctrl: true }))).toBe('\x1b');
    expect(keyToBytes(key('\\', { ctrl: true }))).toBe('\x1c');
    expect(keyToBytes(key(']', { ctrl: true }))).toBe('\x1d');
  });
  it('Shift does not change the control byte', () => {
    expect(keyToBytes(key('c', { ctrl: true, shift: true }))).toBe('\x03');
  });
});

describe('keyToBytes — named keys', () => {
  it('Enter / Tab / Backspace / Esc', () => {
    expect(keyToBytes(key('enter'))).toBe('\r');
    expect(keyToBytes(key('tab'))).toBe('\t');
    expect(keyToBytes(key('bspace'))).toBe('\x7f');
    expect(keyToBytes(key('esc'))).toBe('\x1b');
  });
  it('arrows', () => {
    expect(keyToBytes(key('up'))).toBe('\x1b[A');
    expect(keyToBytes(key('down'))).toBe('\x1b[B');
    expect(keyToBytes(key('right'))).toBe('\x1b[C');
    expect(keyToBytes(key('left'))).toBe('\x1b[D');
  });
  it('home / end / del / page', () => {
    expect(keyToBytes(key('home'))).toBe('\x1b[H');
    expect(keyToBytes(key('end'))).toBe('\x1b[F');
    expect(keyToBytes(key('del'))).toBe('\x1b[3~');
    expect(keyToBytes(key('pageup'))).toBe('\x1b[5~');
  });
  it('function keys (SS3 + CSI forms)', () => {
    expect(keyToBytes(key('f1'))).toBe('\x1bOP');
    expect(keyToBytes(key('f5'))).toBe('\x1b[15~');
    expect(keyToBytes(key('f12'))).toBe('\x1b[24~');
  });
  it('named keys do not require text', () => {
    expect(keyToBytes(key('enter'), undefined)).toBe('\r');
  });
});

describe('keyToBytes — printables (logical char)', () => {
  it('sends the logical character', () => {
    expect(keyToBytes(key('a'), 'a')).toBe('a');
    expect(keyToBytes(key('a', { shift: true }), 'A')).toBe('A');
    expect(keyToBytes(key('1'), '1')).toBe('1');
    expect(keyToBytes(key('1', { shift: true }), '!')).toBe('!');
  });
  it('Alt prefixes a printable with ESC (Meta)', () => {
    expect(keyToBytes(key('b', { alt: true }), 'b')).toBe('\x1bb');
  });
  it('returns null for a printable with no text', () => {
    expect(keyToBytes(key('a'))).toBeNull();
  });
});
