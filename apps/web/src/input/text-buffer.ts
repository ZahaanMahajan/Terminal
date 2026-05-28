/**
 * input/text-buffer.ts — Phase 2, step 4: the vim-motion sandbox model.
 *
 * A tiny mutable document (lines + a normal-mode cursor) with just enough vim to demonstrate
 * that the resolved *actions* drive real behaviour: hjkl, w/b/e word motions, gg/G, and the
 * dd/dw/ciw edits. It exists to close the phase's exit criterion ("run the motions correctly in
 * a sandbox text buffer"), not to be a real editor — that's a later phase.
 *
 * Word motions use vim's two-class model: a "word" is a maximal run of [A-Za-z0-9_], OR a
 * maximal run of punctuation; whitespace separates. This matches `w`/`b`/`e` for the common
 * cases. Cross-line edge cases (e.g. landing on empty lines) are approximated and documented;
 * the sample text in the demo avoids the pathological ones.
 *
 * Pure logic, no DOM — fully unit-testable.
 */

import type { ActionId } from './keymap';

export type Pos = { row: number; col: number };
export type CharClass = 'word' | 'punct' | 'space';

export function charClass(ch: string): CharClass {
  if (ch === '' || /\s/.test(ch)) return 'space';
  if (/[A-Za-z0-9_]/.test(ch)) return 'word';
  return 'punct';
}

export class TextBuffer {
  lines: string[];
  cursor: Pos;

  constructor(text: string) {
    this.lines = text.length === 0 ? [''] : text.split('\n');
    this.cursor = { row: 0, col: 0 };
  }

  get text(): string {
    return this.lines.join('\n');
  }

  /** Highest valid column on a row in normal mode (last char, or 0 for an empty line). */
  private maxCol(row: number): number {
    return Math.max(0, this.lines[row].length - 1);
  }

  /** Clamp the cursor into the document in normal-mode terms. */
  private clamp(): void {
    this.cursor.row = Math.max(0, Math.min(this.lines.length - 1, this.cursor.row));
    this.cursor.col = Math.max(0, Math.min(this.maxCol(this.cursor.row), this.cursor.col));
  }

  private cls(row: number, col: number): CharClass {
    return charClass(this.lines[row]?.[col] ?? '');
  }

  // ─── Motions ────────────────────────────────────────────────────────────────

  moveLeft(): void {
    this.cursor.col--;
    this.clamp();
  }
  moveRight(): void {
    this.cursor.col++;
    this.clamp();
  }
  moveUp(): void {
    this.cursor.row--;
    this.clamp();
  }
  moveDown(): void {
    this.cursor.row++;
    this.clamp();
  }
  gotoTop(): void {
    this.cursor = { row: 0, col: 0 };
    this.clamp();
  }
  gotoBottom(): void {
    this.cursor = { row: this.lines.length - 1, col: 0 };
    this.clamp();
  }

  /** `w` — start of the next word (across line breaks; empty lines are stops). */
  wordForward(): void {
    let { row, col } = this.cursor;
    const len = () => this.lines[row].length;
    // 1. skip the rest of the current run.
    if (col < len() && this.cls(row, col) !== 'space') {
      const start = this.cls(row, col);
      while (col < len() && this.cls(row, col) === start) col++;
    }
    // 2. skip whitespace, wrapping lines.
    for (;;) {
      if (col >= len()) {
        if (row >= this.lines.length - 1) break; // last line: stop at end
        row++;
        col = 0;
        if (this.lines[row].length === 0) break; // empty line is a landing spot
        continue;
      }
      if (this.cls(row, col) === 'space') {
        col++;
        continue;
      }
      break;
    }
    this.cursor = { row, col: Math.min(col, this.maxCol(row)) };
  }

