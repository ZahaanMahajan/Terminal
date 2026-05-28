/**
 * conflicts.test.ts — prefix-conflict detection.
 */

import { describe, it, expect } from 'vitest';
import { Keymap } from './keymap';
import {
  describeConflict,
  findAllConflicts,
  findConflicts,
  isStrictTokenPrefix,
} from './conflicts';

describe('isStrictTokenPrefix', () => {
  it('detects strict prefixes only', () => {
    expect(isStrictTokenPrefix(['g'], ['g', 'g'])).toBe(true);
    expect(isStrictTokenPrefix(['d'], ['d', 'w'])).toBe(true);
    expect(isStrictTokenPrefix(['g', 'g'], ['g', 'g'])).toBe(false); // equal, not strict
    expect(isStrictTokenPrefix(['g', 'g'], ['g'])).toBe(false); // longer
    expect(isStrictTokenPrefix(['d'], ['g', 'g'])).toBe(false); // diverges
  });
});

describe('findConflicts', () => {
  it('reports nothing when no binding is a prefix of another', () => {
    const km = new Keymap()
      .bind('normal', 'h', 'cursor.left')
      .bind('normal', 'dd', 'delete.line')
      .bind('normal', 'dw', 'delete.word'); // 'd' itself is NOT bound, so no prefix conflict
    expect(findConflicts(km, 'normal')).toEqual([]);
  });

  it('flags a binding that is a prefix of another (the gg/g case)', () => {
    const km = new Keymap().bind('normal', 'g', 'g.alone').bind('normal', 'gg', 'g.top');
    const conflicts = findConflicts(km, 'normal');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].prefix.action).toBe('g.alone');
    expect(conflicts[0].shadowed.map((b) => b.action)).toEqual(['g.top']);
  });

  it('flags the deliberate space / space-space ambiguity', () => {
    const km = new Keymap()
      .bind('normal', '<space>', 'space.single')
      .bind('normal', '<space><space>', 'space.double');
    const conflicts = findConflicts(km, 'normal');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].prefix.action).toBe('space.single');
  });

  it('reports all longer bindings a prefix shadows', () => {
    const km = new Keymap()
      .bind('normal', 'g', 'g.alone')
      .bind('normal', 'gg', 'g.top')
      .bind('normal', 'gd', 'g.def');
    const conflicts = findConflicts(km, 'normal');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].shadowed.map((b) => b.action).sort()).toEqual(['g.def', 'g.top']);
  });

  it('reports nested prefixes as separate conflicts (a < ab < abc)', () => {
    const km = new Keymap()
      .bind('normal', 'a', 'a')
      .bind('normal', 'ab', 'ab')
      .bind('normal', 'abc', 'abc');
    const conflicts = findConflicts(km, 'normal');
    const byPrefix = conflicts.map((c) => c.prefix.action).sort();
    expect(byPrefix).toEqual(['a', 'ab']);
    const aConflict = conflicts.find((c) => c.prefix.action === 'a')!;
    expect(aConflict.shadowed.map((b) => b.action).sort()).toEqual(['ab', 'abc']);
  });

  it('does not flag across modes', () => {
    const km = new Keymap()
      .bind('normal', 'g', 'normal.g')
      .bind('insert', 'gg', 'insert.gg'); // different mode → not a conflict
    expect(findConflicts(km, 'normal')).toEqual([]);
    expect(findConflicts(km, 'insert')).toEqual([]);
  });
});

describe('findAllConflicts', () => {
  it('collects conflicts from every mode', () => {
    const km = new Keymap()
      .bind('normal', 'g', 'n.g')
      .bind('normal', 'gg', 'n.gg')
      .bind('visual', 'i', 'v.i')
      .bind('visual', 'iw', 'v.iw');
    const all = findAllConflicts(km);
    expect(all).toHaveLength(2);
    expect(all.map((c) => c.mode).sort()).toEqual(['normal', 'visual']);
  });
});

describe('describeConflict', () => {
  it('explains the latency cost in plain language', () => {
    const km = new Keymap().bind('normal', 'g', 'g.alone').bind('normal', 'gg', 'g.top');
    const [c] = findConflicts(km, 'normal');
    expect(describeConflict(c, 700)).toBe('"g" resolves only after a timeout (~700ms) because gg extends it');
  });

  it('pluralizes when multiple bindings extend the prefix', () => {
    const km = new Keymap()
      .bind('normal', 'g', 'g.alone')
      .bind('normal', 'gg', 'g.top')
      .bind('normal', 'gd', 'g.def');
    const [c] = findConflicts(km, 'normal');
    expect(describeConflict(c)).toMatch(/extend it$/);
  });
});
