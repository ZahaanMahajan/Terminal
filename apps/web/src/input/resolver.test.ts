/**
 * resolver.test.ts — the mode-aware FSM, driven by hand (no timers).
 */

import { describe, it, expect } from 'vitest';
import { Keymap } from './keymap';
import { KeyResolver } from './resolver';
import { parseKey, type Key } from './key';

/** Feed a notation string one bare key at a time; return the last FeedResult. */
const press = (r: KeyResolver, token: string) => r.feed(parseKey(token));

function vimNormal(): Keymap {
  return new Keymap()
    .bind('normal', 'h', 'cursor.left')
    .bind('normal', 'dd', 'delete.line')
    .bind('normal', 'dw', 'delete.word')
    .bind('normal', 'gg', 'line.top')
    .bind('normal', 'ciw', 'change.innerWord');
}

describe('KeyResolver', () => {
  it('fires an unambiguous single-key binding immediately', () => {
    const r = new KeyResolver(vimNormal(), 'normal');
    const res = press(r, 'h');
    expect(res.actions).toEqual(['cursor.left']);
    expect(res.pending).toEqual([]);
    expect(res.awaitingTimeout).toBe(false);
  });

  it('holds a prefix pending, then fires the completed sequence', () => {
    const r = new KeyResolver(vimNormal(), 'normal');
    const a = press(r, 'd');
    expect(a.actions).toEqual([]);
    expect(a.pending.map((k: Key) => k.key)).toEqual(['d']);
    const b = press(r, 'w');
    expect(b.actions).toEqual(['delete.word']);
    expect(b.pending).toEqual([]);
  });

  it('resolves a three-key sequence (ciw)', () => {
    const r = new KeyResolver(vimNormal(), 'normal');
    press(r, 'c');
    expect(press(r, 'i').actions).toEqual([]);
    expect(press(r, 'w').actions).toEqual(['change.innerWord']);
  });

  it('reports a first unbound key without disturbing state', () => {
    const r = new KeyResolver(vimNormal(), 'normal');
    const res = press(r, 'z');
    expect(res.actions).toEqual([]);
    expect(res.unbound.map((k) => k.key)).toEqual(['z']);
    expect(res.pending).toEqual([]);
  });

  it('discards a dead-ended sequence and re-processes the offending key', () => {
    const r = new KeyResolver(vimNormal(), 'normal');
    press(r, 'd'); // prefix
    const res = press(r, 'z'); // 'dz' not bound; 'd' is a pure prefix (no staged action)
    expect(res.actions).toEqual([]);
    expect(res.unbound.map((k) => k.key)).toEqual(['z']); // 'z' re-processed fresh → unbound
    expect(res.pending).toEqual([]);
  });

  describe('ambiguous prefix (g bound AND gg bound)', () => {
    const ambiguous = () =>
      new Keymap().bind('normal', 'g', 'g.alone').bind('normal', 'gg', 'g.top');

    it('stages the shorter action and awaits a timeout', () => {
      const r = new KeyResolver(ambiguous(), 'normal');
      const res = press(r, 'g');
      expect(res.actions).toEqual([]);
      expect(res.awaitingTimeout).toBe(true);
      expect(res.pending.map((k) => k.key)).toEqual(['g']);
    });

    it('fires the longer action when the next key extends it', () => {
      const r = new KeyResolver(ambiguous(), 'normal');
      press(r, 'g');
      expect(press(r, 'g').actions).toEqual(['g.top']);
    });

    it('fires the staged shorter action on timeout', () => {
      const r = new KeyResolver(ambiguous(), 'normal');
      press(r, 'g');
      expect(r.flushTimeout()).toEqual(['g.alone']);
      expect(r.pending).toEqual([]);
    });

    it('fires the staged action then re-processes a dead-ending key', () => {
      const r = new KeyResolver(ambiguous(), 'normal');
      press(r, 'g'); // staged 'g.alone'
      const res = press(r, 'h'); // 'gh' not bound, 'h' unbound here
      expect(res.actions).toEqual(['g.alone']);
      expect(res.unbound.map((k) => k.key)).toEqual(['h']);
    });
  });

  describe('timeouts', () => {
    it('flushTimeout on a pure prefix fires nothing and resets', () => {
      const r = new KeyResolver(vimNormal(), 'normal');
      press(r, 'd'); // pure prefix, no staged action
      expect(r.flushTimeout()).toEqual([]);
      expect(r.pending).toEqual([]);
    });
  });

  describe('modes', () => {
    it('resolves against the active mode and resets the buffer on switch', () => {
      const km = new Keymap()
        .bind('normal', 'dd', 'normal.deleteLine')
        .bind('insert', 'jk', 'insert.escape');
      const r = new KeyResolver(km, 'normal');
      press(r, 'd');
      expect(r.pending.length).toBe(1);
      r.setMode('insert');
      expect(r.pending).toEqual([]); // buffer abandoned
      press(r, 'j');
      expect(press(r, 'k').actions).toEqual(['insert.escape']);
    });

    it('treats keys unbound in the current mode as unbound', () => {
      const km = new Keymap().bind('normal', 'dd', 'x');
      const r = new KeyResolver(km, 'insert'); // insert has no bindings
      expect(press(r, 'd').unbound.map((k) => k.key)).toEqual(['d']);
    });
  });
});
