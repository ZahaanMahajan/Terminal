/**
 * shell/history.ts — Phase 3, step 4: command history + reverse search.
 *
 * A capped list of past command lines. Up/Down walk it (stashing the in-progress draft so
 * Down past the newest restores what you were typing). `reverseSearch` powers C-r: find the
 * most recent entry containing a substring, and step further back on repeat.
 */

export type SearchHit = { index: number; line: string };

export class History {
  private readonly items: string[] = [];
  private readonly max: number;
  /** Current navigation position; null means "not navigating" (at the live draft). */
  private navIndex: number | null = null;
  /** The line being typed when navigation started, restored on Down past the newest. */
  private draft = '';

  constructor(max: number = 500) {
    this.max = max;
  }

  get all(): readonly string[] {
    return this.items;
  }

  /** Record a command (trimmed). Skips blanks and consecutive duplicates. Resets navigation. */
  add(line: string): void {
    const t = line.trim();
    this.resetNav();
    if (!t) return;
    if (this.items[this.items.length - 1] === t) return;
    this.items.push(t);
    if (this.items.length > this.max) this.items.shift();
  }

  resetNav(): void {
    this.navIndex = null;
    this.draft = '';
  }

  /** Up — older entry. `currentDraft` is stashed the first time. Returns the line, or null. */
  prev(currentDraft: string): string | null {
    if (this.items.length === 0) return null;
    if (this.navIndex === null) {
      this.draft = currentDraft;
      this.navIndex = this.items.length;
    }
    if (this.navIndex > 0) this.navIndex--;
    return this.items[this.navIndex] ?? null;
  }

  /** Down — newer entry; past the newest returns the stashed draft and ends navigation. */
  next(): string | null {
    if (this.navIndex === null) return null;
    this.navIndex++;
    if (this.navIndex >= this.items.length) {
      const d = this.draft;
      this.resetNav();
      return d;
    }
    return this.items[this.navIndex];
  }

  /** Most recent entry containing `query`, searching backward from `before` (exclusive). */
  reverseSearch(query: string, before?: number): SearchHit | null {
    const start = before ?? this.items.length;
    for (let i = start - 1; i >= 0; i--) {
      if (this.items[i].includes(query)) return { index: i, line: this.items[i] };
    }
    return null;
  }
}
