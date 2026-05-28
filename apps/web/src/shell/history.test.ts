/**
 * history.test.ts — history navigation + reverse search.
 */

import { describe, it, expect } from 'vitest';
import { History } from './history';

describe('History', () => {
  it('records entries, skipping blanks and consecutive duplicates', () => {
    const h = new History();
    h.add('a');
    h.add('');
    h.add('   ');
    h.add('b');
    h.add('b'); // duplicate
    expect(h.all).toEqual(['a', 'b']);
  });

  it('caps the number of entries', () => {
    const h = new History(2);
    h.add('a');
    h.add('b');
    h.add('c');
    expect(h.all).toEqual(['b', 'c']);
  });

  it('Up walks backward; bottom stays at the oldest', () => {
    const h = new History();
    h.add('first');
    h.add('second');
    expect(h.prev('draft')).toBe('second');
    expect(h.prev('draft')).toBe('first');
    expect(h.prev('draft')).toBe('first'); // clamp at oldest
  });

  it('Down walks forward and restores the draft past the newest', () => {
    const h = new History();
    h.add('a');
    h.add('b');
    h.prev('typing...'); // → 'b', stashes draft
    h.prev('x'); // → 'a'
    expect(h.next()).toBe('b');
    expect(h.next()).toBe('typing...'); // draft restored
  });

  it('Down with no active navigation returns null', () => {
    const h = new History();
    h.add('a');
    expect(h.next()).toBeNull();
  });

  it('add() resets navigation', () => {
    const h = new History();
    h.add('a');
    h.prev('draft');
    h.add('b');
    expect(h.next()).toBeNull(); // navigation was reset
  });

  describe('reverseSearch', () => {
    const h = new History();
    h.add('git status');
    h.add('git commit');
    h.add('npm test');

    it('finds the most recent match', () => {
      expect(h.reverseSearch('git')).toEqual({ index: 1, line: 'git commit' });
    });
    it('steps further back from a given index', () => {
      const first = h.reverseSearch('git')!;
      expect(h.reverseSearch('git', first.index)).toEqual({ index: 0, line: 'git status' });
    });
    it('returns null when nothing matches', () => {
      expect(h.reverseSearch('docker')).toBeNull();
    });
  });
});
