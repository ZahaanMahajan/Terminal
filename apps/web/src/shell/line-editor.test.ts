/**
 * line-editor.test.ts — readline-style editing operations.
 */

import { describe, it, expect } from 'vitest';
import { LineEditor } from './line-editor';

const ed = (text = '', cursor = text.length) => {
  const e = new LineEditor();
  e.set(text, cursor);
  return e;
};

describe('LineEditor', () => {
  it('inserts at the cursor', () => {
    const e = ed('ac', 1);
    e.insert('b');
    expect(e.text).toBe('abc');
    expect(e.cursor).toBe(2);
  });

  it('backspace deletes before the cursor (no-op at col 0)', () => {
    const e = ed('abc', 2);
    e.backspace();
    expect(e.text).toBe('ac');
    expect(e.cursor).toBe(1);
    const f = ed('abc', 0);
    f.backspace();
    expect(f.text).toBe('abc');
  });

  it('del deletes at the cursor (no-op at end)', () => {
    const e = ed('abc', 1);
    e.del();
    expect(e.text).toBe('ac');
    expect(e.cursor).toBe(1);
  });

  it('left/right/home/end move the cursor within bounds', () => {
    const e = ed('abc', 1);
    e.left();
    expect(e.cursor).toBe(0);
    e.left();
    expect(e.cursor).toBe(0);
    e.end();
    expect(e.cursor).toBe(3);
    e.right();
    expect(e.cursor).toBe(3);
    e.home();
    expect(e.cursor).toBe(0);
  });

  it('killToEnd / killToStart cut and return text', () => {
    const e = ed('hello world', 5);
    expect(e.killToEnd()).toBe(' world');
    expect(e.text).toBe('hello');
    const f = ed('hello world', 6);
    expect(f.killToStart()).toBe('hello ');
    expect(f.text).toBe('world');
    expect(f.cursor).toBe(0);
  });

  it('deleteWordBack removes the previous word + trailing spaces', () => {
    const e = ed('foo bar baz', 11);
    expect(e.deleteWordBack()).toBe('baz');
    expect(e.text).toBe('foo bar ');
    e.deleteWordBack();
    expect(e.text).toBe('foo ');
  });

  it('deleteWordBack skips trailing whitespace first', () => {
    const e = ed('foo bar   ', 10);
    e.deleteWordBack();
    expect(e.text).toBe('foo ');
  });

  it('set / clear replace the buffer', () => {
    const e = ed('abc', 1);
    e.set('hello');
    expect(e.text).toBe('hello');
    expect(e.cursor).toBe(5);
    e.clear();
    expect(e.text).toBe('');
    expect(e.cursor).toBe(0);
  });
});
