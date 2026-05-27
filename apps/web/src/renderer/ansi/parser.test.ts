/**
 * parser.test.ts — Williams's state machine, by invariant.
 */

import { describe, it, expect } from 'vitest';
import { AnsiParser, type Action } from './parser';

const parse = (input: string): Action[] => new AnsiParser().parse(input);

describe('AnsiParser', () => {
  describe('printable text', () => {
    it('emits one print action per code point', () => {
      expect(parse('abc')).toEqual([
        { type: 'print', char: 'a' },
        { type: 'print', char: 'b' },
        { type: 'print', char: 'c' },
      ]);
    });

    it('treats DEL (0x7F) as execute (control), not print', () => {
      expect(parse('\x7F')).toEqual([{ type: 'execute', code: 0x7f }]);
    });

    it('emits non-ASCII code points as print', () => {
      // U+00E9 (é). One code point.
      expect(parse('é')).toEqual([{ type: 'print', char: 'é' }]);
    });
  });

  describe('C0 controls', () => {
    it('emits execute for BS / HT / LF / CR / BEL', () => {
      expect(parse('\x08\x09\x0a\x0d\x07')).toEqual([
        { type: 'execute', code: 0x08 },
        { type: 'execute', code: 0x09 },
        { type: 'execute', code: 0x0a },
        { type: 'execute', code: 0x0d },
        { type: 'execute', code: 0x07 },
      ]);
    });
  });

  describe('CSI sequences', () => {
    it('parses a no-param final ("\\x1b[H")', () => {
      expect(parse('\x1b[H')).toEqual([
        { type: 'csi', final: 'H', params: [], intermediate: '', prefix: '' },
      ]);
    });

    it('parses a single-param final ("\\x1b[5A")', () => {
      expect(parse('\x1b[5A')).toEqual([
        { type: 'csi', final: 'A', params: [5], intermediate: '', prefix: '' },
      ]);
    });

    it('parses multi-param finals ("\\x1b[1;2;3H")', () => {
      expect(parse('\x1b[1;2;3H')).toEqual([
        { type: 'csi', final: 'H', params: [1, 2, 3], intermediate: '', prefix: '' },
      ]);
    });

    it('treats empty params as 0 ("\\x1b[;1H" → [0, 1])', () => {
      expect(parse('\x1b[;1H')).toEqual([
        { type: 'csi', final: 'H', params: [0, 1], intermediate: '', prefix: '' },
      ]);
    });

    it('captures private indicators ("\\x1b[?25h")', () => {
      expect(parse('\x1b[?25h')).toEqual([
        { type: 'csi', final: 'h', params: [25], intermediate: '', prefix: '?' },
      ]);
    });

    it('parses SGR with many params ("\\x1b[38;2;255;0;0m")', () => {
      expect(parse('\x1b[38;2;255;0;0m')).toEqual([
        { type: 'csi', final: 'm', params: [38, 2, 255, 0, 0], intermediate: '', prefix: '' },
      ]);
    });
  });

  describe('ESC sequences (non-CSI)', () => {
    it('parses a bare ESC dispatch ("\\x1bD")', () => {
      expect(parse('\x1bD')).toEqual([
        { type: 'esc', final: 'D', intermediate: '' },
      ]);
    });

    it('parses an ESC with intermediate ("\\x1b(B" — designate G0 = ASCII)', () => {
      expect(parse('\x1b(B')).toEqual([
        { type: 'esc', final: 'B', intermediate: '(' },
      ]);
    });
  });

  describe('OSC strings (consumed, not dispatched)', () => {
    it('drops "\\x1b]0;title\\x07" entirely (terminated by BEL)', () => {
      expect(parse('\x1b]0;title\x07after')).toEqual([
        { type: 'print', char: 'a' },
        { type: 'print', char: 'f' },
        { type: 'print', char: 't' },
        { type: 'print', char: 'e' },
        { type: 'print', char: 'r' },
      ]);
    });
  });

  describe('aborts and recovery', () => {
    it('CAN (0x18) aborts a partial CSI and emits execute', () => {
      expect(parse('\x1b[5\x18A')).toEqual([
        { type: 'execute', code: 0x18 },
        { type: 'print', char: 'A' },
      ]);
    });

    it('a fresh ESC inside CSI resets the sequence', () => {
      // ESC [ 5 ESC D  →  ESC restarts; D becomes an ESC dispatch.
      expect(parse('\x1b[5\x1bD')).toEqual([
        { type: 'esc', final: 'D', intermediate: '' },
      ]);
    });
  });

  describe('stream safety (chunked input)', () => {
    it('the same actions whether the input is split or not', () => {
      const whole = parse('\x1b[31mhello\x1b[0m world');
      const p = new AnsiParser();
      const a = p.parse('\x1b[3');
      const b = p.parse('1mhel');
      const c = p.parse('lo\x1b[0m world');
      expect([...a, ...b, ...c]).toEqual(whole);
    });

    it('does not emit until the final byte arrives ("\\x1b[31" produces nothing)', () => {
      const p = new AnsiParser();
      expect(p.parse('\x1b[31')).toEqual([]);
      expect(p.parse('m')).toEqual([
        { type: 'csi', final: 'm', params: [31], intermediate: '', prefix: '' },
      ]);
    });
  });
});
