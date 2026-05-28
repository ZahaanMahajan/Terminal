/**
 * keymap.test.ts — trie construction, lookup, introspection.
 */

import { describe, it, expect } from 'vitest';
import { Keymap, tokensToNotation } from './keymap';

describe('Keymap', () => {
  it('builds a trie path and stores the action at the terminal node', () => {
    const km = new Keymap();
    km.bind('normal', 'dw', 'delete.word');
    const root = km.root('normal');
    const d = root.children.get('d');
    expect(d).toBeDefined();
    expect(d!.action).toBeNull(); // 'd' alone is a prefix
    const w = d!.children.get('w');
    expect(w!.action).toBe('delete.word');
    expect(w!.children.size).toBe(0);
  });

  it('shares prefixes across bindings', () => {
    const km = new Keymap();
    km.bind('normal', 'dd', 'delete.line');
    km.bind('normal', 'dw', 'delete.word');
    const d = km.root('normal').children.get('d')!;
    expect([...d.children.keys()].sort()).toEqual(['d', 'w']);
  });

  it('a prefix binding leaves both an action and children on the node', () => {
    const km = new Keymap();
    km.bind('normal', 'g', 'g.alone');
    km.bind('normal', 'gg', 'g.top');
    const g = km.root('normal').children.get('g')!;
    expect(g.action).toBe('g.alone');
    expect(g.children.get('g')!.action).toBe('g.top');
  });

  it('rebinding overwrites the action', () => {
    const km = new Keymap();
    km.bind('normal', 'x', 'first');
    km.bind('normal', 'x', 'second');
    expect(km.root('normal').children.get('x')!.action).toBe('second');
  });

  it('normalizes shift + modifiers into canonical tokens', () => {
    const km = new Keymap();
    km.bind('normal', 'G', 'line.bottom'); // shift+g
    km.bind('normal', '<C-w>h', 'win.left');
    expect(km.root('normal').children.has('G')).toBe(true);
    expect(km.root('normal').children.get('C-w')!.children.has('h')).toBe(true);
  });

  it('throws on an empty sequence', () => {
    expect(() => new Keymap().bind('normal', '', 'noop')).toThrow();
  });

  it('root() for an unbound mode is empty', () => {
    const km = new Keymap();
    expect(km.root('insert').children.size).toBe(0);
  });

  describe('bindings()', () => {
    it('lists every terminal binding with its token path', () => {
      const km = new Keymap();
      km.bind('normal', 'dd', 'delete.line');
      km.bind('normal', 'dw', 'delete.word');
      km.bind('normal', 'G', 'line.bottom');
      const list = km.bindings('normal').sort((a, b) => a.action.localeCompare(b.action));
      expect(list).toEqual([
        { tokens: ['d', 'd'], action: 'delete.line' },
        { tokens: ['d', 'w'], action: 'delete.word' },
        { tokens: ['G'], action: 'line.bottom' },
      ]);
    });

    it('includes prefix bindings (node with action AND children)', () => {
      const km = new Keymap();
      km.bind('normal', 'g', 'g.alone');
      km.bind('normal', 'gg', 'g.top');
      const actions = km.bindings('normal').map((b) => b.action).sort();
      expect(actions).toEqual(['g.alone', 'g.top']);
    });

    it('is empty for an unbound mode', () => {
      expect(new Keymap().bindings('visual')).toEqual([]);
    });
  });

  describe('tokensToNotation', () => {
    it('round-trips token paths to authoring notation', () => {
      expect(tokensToNotation(['d', 'd'])).toBe('dd');
      expect(tokensToNotation(['g', 'g'])).toBe('gg');
      expect(tokensToNotation(['G'])).toBe('G');
      expect(tokensToNotation(['C-w', 'h'])).toBe('<C-w>h');
      expect(tokensToNotation(['space', 'space'])).toBe('<space><space>');
    });
  });
});