  /** `b` — start of the previous word. */
  wordBackward(): void {
    let { row, col } = this.cursor;
    const back = (): boolean => {
      if (col > 0) {
        col--;
        return true;
      }
      if (row > 0) {
        row--;
        col = Math.max(0, this.lines[row].length - 1);
        return true;
      }
      return false;
    };
    if (!back()) {
      this.cursor = { row: 0, col: 0 };
      return;
    }
    while (this.cls(row, col) === 'space') {
      if (!back()) {
        this.cursor = { row, col };
        return;
      }
    }
    const start = this.cls(row, col);
    while (col > 0 && this.cls(row, col - 1) === start) col--;
    this.cursor = { row, col };
  }

  /** `e` — end of the current/next word. */
  wordEnd(): void {
    let { row, col } = this.cursor;
    const fwd = (): boolean => {
      if (col < this.lines[row].length - 1) {
        col++;
        return true;
      }
      if (row < this.lines.length - 1) {
        row++;
        col = 0;
        return true;
      }
      return false;
    };
    if (!fwd()) {
      this.cursor = { row, col: Math.min(col, this.maxCol(row)) };
      return;
    }
    while (this.cls(row, col) === 'space') {
      if (!fwd()) {
        this.cursor = { row, col: Math.min(col, this.maxCol(row)) };
        return;
      }
    }
    const start = this.cls(row, col);
    while (col < this.lines[row].length - 1 && this.cls(row, col + 1) === start) col++;
    this.cursor = { row, col };
  }

  // ─── Edits ──────────────────────────────────────────────────────────────────

  /** `dd` — delete the current line (or clear it if it's the only one). */
  deleteLine(): void {
    if (this.lines.length === 1) this.lines[0] = '';
    else this.lines.splice(this.cursor.row, 1);
    this.clamp();
  }

  /** `dw` — delete from the cursor to the start of the next word, on this line (simplified). */
  deleteWord(): void {
    const { row, col } = this.cursor;
    const line = this.lines[row];
    if (col >= line.length) return;
    const cls = (i: number) => charClass(line[i] ?? '');
    let end = col;
    if (cls(col) === 'space') {
      while (end < line.length && cls(end) === 'space') end++;
    } else {
      const start = cls(col);
      while (end < line.length && cls(end) === start) end++;
      while (end < line.length && cls(end) === 'space') end++;
    }
    this.lines[row] = line.slice(0, col) + line.slice(end);
    this.clamp();
  }

  /** `ciw` — delete the inner word under the cursor (real vim then enters insert; we just delete). */
  changeInnerWord(): void {
    const { row } = this.cursor;
    const line = this.lines[row];
    if (line.length === 0) return;
    const col = Math.min(this.cursor.col, line.length - 1);
    const cls = (i: number) => charClass(line[i] ?? '');
    const target = cls(col);
    let s = col;
    let e = col;
    while (s > 0 && cls(s - 1) === target) s--;
    while (e < line.length - 1 && cls(e + 1) === target) e++;
    this.lines[row] = line.slice(0, s) + line.slice(e + 1);
    this.cursor = { row, col: s };
    this.clamp();
  }
}

/**
 * Dispatch a named action onto a buffer. Returns true if the action is a buffer operation
 * (so the host knows to re-render); false for actions the sandbox doesn't model (e.g. the
 * space.* timeout-demo actions).
 */
export function applyMotion(buf: TextBuffer, action: ActionId): boolean {
  switch (action) {
    case 'cursor.left': buf.moveLeft(); return true;
    case 'cursor.down': buf.moveDown(); return true;
    case 'cursor.up': buf.moveUp(); return true;
    case 'cursor.right': buf.moveRight(); return true;
    case 'word.next': buf.wordForward(); return true;
    case 'word.prev': buf.wordBackward(); return true;
    case 'word.end': buf.wordEnd(); return true;
    case 'line.top': buf.gotoTop(); return true;
    case 'line.bottom': buf.gotoBottom(); return true;
    case 'delete.line': buf.deleteLine(); return true;
    case 'delete.word': buf.deleteWord(); return true;
    case 'change.innerWord': buf.changeInnerWord(); return true;
    default: return false;
  }
}
