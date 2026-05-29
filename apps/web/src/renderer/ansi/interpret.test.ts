/**
 * interpret.test.ts — action → mutation invariants.
 *
 * Each test feeds a small ANSI input through a fresh Screen+Cursor and asserts on observable
 * state (the cell at some coordinate, the cursor's position, the pen colors).
 */

import { describe, it, expect } from 'vitest';
import { Screen } from '../screen';
import { makeCursor } from '../cursor';
import { AnsiParser } from './parser';
import { feed } from './interpret';
import { ansi256 } from './sgr';
import {
  DEFAULT_FG,
  DEFAULT_BG,
  ATTR_BOLD,
  ATTR_ITALIC,
  ATTR_UNDERLINE,
  ATTR_INVERSE,
} from '../cell';

/** Build a fresh (Screen, Cursor, parser) and feed an input. */
function setup(input: string, cols = 20, rows = 4) {
  const screen = new Screen(cols, rows);
  const cursor = makeCursor(0, 0);
  const parser = new AnsiParser();
  feed(input, screen, cursor, parser);
  return { screen, cursor, parser };
}

/** Read a viewport row as a string, trimming trailing spaces. */
function rowText(screen: Screen, row: number): string {
  let s = '';
  for (let c = 0; c < screen.cols; c++) s += screen.get(c, row).char;
  return s.replace(/ +$/, '');
}

