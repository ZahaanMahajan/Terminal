/**
 * shell/env.ts — the shell's environment: variables, cwd, and the last exit code.
 *
 * Deliberately tiny and mutable — builtins (`cd`, assignments) mutate it, the expander reads
 * it. `$?` is exposed via `lastExit` (and `get('?')`).
 */

export class Env {
  private readonly vars = new Map<string, string>();
  cwd: string;
  lastExit = 0;

  constructor(initial: Record<string, string> = {}, cwd: string = '/') {
    for (const [k, v] of Object.entries(initial)) this.vars.set(k, v);
    this.cwd = cwd;
  }

  /** Returns the value, '' if unset. `$?` maps to the last exit code. */
  get(name: string): string {
    if (name === '?') return String(this.lastExit);
    return this.vars.get(name) ?? '';
  }

  set(name: string, value: string): void {
    this.vars.set(name, value);
  }

  has(name: string): boolean {
    return this.vars.has(name);
  }
}
