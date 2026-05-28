/**
 * shell/builtins.ts — Phase 3, step 3: the command set.
 *
 * Each builtin is `(ctx) => RunResult` — a pure-ish function that reads `stdin`, may mutate the
 * `fs`/`env`, and returns `{ stdout, stderr, code }`. This shape is the seam the planning doc
 * cares about: a real PTY-backed command (Phase 5) has the same contract (bytes in, bytes out,
 * exit code), so the executor won't need to change when we swap fake exec for real exec.
 *
 * The doc's set — cd/ls/cat/echo/pwd/mkdir/touch/rm/cp/mv/which — plus true/false (for
 * `&&`/`||`) and a few stdin filters (tr/grep/wc) so pipelines are demonstrable. `tr` makes the
 * phase exit criterion (`echo "hello $USER" | tr a-z A-Z`) actually run.
 */

import type { Env } from './env';
import type { FileSystem } from './filesystem';
import { basename, cloneNode } from './filesystem';

export type RunContext = { argv: string[]; stdin: string; env: Env; fs: FileSystem };
export type RunResult = { stdout: string; stderr: string; code: number };
export type Builtin = (ctx: RunContext) => RunResult;

const ok = (stdout = ''): RunResult => ({ stdout, stderr: '', code: 0 });
const fail = (stderr: string, code = 1): RunResult => ({
  stdout: '',
  stderr: stderr.endsWith('\n') ? stderr : stderr + '\n',
  code,
});

const flags = (argv: string[]) => argv.slice(1).filter((a) => a.startsWith('-'));
const operands = (argv: string[]) => argv.slice(1).filter((a) => !a.startsWith('-'));

const echo: Builtin = ({ argv }) => {
  let args = argv.slice(1);
  let newline = true;
  if (args[0] === '-n') {
    newline = false;
    args = args.slice(1);
  }
  return ok(args.join(' ') + (newline ? '\n' : ''));
};

const pwd: Builtin = ({ env }) => ok(env.cwd + '\n');

const cd: Builtin = ({ argv, env, fs }) => {
  const target = argv[1] || env.get('HOME') || '/';
  const abs = fs.resolvePath(target, env.cwd);
  if (!fs.exists(abs)) return fail(`cd: ${target}: No such file or directory`);
  if (!fs.isDir(abs)) return fail(`cd: ${target}: Not a directory`);
  env.cwd = abs;
  return ok();
};

const ls: Builtin = ({ argv, env, fs }) => {
  const targets = operands(argv).length ? operands(argv) : ['.'];
  let stdout = '';
  let stderr = '';
  let code = 0;
  for (const p of targets) {
    const abs = fs.resolvePath(p, env.cwd);
    if (fs.isDir(abs)) {
      if (targets.length > 1) stdout += `${p}:\n`;
      const entries = fs.list(abs)!;
      stdout += entries.map((e) => e + '\n').join('');
    } else if (fs.isFile(abs)) {
      stdout += p + '\n';
    } else {
      stderr += `ls: ${p}: No such file or directory\n`;
      code = 1;
    }
  }
  return { stdout, stderr, code };
};

const cat: Builtin = ({ argv, stdin, env, fs }) => {
  const files = operands(argv);
  if (files.length === 0) return ok(stdin); // cat with no args echoes stdin
  let stdout = '';
  let stderr = '';
  let code = 0;
  for (const f of files) {
    if (f === '-') {
      stdout += stdin;
      continue;
    }
    const content = fs.readFile(fs.resolvePath(f, env.cwd));
    if (content === null) {
      stderr += `cat: ${f}: No such file or directory\n`;
      code = 1;
    } else {
      stdout += content;
    }
  }
  return { stdout, stderr, code };
};

const mkdir: Builtin = ({ argv, env, fs }) => {
  let stderr = '';
  let code = 0;
  for (const d of operands(argv)) {
    const r = fs.mkdir(fs.resolvePath(d, env.cwd));
    if (r === 'exists') {
      stderr += `mkdir: ${d}: File exists\n`;
      code = 1;
    } else if (r === 'no-parent') {
      stderr += `mkdir: ${d}: No such file or directory\n`;
      code = 1;
    }
  }
  return { stdout: '', stderr, code };
};

const touch: Builtin = ({ argv, env, fs }) => {
  let stderr = '';
  let code = 0;
  for (const f of operands(argv)) {
    const abs = fs.resolvePath(f, env.cwd);
    if (fs.isDir(abs)) continue;
    if (!fs.isFile(abs) && !fs.writeFile(abs, '')) {
      stderr += `touch: ${f}: No such file or directory\n`;
      code = 1;
    }
  }
  return { stdout: '', stderr, code };
};

const rm: Builtin = ({ argv, env, fs }) => {
  const recursive = flags(argv).some((f) => /^-[rR]/.test(f) || f.includes('r'));
  let stderr = '';
  let code = 0;
  for (const t of operands(argv)) {
    const abs = fs.resolvePath(t, env.cwd);
    if (!fs.exists(abs)) {
      stderr += `rm: ${t}: No such file or directory\n`;
      code = 1;
    } else if (fs.isDir(abs) && !recursive) {
      stderr += `rm: ${t}: is a directory\n`;
      code = 1;
    } else {
      fs.remove(abs);
    }
  }
  return { stdout: '', stderr, code };
};