describe('feed (parser → interpreter)', () => {
  describe('printing', () => {
    it('lays out characters at the cursor and advances col', () => {
      const { screen, cursor } = setup('abc');
      expect(rowText(screen, 0)).toBe('abc');
      expect(cursor.col).toBe(3);
      expect(cursor.lineId).toBe(0);
    });

    it('auto-wraps at cols, setting the wrap flag on the source line', () => {
      const { screen, cursor } = setup('abcdefg', /* cols */ 5);
      expect(rowText(screen, 0)).toBe('abcde');
      expect(rowText(screen, 1)).toBe('fg');
      expect(screen.scrollback.isWrapped(0)).toBe(true);
      expect(cursor.lineId).toBe(1);
      expect(cursor.col).toBe(2);
    });
  });

  describe('C0 controls', () => {
    it('CR returns col to 0 without changing line', () => {
      const { screen, cursor } = setup('abc\rXY');
      expect(rowText(screen, 0)).toBe('XYc');
      expect(cursor.lineId).toBe(0);
      expect(cursor.col).toBe(2);
    });

    it('LF advances to the next line, preserving column', () => {
      const { cursor } = setup('abc\nX');
      expect(cursor.lineId).toBe(1);
      // After 'abc', col = 3. LF preserves col, so 'X' lands at col 3 of line 1.
      expect(cursor.col).toBe(4);
    });

    it('BS moves col back by 1 (clamped at 0)', () => {
      const { cursor } = setup('a\b\b\b');
      expect(cursor.col).toBe(0);
    });

    it('HT advances to the next multiple-of-8 column', () => {
      const { cursor } = setup('a\tb');
      // a → col 1; HT → col 8; b → col 9.
      expect(cursor.col).toBe(9);
    });

    it('LF at the bottom row appends a line and auto-scrolls', () => {
      const screen = new Screen(10, 3);
      const cursor = makeCursor(0, 0);
      const parser = new AnsiParser();
      // CR-LF between lines so each starts at col 0 (LF alone preserves column).
      feed('a\r\nb\r\nc\r\nd', screen, cursor, parser);
      expect(screen.viewportTop).toBeGreaterThan(0);
      expect(rowText(screen, screen.rows - 1)).toBe('d');
    });
  });

  describe('CSI cursor motion', () => {
    it('CUP "\\x1b[3;5H" moves to viewport (row 3, col 5) 1-indexed', () => {
      const { cursor, screen } = setup('\x1b[3;5HX');
      // 1-indexed (3,5) → 0-indexed (row 2, col 4). After 'X', col=5.
      expect(cursor.col).toBe(5);
      expect(cursor.lineId).toBe(screen.viewportTop + 2);
      // 'X' lands at col 4: four leading spaces, then X, then trailing spaces (trimmed).
      expect(rowText(screen, 2)).toBe('    X');
    });

    it('CUU/CUD/CUF/CUB move relative; default param 1', () => {
      const screen = new Screen(20, 4);
      const cursor = makeCursor(0, 0);
      const parser = new AnsiParser();
      // (0,0) → CUP 3;5 → (row 2, col 4). CUU → row 1. CUB 2 → col 2.
      feed('\x1b[3;5H\x1b[A\x1b[2D', screen, cursor, parser);
      expect(cursor.col).toBe(2);
      expect(cursor.lineId).toBe(screen.viewportTop + 1);
    });

    it('CHA "\\x1b[10G" moves to column 10 (1-indexed)', () => {
      const { cursor } = setup('abc\x1b[10G');
      expect(cursor.col).toBe(9);
    });

    it('CSI with default params snaps to (1,1)', () => {
      const { cursor, screen } = setup('abc\x1b[H');
      expect(cursor.col).toBe(0);
      expect(cursor.lineId).toBe(screen.viewportTop);
    });
  });

  describe('CSI erase', () => {
    it('EL 0 erases cursor → end of line', () => {
      const { screen, cursor } = setup('hello\x1b[3GZZ\x1b[K');
      // After 'hello', col=5. CHA(3) → col=2. 'ZZ' → cells 2,3 are 'ZZ'; col=4.
      // EL 0 → erase from col 4 to end.
      expect(rowText(screen, 0)).toBe('heZZ');
      expect(cursor.col).toBe(4);
    });

    it('EL 2 erases the whole line', () => {
      const { screen } = setup('hello\x1b[5G\x1b[2K');
      expect(rowText(screen, 0)).toBe('');
    });

    it('ED 2 clears the whole viewport', () => {
      const { screen } = setup('one\ntwo\nthree\x1b[2J');
      for (let r = 0; r < screen.rows; r++) {
        expect(rowText(screen, r)).toBe('');
      }
    });

    it('ED 0 clears from cursor to end-of-display', () => {
      // CR-LF so each line starts at col 0 (LF alone preserves column).
      const { screen } = setup('AA\r\nBB\r\nCC\r\nDD\x1b[2;2H\x1b[J');
      expect(rowText(screen, 0)).toBe('AA');
      expect(rowText(screen, 1)).toBe('B');
      expect(rowText(screen, 2)).toBe('');
      expect(rowText(screen, 3)).toBe('');
    });
  });

  describe('CSI SGR (colors)', () => {
    it('sets fg to ANSI red on "\\x1b[31m" and stamps it into a printed cell', () => {
      const { screen, cursor } = setup('\x1b[31mX');
      expect(cursor.pen.fg).toBe('#cc0000');
      expect(screen.get(0, 0).fg).toBe('#cc0000');
    });

    it('resets on "\\x1b[0m" (and on empty params)', () => {
      const a = setup('\x1b[31mX\x1b[0mY');
      expect(a.screen.get(0, 0).fg).toBe('#cc0000');
      expect(a.screen.get(1, 0).fg).toBe(DEFAULT_FG);
      const b = setup('\x1b[31mX\x1b[mY'); // CSI m with no params
      expect(b.screen.get(1, 0).fg).toBe(DEFAULT_FG);
    });

    it('256-color foreground via "\\x1b[38;5;Nm"', () => {
      const { cursor } = setup('\x1b[38;5;196m');
      expect(cursor.pen.fg).toBe(ansi256(196));
    });

    it('truecolor via "\\x1b[38;2;R;G;Bm"', () => {
      const { cursor } = setup('\x1b[38;2;10;20;30m');
      expect(cursor.pen.fg).toBe('#0a141e');
    });

    it('background colors via 40–47 / 48;… / 49 reset', () => {
      const { cursor } = setup('\x1b[44mX');
      expect(cursor.pen.bg).toBe('#3465a4');
      const b = setup('\x1b[44mX\x1b[49mY');
      expect(b.cursor.pen.bg).toBe(DEFAULT_BG);
    });
  });

  describe('CSI SGR (style attrs)', () => {
    it('SGR 1 sets bold in pen.attrs', () => {
      const { cursor } = setup('\x1b[1m');
      expect(cursor.pen.attrs & ATTR_BOLD).toBeTruthy();
    });

    it('SGR 3/4/7 set italic / underline / inverse', () => {
      const { cursor } = setup('\x1b[3;4;7m');
      expect(cursor.pen.attrs & ATTR_ITALIC).toBeTruthy();
      expect(cursor.pen.attrs & ATTR_UNDERLINE).toBeTruthy();
      expect(cursor.pen.attrs & ATTR_INVERSE).toBeTruthy();
    });

    it('SGR 22/23/24/27 clear their respective attrs', () => {
      const a = setup('\x1b[1;3;4;7m\x1b[22m');
      expect(a.cursor.pen.attrs & ATTR_BOLD).toBe(0);
      expect(a.cursor.pen.attrs & ATTR_ITALIC).toBeTruthy(); // others still set
      const b = setup('\x1b[1;3;4;7m\x1b[23;24;27m');
      expect(b.cursor.pen.attrs).toBe(ATTR_BOLD);
    });

    it('SGR 0 clears all attrs alongside colors', () => {
      const { cursor } = setup('\x1b[1;3;4;7;31;44m\x1b[0m');
      expect(cursor.pen.attrs).toBe(0);
      expect(cursor.pen.fg).toBe(DEFAULT_FG);
      expect(cursor.pen.bg).toBe(DEFAULT_BG);
    });

    it('a printed cell carries the current pen.attrs', () => {
      const { screen } = setup('\x1b[1mX');
      expect(screen.get(0, 0).attrs).toBe(ATTR_BOLD);
    });

    it('cells written with no attrs do not get an attrs field at all', () => {
      const { screen } = setup('X');
      expect(screen.get(0, 0).attrs).toBeUndefined();
    });

    it('combining SGR sets multiple flags ("\\x1b[1;4mbold-underlined")', () => {
      const { screen } = setup('\x1b[1;4mA');
      expect(screen.get(0, 0).attrs).toBe(ATTR_BOLD | ATTR_UNDERLINE);
    });
  });

  describe('private modes (DECSET/DECRST: cursor, alt screen)', () => {
    it('?25l hides the cursor; ?25h shows it again', () => {
      expect(setup('\x1b[?25l').cursor.hidden).toBe(true);
      expect(setup('\x1b[?25l\x1b[?25h').cursor.hidden).toBe(false);
      expect(setup('X').cursor.hidden).toBe(false); // default visible
    });

    it('?1049h switches to a blank alternate screen', () => {
      const { screen } = setup('hello\x1b[?1049h');
      expect(screen.inAltScreen).toBe(true);
      expect(rowText(screen, 0)).toBe(''); // alt screen starts empty
    });

    it('?1049l restores the primary buffer exactly, discarding alt content', () => {
      const { screen, cursor } = setup('PRIMARY\x1b[?1049hALT\x1b[?1049l');
      expect(screen.inAltScreen).toBe(false);
      expect(rowText(screen, 0)).toBe('PRIMARY');
      // Cursor position is restored to where it was on the primary screen.
      expect(cursor.col).toBe(7);
      expect(cursor.lineId).toBe(0);
    });

    it('?1049 round-trips the pen (SGR inside the alt screen is discarded)', () => {
      const red = setup('\x1b[31m').cursor.pen.fg;
      const { cursor } = setup('\x1b[31mAB\x1b[?1049h\x1b[32mXY\x1b[?1049l');
      expect(cursor.pen.fg).toBe(red);
      expect(cursor.col).toBe(2);
    });

    it('?47h / ?47l toggle the alt screen without touching the cursor', () => {
      expect(setup('\x1b[?47h').screen.inAltScreen).toBe(true);
      expect(setup('\x1b[?47h\x1b[?47l').screen.inAltScreen).toBe(false);
    });

    it('one sequence may set several modes ("\\x1b[?1049;25h" enters alt + shows cursor)', () => {
      // Hide first, then a combined sequence that both enters the alt screen *and* re-shows
      // the cursor — proving each mode in the list is applied.
      const { screen, cursor } = setup('\x1b[?25l\x1b[?1049;25h');
      expect(screen.inAltScreen).toBe(true);
      expect(cursor.hidden).toBe(false);
    });

    it('the alt screen has no scrollback — primary history is untouched by alt output', () => {
      const screen = new Screen(20, 4);
      const cursor = makeCursor(0, 0);
      const parser = new AnsiParser();
      feed('line0', screen, cursor, parser);
      const before = screen.scrollback.nextLineId;

      feed('\x1b[?1049h', screen, cursor, parser);
      feed('a\r\nb\r\nc\r\nd\r\ne\r\nf\r\ng\r\nh', screen, cursor, parser); // floods the 4-line alt grid
      feed('\x1b[?1049l', screen, cursor, parser);

      expect(screen.scrollback.nextLineId).toBe(before); // primary buffer never grew
      expect(rowText(screen, 0)).toBe('line0');
    });

    it('resizing while in the alt screen lands the primary at the new width on exit', () => {
      const screen = new Screen(10, 4);
      const cursor = makeCursor(0, 0);
      const parser = new AnsiParser();
      feed('0123456789ABCDE', screen, cursor, parser); // wraps across two 10-col lines

      feed('\x1b[?1049h', screen, cursor, parser);
      screen.setCols(20, cursor);
      expect(screen.cols).toBe(20); // alt grid is now 20 wide

      feed('\x1b[?1049l', screen, cursor, parser);
      expect(screen.inAltScreen).toBe(false);
      expect(screen.cols).toBe(20); // primary reflowed to 20 too
      expect(rowText(screen, 0)).toBe('0123456789ABCDE'); // one line at the wider width
    });
  });
});
