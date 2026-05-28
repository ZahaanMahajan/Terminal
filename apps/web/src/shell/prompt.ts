/**
 * shell/prompt.ts — Phase 3, step 4: the prompt segment model → ANSI.
 *
 * Renders the prompt to an ANSI string for the terminal, and returns its *visible* width
 * (color codes don't advance the cursor) so the REPL can position the cursor with CHA when it
 * redraws the input line. Segments: the cwd (home shortened to `~`, in cyan) and a `❯` that's
 * green on success / red when the last command failed.
 */

import type { Env } from './env';

/** Visible column count of a string, ignoring SGR color escapes. */
export function visibleWidth(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

export function renderPrompt(env: Env): { ansi: string; width: number } {
  const home = env.get('HOME');
  let cwd = env.cwd;
  if (home && (cwd === home || cwd.startsWith(home + '/'))) {
    cwd = '~' + cwd.slice(home.length);
  }
  const arrowColor = env.lastExit === 0 ? '\x1b[32m' : '\x1b[31m';
  const ansi = `\x1b[36m${cwd}\x1b[0m ${arrowColor}❯\x1b[0m `;
  return { ansi, width: visibleWidth(ansi) };
}