const cp: Builtin = ({ argv, env, fs }) => {
  const args = operands(argv);
  if (args.length < 2) return fail('cp: missing file operand');
  const srcAbs = fs.resolvePath(args[0], env.cwd);
  const node = fs.getNode(srcAbs);
  if (!node) return fail(`cp: ${args[0]}: No such file or directory`);
  let dstAbs = fs.resolvePath(args[1], env.cwd);
  if (fs.isDir(dstAbs)) dstAbs = fs.resolvePath(basename(srcAbs), dstAbs);
  fs.putNode(dstAbs, cloneNode(node));
  return ok();
};

const mv: Builtin = ({ argv, env, fs }) => {
  const args = operands(argv);
  if (args.length < 2) return fail('mv: missing file operand');
  const srcAbs = fs.resolvePath(args[0], env.cwd);
  const node = fs.getNode(srcAbs);
  if (!node) return fail(`mv: ${args[0]}: No such file or directory`);
  let dstAbs = fs.resolvePath(args[1], env.cwd);
  if (fs.isDir(dstAbs)) dstAbs = fs.resolvePath(basename(srcAbs), dstAbs);
  if (srcAbs === dstAbs) return ok();
  fs.putNode(dstAbs, node);
  fs.remove(srcAbs);
  return ok();
};

const which: Builtin = ({ argv }) => {
  let stdout = '';
  let stderr = '';
  let code = 0;
  for (const name of operands(argv)) {
    if (name in BUILTINS) stdout += `${name}: shell builtin\n`;
    else {
      stderr += `which: no ${name} in (builtins)\n`;
      code = 1;
    }
  }
  return { stdout, stderr, code };
};

const trueCmd: Builtin = () => ok();
const falseCmd: Builtin = () => ({ stdout: '', stderr: '', code: 1 });

// `clear` is just a program that writes the terminal's clear-screen escape to stdout (real
// `clear` emits the terminfo `clear` capability). ED 2 blanks the viewport; CUP homes the cursor.
const clear: Builtin = () => ok('\x1b[2J\x1b[H');

/** Expand `a-z` style ranges into a flat char list (for `tr`). */
function expandSet(set: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < set.length; i++) {
    if (set[i + 1] === '-' && i + 2 < set.length) {
      for (let c = set.charCodeAt(i); c <= set.charCodeAt(i + 2); c++) out.push(String.fromCharCode(c));
      i += 2;
    } else {
      out.push(set[i]);
    }
  }
  return out;
}

const tr: Builtin = ({ argv, stdin }) => {
  const sets = operands(argv);
  if (sets.length < 2) return fail('tr: missing operand');
  const from = expandSet(sets[0]);
  const to = expandSet(sets[1]);
  const map = new Map<string, string>();
  for (let i = 0; i < from.length; i++) map.set(from[i], to[Math.min(i, to.length - 1)] ?? from[i]);
  let out = '';
  for (const ch of stdin) out += map.get(ch) ?? ch;
  return ok(out);
};

/** Split text into lines, dropping the trailing newline's empty line. */
function toLines(text: string): string[] {
  const body = text.endsWith('\n') ? text.slice(0, -1) : text;
  return body.length ? body.split('\n') : [];
}

const grep: Builtin = ({ argv, stdin, env, fs }) => {
  const fl = flags(argv);
  const ops = operands(argv);
  const pattern = ops[0] ?? '';
  const invert = fl.includes('-v');
  const ignoreCase = fl.includes('-i');
  let input = stdin;
  let stderr = '';
  if (ops.length > 1) {
    input = '';
    for (const f of ops.slice(1)) {
      const c = fs.readFile(fs.resolvePath(f, env.cwd));
      if (c === null) stderr += `grep: ${f}: No such file or directory\n`;
      else input += c;
    }
  }
  const needle = ignoreCase ? pattern.toLowerCase() : pattern;
  const matched = toLines(input).filter((line) => {
    const hay = ignoreCase ? line.toLowerCase() : line;
    return hay.includes(needle) !== invert;
  });
  const stdout = matched.length ? matched.join('\n') + '\n' : '';
  return { stdout, stderr, code: matched.length ? 0 : 1 };
};

const wc: Builtin = ({ argv, stdin, env, fs }) => {
  const fl = flags(argv);
  const ops = operands(argv);
  let input = stdin;
  if (ops.length) {
    input = '';
    for (const f of ops) input += fs.readFile(fs.resolvePath(f, env.cwd)) ?? '';
  }
  const lines = (input.match(/\n/g) ?? []).length;
  const words = input.split(/\s+/).filter(Boolean).length;
  const chars = input.length;
  if (fl.includes('-l')) return ok(`${lines}\n`);
  if (fl.includes('-w')) return ok(`${words}\n`);
  if (fl.includes('-c')) return ok(`${chars}\n`);
  return ok(`${lines} ${words} ${chars}\n`);
};

export const BUILTINS: Record<string, Builtin> = {
  echo,
  pwd,
  cd,
  ls,
  cat,
  mkdir,
  touch,
  rm,
  cp,
  mv,
  which,
  clear,
  true: trueCmd,
  false: falseCmd,
  tr,
  grep,
  wc,
};

export function isBuiltin(name: string): boolean {
  return name in BUILTINS;
}

export function builtinNames(): string[] {
  return Object.keys(BUILTINS).sort();
}
