/**
 * shell/line-editor.ts — Phase 3, step 4: the readline-style line buffer.
 *
 * A mutable string + a cursor index, with the editing operations a shell's line editor needs.
 * Pure logic (no DOM, no terminal) — the REPL maps keys to these methods and redraws. The
 * "kill" operations return the removed text (a real readline yanks it back with C-y; we just
 * return it so the REPL *could* implement a kill-ring later).
 */

export class LineEditor {
  text = '';
  /** Insertion point, in [0, text.length]. */
  cursor = 0;

  insert(s: string): void {
    this.text = this.text.slice(0, this.cursor) + s + this.text.slice(this.cursor);
    this.cursor += s.length;
  }

  /** Backspace — delete the char before the cursor. */
  backspace(): void {
    if (this.cursor === 0) return;
    this.text = this.text.slice(0, this.cursor - 1) + this.text.slice(this.cursor);
    this.cursor--;
  }

  /** Delete (forward) — delete the char at the cursor. */
  del(): void {
    if (this.cursor >= this.text.length) return;
    this.text = this.text.slice(0, this.cursor) + this.text.slice(this.cursor + 1);
  }

  left(): void {
    if (this.cursor > 0) this.cursor--;
  }
  right(): void {
    if (this.cursor < this.text.length) this.cursor++;
  }
  home(): void {
    this.cursor = 0;
  }
  end(): void {
    this.cursor = this.text.length;
  }

  /** C-k — kill from the cursor to end of line. */
  killToEnd(): string {
    const killed = this.text.slice(this.cursor);
    this.text = this.text.slice(0, this.cursor);
    return killed;
  }

  /** C-u — kill from start of line to the cursor. */
  killToStart(): string {
    const killed = this.text.slice(0, this.cursor);
    this.text = this.text.slice(this.cursor);
    this.cursor = 0;
    return killed;
  }

  /** C-w — delete the whitespace-delimited word before the cursor. */
  deleteWordBack(): string {
    let i = this.cursor;
    while (i > 0 && /\s/.test(this.text[i - 1])) i--; // skip trailing spaces
    while (i > 0 && !/\s/.test(this.text[i - 1])) i--; // skip the word
    const killed = this.text.slice(i, this.cursor);
    this.text = this.text.slice(0, i) + this.text.slice(this.cursor);
    this.cursor = i;
    return killed;
  }

  /** Replace the whole buffer (used by history navigation / completion). */
  set(text: string, cursor: number = text.length): void {
    this.text = text;
    this.cursor = Math.max(0, Math.min(text.length, cursor));
  }

  clear(): void {
    this.text = '';
    this.cursor = 0;
  }
}
