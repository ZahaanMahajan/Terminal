/**
 * renderer/scrollback.ts — Phase 1, step 3+5: the scrollback ring buffer (now with wrap).
 *
 * The scrollback is the *history*: a fixed-capacity ring buffer of `Line`s (each a row of
 * `Cell`s of width `cols`). The Screen is a *view* of `rows` consecutive lines from this
 * buffer; scrolling moves the view, never the data.
 *
 * Step 5 adds line-wrap metadata: a `Set<number>` of *wrapped line ids*. A line with its id in
 * `wrapped` means "this line's content overflows; the next physical line continues it." A run
 * of one-or-more wrapped lines followed by a non-wrapped line constitutes a single *logical
 * line*, which is what reflow operates on (see reflow.ts).
 *
 * Why a parallel Set instead of `Line = { cells, wrap }`:
 *   - Keeps the `Cell[]` shape stable — no churn in tests or callers that iterate lines.
 *   - O(1) read/write of wrap state by stable id.
 *   - Eviction is a single `wrapped.delete(oldestId)` call before the slot is overwritten.
 *
 * Ring buffer mechanics (the lesson this step exists to teach):
 *   - Three numbers track state: `head` (index of the oldest retained line in the array),
 *     `_count` (how many lines are valid, ≤ capacity), and `_nextId` (the monotonic id of the
 *     next line to be appended).
 *   - Line ids are *absolute and monotonic*: line 0 was the very first, line N was the N+1-th,
 *     and they never change once assigned.
 *   - The oldest still-retained line has id `_nextId - _count`. Below that = evicted.
 *   - Append: write at `(head + _count) % capacity` if there's room; otherwise overwrite `head`
 *     and advance `head` by one (evicting the oldest). Always increment `_nextId`.
 */

import type { Cell } from './cell';
import { emptyCell } from './cell';

export type Line = Cell[];

/** Construct a fresh `cols`-wide line of empty cells. */
export function makeEmptyLine(
  cols: number,
  fg?: string,
  bg?: string,
): Line {
  return Array.from({ length: cols }, () => emptyCell(fg, bg));
}

export class Scrollback {
  readonly cols: number;
  readonly capacity: number;

  /** Ring buffer storage. Length === capacity; sparse until count reaches capacity. */
  private readonly lines: Array<Line | undefined>;

  /** Index in `lines` of the oldest still-retained line. */
  private head: number;

  /** Number of valid lines currently retained. Invariant: 0 ≤ _count ≤ capacity. */
  private _count: number;

  /** Monotonic id that will be assigned to the *next* appended line. */
  private _nextId: number;

  /** Ids of lines whose content wraps onto the next physical line. */
  private readonly wrapped: Set<number>;

  constructor(cols: number, capacity: number = 10000) {
    if (cols <= 0) throw new Error('Scrollback: cols must be > 0');
    if (capacity <= 0) throw new Error('Scrollback: capacity must be > 0');
    this.cols = cols;
    this.capacity = capacity;
    this.lines = new Array(capacity);
    this.head = 0;
    this._count = 0;
    this._nextId = 0;
    this.wrapped = new Set();
  }

  /** Number of lines currently retained. */
  get count(): number {
    return this._count;
  }

  /** Absolute id of the oldest still-retained line. (== nextLineId - count) */
  get oldestId(): number {
    return this._nextId - this._count;
  }

  /** Absolute id that will be assigned to the next appendLine() call. */
  get nextLineId(): number {
    return this._nextId;
  }

  /**
   * Append a fresh empty line at the bottom. Evicts the oldest if at capacity, including its
   * wrap flag. Returns the absolute id assigned to the new line.
   */
  appendLine(fg?: string, bg?: string): number {
    const line = makeEmptyLine(this.cols, fg, bg);
    if (this._count < this.capacity) {
      this.lines[(this.head + this._count) % this.capacity] = line;
      this._count++;
    } else {
      // Capacity reached. Evict oldest: drop its wrap flag, overwrite the slot, advance head.
      this.wrapped.delete(this.oldestId);
      this.lines[this.head] = line;
      this.head = (this.head + 1) % this.capacity;
    }
    return this._nextId++;
  }

  /**
   * Read a line by absolute id. Returns `null` if the line has been evicted or hasn't been
   * appended yet. The returned reference is *live*: writes to its cells mutate the buffer.
   */
  getLine(id: number): Line | null {
    if (id < this.oldestId || id >= this._nextId) return null;
    const slot = (this.head + (id - this.oldestId)) % this.capacity;
    return this.lines[slot] ?? null;
  }

  /**
   * Write a single cell into the line with the given absolute id. Silently no-ops if the
   * line has been evicted or `col` is out of range — same posture as `Screen.set()`.
   */
  setCell(id: number, col: number, cell: Cell): void {
    if (col < 0 || col >= this.cols) return;
    const line = this.getLine(id);
    if (line) line[col] = cell;
  }

  /**
   * Read a single cell. Throws `RangeError` on eviction or out-of-range col, mirroring
   * `Screen.get()`.
   */
  getCell(id: number, col: number): Cell {
    const line = this.getLine(id);
    if (!line) {
      throw new RangeError(`Scrollback.getCell(${id}, ${col}): line not present`);
    }
    if (col < 0 || col >= this.cols) {
      throw new RangeError(`Scrollback.getCell(${id}, ${col}): col out of range`);
    }
    return line[col];
  }

  /** True iff the line at `id` wraps to the next physical line. False for evicted/future ids. */
  isWrapped(id: number): boolean {
    if (id < this.oldestId || id >= this._nextId) return false;
    return this.wrapped.has(id);
  }

  /**
   * Mark the line at `id` as wrapping (true) or not (false). Silent no-op for evicted/future
   * ids — same posture as setCell.
   */
  setWrapped(id: number, wrap: boolean): void {
    if (id < this.oldestId || id >= this._nextId) return;
    if (wrap) this.wrapped.add(id);
    else this.wrapped.delete(id);
  }
}
