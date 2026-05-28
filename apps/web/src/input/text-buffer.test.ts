/**
 * text-buffer.test.ts — vim motions and edits on the sandbox buffer.
 */

import { describe, it, expect } from 'vitest';
import { applyMotion, charClass, TextBuffer } from './text-buffer';

const buf = (text: string) => new TextBuffer(text);

describe('charClass', () => {
  it('classifies word / punct / space', () => {
    expect(charClass('a')).toBe('word');
    expect(charClass('_')).toBe('word');
    expect(charClass('5')).toBe('word');
    expect(charClass('.')).toBe('punct');
    expect(charClass(' ')).toBe('space');
    expect(charClass('')).toBe('space');
  });
});

describe('TextBuffer — basic motions', () => {
  it('hjkl move and clamp to bounds', () => {
    const b = buf('abc\ndefgh');
    b.moveRight(); // (0,1)
    b.moveRight(); // (0,2)
    b.moveRight(); // clamped at last char (0,2)
    expect(b.cursor).toEqual({ row: 0, col: 2 });
    b.moveDown(); // (1,2)
    expect(b.cursor).toEqual({ row: 1, col: 2 });
    b.moveLeft();
    expect(b.cursor).toEqual({ row: 1, col: 1 });
    b.moveUp(); // back to row 0, col clamped to 1
    expect(b.cursor).toEqual({ row: 0, col: 1 });
  });

  it('column clamps when moving to a shorter line', () => {
    const b = buf('abcde\nx');
    b.cursor = { row: 0, col: 4 };
    b.moveDown();
    expect(b.cursor).toEqual({ row: 1, col: 0 }); // 'x' line max col is 0
  });

  it('gg / G jump to first / last line', () => {
    const b = buf('one\ntwo\nthree');
    b.cursor = { row: 1, col: 2 };
    b.gotoTop();
    expect(b.cursor).toEqual({ row: 0, col: 0 });
    b.gotoBottom();
    expect(b.cursor).toEqual({ row: 2, col: 0 });
  });
});

describe('TextBuffer — word motions', () => {
  it('w advances to the start of the next word, wrapping lines', () => {
    const b = buf('hello world\nfoo');
    b.wordForward();
    expect(b.cursor).toEqual({ row: 0, col: 6 }); // 'w' of world
    b.wordForward();
    expect(b.cursor).toEqual({ row: 1, col: 0 }); // 'f' of foo (wrapped)
  });

  it('w treats a punctuation run as its own word', () => {
    const b = buf('a.b');
    b.wordForward();
    expect(b.cursor).toEqual({ row: 0, col: 1 }); // '.'
    b.wordForward();
    expect(b.cursor).toEqual({ row: 0, col: 2 }); // 'b'
  });

  it('b goes back to the start of the previous word', () => {
    const b = buf('hello world');
    b.cursor = { row: 0, col: 6 }; // 'w'
    b.wordBackward();
    expect(b.cursor).toEqual({ row: 0, col: 0 });
  });

  it('e goes to the end of the current word', () => {
    const b = buf('hello world');
    b.wordEnd();
    expect(b.cursor).toEqual({ row: 0, col: 4 }); // 'o' end of hello
    b.wordEnd();
    expect(b.cursor).toEqual({ row: 0, col: 10 }); // 'd' end of world
  });
});

describe('TextBuffer — edits', () => {
  it('dd deletes the current line', () => {
    const b = buf('one\ntwo\nthree');
    b.cursor = { row: 1, col: 0 };
    b.deleteLine();
    expect(b.lines).toEqual(['one', 'three']);
  });

  it('dd on the only line clears it', () => {
    const b = buf('solo');
    b.deleteLine();
    expect(b.lines).toEqual(['']);
  });

  it('dw deletes a word and the trailing space', () => {
    const b = buf('hello world');
    b.deleteWord();
    expect(b.lines[0]).toBe('world');
  });

  it('ciw deletes the inner word under the cursor', () => {
    const b = buf('hello world');
    b.cursor = { row: 0, col: 8 }; // inside 'world'
    b.changeInnerWord();
    expect(b.lines[0]).toBe('hello ');
  });

  it('ciw on punctuation deletes the punctuation run', () => {
    const b = buf('a...b');
    b.cursor = { row: 0, col: 2 }; // middle dot
    b.changeInnerWord();
    expect(b.lines[0]).toBe('ab');
  });
});

describe('applyMotion dispatch', () => {
  it('routes named actions to buffer ops and reports handled', () => {
    const b = buf('abc def');
    expect(applyMotion(b, 'word.next')).toBe(true);
    expect(b.cursor).toEqual({ row: 0, col: 4 });
    expect(applyMotion(b, 'delete.word')).toBe(true);
    expect(b.lines[0]).toBe('abc ');
  });

  it('returns false for non-buffer actions', () => {
    const b = buf('abc');
    expect(applyMotion(b, 'space.single')).toBe(false);
    expect(b.text).toBe('abc'); // unchanged
  });
});
