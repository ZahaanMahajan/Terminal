/**
 * shell/expand.ts — Phase 3, step 3: variable + tilde expansion.
 *
 * This is where the tokenizer's literal/expandable tagging finally pays off: `literal` parts
 * (single-quoted / escaped) are taken verbatim; `expandable` parts (bare / double-quoted) are
 * scanned for `$NAME`, `${NAME}`, and `$?`. Tilde (`~`, `~/…`) expands to `$HOME` only when it
 * leads the first expandable part (unquoted), matching the shell.
 *
 * Known simplifications (documented):
 *   - No word-splitting after expansion — each `Word` yields exactly one argument, even if it
 *     expands to empty or contains spaces. The exit criterion uses a quoted `"$USER"` (one arg).
 *   - Tilde doesn't distinguish bare from double-quoted: the tokenizer tags both `expandable`,
 *     so `"~"` expands like a bare `~`. A single-quoted `'~'` is `literal` and stays put.
 */

import type { Env } from './env';
import type { Word } from './parser';

/** Substitute `$NAME`, `${NAME}`, `$?` in a string. A bare `$` (no valid name) stays literal. */
export function expandVars(s: string, env: Env): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch !== '$') {
      out += ch;
      i++;
      continue;
    }
    const next = s[i + 1];
    if (next === '{') {
      const end = s.indexOf('}', i + 2);
      if (end !== -1) {
        out += env.get(s.slice(i + 2, end));
        i = end + 1;
        continue;
      }
      out += '$'; // unclosed `${` → literal $
      i++;
      continue;
    }
    if (next === '?') {
      out += String(env.lastExit);
      i += 2;
      continue;
    }
    if (next !== undefined && /[A-Za-z_]/.test(next)) {
      let j = i + 1;
      let name = '';
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) {
        name += s[j];
        j++;
      }
      out += env.get(name);
      i = j;
      continue;
    }
    out += '$'; // `$` not starting a name → literal
    i++;
  }
  return out;
}

/** Expand a word's parts into its final argument string. */
export function expandWord(word: Word, env: Env): string {
  let out = '';
  for (let idx = 0; idx < word.length; idx++) {
    const part = word[idx];
    if (part.kind === 'literal') {
      out += part.value;
      continue;
    }
    let value = part.value;
    if (idx === 0 && (value === '~' || value.startsWith('~/'))) {
      value = (env.get('HOME') || '/') + value.slice(1);
    }
    out += expandVars(value, env);
  }
  return out;
}
