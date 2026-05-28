/**
 * shell/completion.ts — Phase 3, step 4: Tab completion.
 *
 * Pluggable-by-position: the first token completes from builtin names; later tokens complete as
 * filesystem paths (subdirectories supported via the `dir/base` split). `cd` is the per-command
 * specialization the doc calls for — it only offers directories.
 *
 * Returns `{ insert, candidates }`: `insert` is what to add at the cursor (the unique extension,
 * or the common prefix when several match); `candidates` is the full match list (which the REPL
 * displays when there's nothing left to insert — the classic "press Tab twice" behavior).
 */

import type { Env } from './env';
import type { FileSystem } from './filesystem';
import { builtinNames } from './builtins';

export type CompletionResult = { insert: string; candidates: string[] };

function longestCommonPrefix(strings: string[]): string {
  if (strings.length === 0) return '';
  let prefix = strings[0];
  for (const s of strings.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < s.length && prefix[i] === s[i]) i++;
    prefix = prefix.slice(0, i);
  }
  return prefix;
}

export function complete(line: string, cursor: number, fs: FileSystem, env: Env): CompletionResult {
  // The token under the cursor: back to the previous whitespace.
  let start = cursor;
  while (start > 0 && !/\s/.test(line[start - 1])) start--;
  const partial = line.slice(start, cursor);
  const isFirstToken = line.slice(0, start).trim() === '';

  if (isFirstToken) {
    const cands = builtinNames().filter((n) => n.startsWith(partial));
    return assemble(partial, cands, () => false, () => true);
  }

  // Path completion, with a dir/base split so subdirectories work.
  const cmd = line.trim().split(/\s+/)[0] ?? '';
  const slash = partial.lastIndexOf('/');
  const dirPart = slash >= 0 ? partial.slice(0, slash + 1) : '';
  const base = slash >= 0 ? partial.slice(slash + 1) : partial;
  const dirAbs = fs.resolvePath(dirPart || '.', env.cwd);

  const isDir = (name: string) => fs.isDir(fs.resolvePath(dirPart + name, env.cwd));
  let cands = (fs.list(dirAbs) ?? []).filter((e) => e.startsWith(base));
  if (cmd === 'cd') cands = cands.filter(isDir);

  return assemble(base, cands, isDir, () => false);
}

/**
 * Build the result: insert the unique extension (+ a `/` for a single dir, a space for a
 * single file/builtin) or the common-prefix extension when several match.
 */
function assemble(
  typed: string,
  cands: string[],
  isDir: (name: string) => boolean,
  isBuiltin: () => boolean,
): CompletionResult {
  if (cands.length === 0) return { insert: '', candidates: [] };
  let insert = longestCommonPrefix(cands).slice(typed.length);
  if (cands.length === 1) {
    insert += isBuiltin() ? ' ' : isDir(cands[0]) ? '/' : ' ';
  }
  return { insert, candidates: cands };
}
