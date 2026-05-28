/**
 * shell/executor.ts — Phase 3, step 3: walk the AST and run it.
 *
 * Synchronous, string-based "exec": a command takes a stdin string and returns a stdout string
 * (+ stderr + exit code). A pipeline threads one command's stdout into the next's stdin; a
 * redirect sends stdout to a file or pulls stdin from one; `&&`/`||` short-circuit on the exit
 * code; `;` sequences. There are no real streams — that arrives with the PTY (Phase 5), and the
 * builtin contract (bytes in → bytes out + code) is chosen so this executor won't need to change.
 *
 * `execScript` returns the combined terminal `output` (stderr always; final stdout unless
 * redirected) and the last exit `code`. `run` is the parse-then-exec convenience the REPL uses;
 * it turns a `ShellError` into a printable line rather than throwing.
 */

import { ShellError } from './tokenizer';
import { parse, type AndOr, type Command, type Pipeline, type Script } from './parser';
import type { Env } from './env';
import type { FileSystem } from './filesystem';
import { expandWord } from './expand';
import { BUILTINS } from './builtins';

export type ExecResult = { output: string; code: number };

type CommandResult = { stdout: string; stderr: string; code: number; redirectedOut: boolean };

const isAssignment = (s: string): boolean => /^[A-Za-z_][A-Za-z0-9_]*=/.test(s);

function execCommand(cmd: Command, stdin: string, env: Env, fs: FileSystem): CommandResult {
  const argv = cmd.words.map((w) => expandWord(w, env));

  // Pure assignment command (`X=1 Y=2`) — sets vars in the env, runs nothing.
  // (The `VAR=v cmd` prefix form, scoped to one command, is deferred; documented.)
  if (argv.length > 0 && cmd.redirects.length === 0 && argv.every(isAssignment)) {
    for (const a of argv) {
      const eq = a.indexOf('=');
      env.set(a.slice(0, eq), a.slice(eq + 1));
    }
    return { stdout: '', stderr: '', code: 0, redirectedOut: false };
  }

  // Redirections (last `>`/`>>` wins for stdout; `<` sets stdin).
  let inputData = stdin;
  let outFile: { path: string; append: boolean } | null = null;
  for (const r of cmd.redirects) {
    const targetName = expandWord(r.target, env);
    const abs = fs.resolvePath(targetName, env.cwd);
    if (r.op === '<') {
      const content = fs.readFile(abs);
      if (content === null) {
        return {
          stdout: '',
          stderr: `${argv[0] ?? 'shell'}: ${targetName}: No such file or directory\n`,
          code: 1,
          redirectedOut: false,
        };
      }
      inputData = content;
    } else {
      outFile = { path: abs, append: r.op === '>>' };
    }
  }

  // Redirect-only command (`> file`) — create/truncate, no command to run.
  if (argv.length === 0) {
    if (outFile) {
      if (outFile.append) fs.appendFile(outFile.path, '');
      else fs.writeFile(outFile.path, '');
    }
    return { stdout: '', stderr: '', code: 0, redirectedOut: outFile !== null };
  }

  const name = argv[0];
  const builtin = BUILTINS[name];
  const result = builtin
    ? builtin({ argv, stdin: inputData, env, fs })
    : { stdout: '', stderr: `${name}: command not found\n`, code: 127 };

  let redirectedOut = false;
  if (outFile) {
    if (outFile.append) fs.appendFile(outFile.path, result.stdout);
    else fs.writeFile(outFile.path, result.stdout);
    redirectedOut = true;
  }
  return { stdout: result.stdout, stderr: result.stderr, code: result.code, redirectedOut };
}

function execPipeline(pipeline: Pipeline, env: Env, fs: FileSystem): ExecResult {
  let output = '';
  let stdin = '';
  let code = 0;
  for (let i = 0; i < pipeline.commands.length; i++) {
    const isLast = i === pipeline.commands.length - 1;
    const r = execCommand(pipeline.commands[i], stdin, env, fs);
    output += r.stderr; // stderr always goes to the terminal
    code = r.code;
    if (isLast) {
      if (!r.redirectedOut) output += r.stdout;
    } else {
      stdin = r.redirectedOut ? '' : r.stdout; // pipe stdout → next stdin
    }
  }
  return { output, code };
}

function execAndOr(andOr: AndOr, env: Env, fs: FileSystem): ExecResult {
  const first = execPipeline(andOr.pipelines[0], env, fs);
  let output = first.output;
  let code = first.code;
  for (let i = 0; i < andOr.connectors.length; i++) {
    const shouldRun = andOr.connectors[i] === '&&' ? code === 0 : code !== 0;
    if (!shouldRun) continue; // short-circuit; code carries over
    const next = execPipeline(andOr.pipelines[i + 1], env, fs);
    output += next.output;
    code = next.code;
  }
  return { output, code };
}

export function execScript(script: Script, env: Env, fs: FileSystem): ExecResult {
  let output = '';
  let code = 0;
  for (const stmt of script.statements) {
    const r = execAndOr(stmt.andOr, env, fs);
    output += r.output;
    code = r.code;
    env.lastExit = code; // `&` background is run synchronously (simplified)
  }
  return { output, code };
}

/** Parse + execute a command line. ShellError (syntax) becomes a printable line. */
export function run(input: string, env: Env, fs: FileSystem): ExecResult {
  let script: Script;
  try {
    script = parse(input);
  } catch (e) {
    if (e instanceof ShellError) {
      env.lastExit = 2;
      return { output: `shell: ${e.message}\n`, code: 2 };
    }
    throw e;
  }
  return execScript(script, env, fs);
}
