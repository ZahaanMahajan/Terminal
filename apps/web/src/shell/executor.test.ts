/**
 * executor.test.ts — end-to-end: parse + expand + run against a fake FS.
 *
 * Each test builds an Env + FileSystem, runs a command line, and asserts on the terminal
 * output, the exit code, and/or the resulting filesystem state.
 */

import { describe, it, expect } from 'vitest';
import { Env } from './env';
import { FileSystem } from './filesystem';
import { run } from './executor';

function shell(spec = {}, cwd = '/', vars: Record<string, string> = {}) {
  const fs = FileSystem.from(spec);
  const env = new Env({ HOME: '/home/user', ...vars }, cwd);
  return { fs, env, run: (line: string) => run(line, env, fs) };
}

describe('echo + variables', () => {
  it('echoes arguments', () => {
    const s = shell();
    expect(s.run('echo hello world')).toEqual({ output: 'hello world\n', code: 0 });
  });
  it('echo -n omits the trailing newline', () => {
    expect(shell().run('echo -n hi').output).toBe('hi');
  });
  it('expands a double-quoted variable', () => {
    const s = shell({}, '/', { USER: 'alice' });
    expect(s.run('echo "hello $USER"').output).toBe('hello alice\n');
  });
});

describe('pipelines', () => {
  it('runs the phase exit criterion end-to-end', () => {
    const s = shell({}, '/', { USER: 'world' });
    // echo "hello $USER" → "hello world\n"; tr a-z A-Z → "HELLO WORLD\n"
    expect(s.run('echo "hello $USER" | tr a-z A-Z')).toEqual({ output: 'HELLO WORLD\n', code: 0 });
  });
  it('threads stdout into the next stdin (grep over a file via cat)', () => {
    const s = shell({ data: 'apple\nbanana\ncherry\n' });
    expect(s.run('cat data | grep an').output).toBe('banana\n');
  });
  it('a three-stage pipeline', () => {
    const s = shell({ data: 'one\ntwo\nthree\n' });
    expect(s.run('cat data | grep t | wc -l').output).toBe('2\n');
  });
});

describe('redirections', () => {
  it('> writes stdout to a file (and not the terminal)', () => {
    const s = shell();
    expect(s.run('echo hi > out.txt')).toEqual({ output: '', code: 0 });
    expect(s.fs.readFile('/out.txt')).toBe('hi\n');
  });
  it('>> appends', () => {
    const s = shell({ 'log.txt': 'a\n' });
    s.run('echo b >> log.txt');
    expect(s.fs.readFile('/log.txt')).toBe('a\nb\n');
  });
  it('< reads stdin from a file', () => {
    const s = shell({ 'in.txt': 'hello\n' });
    expect(s.run('cat < in.txt').output).toBe('hello\n');
  });
  it('< on a missing file errors', () => {
    const s = shell();
    const r = s.run('cat < nope');
    expect(r.code).toBe(1);
    expect(r.output).toMatch(/No such file/);
  });
  it('a redirect-only command creates the file', () => {
    const s = shell();
    s.run('> empty.txt');
    expect(s.fs.readFile('/empty.txt')).toBe('');
  });
});

describe('filesystem builtins', () => {
  it('pwd / cd move the cwd', () => {
    const s = shell({ home: { user: {} } }, '/');
    expect(s.run('pwd').output).toBe('/\n');
    expect(s.run('cd home/user').code).toBe(0);
    expect(s.run('pwd').output).toBe('/home/user\n');
  });
  it('cd into a missing dir errors', () => {
    const s = shell();
    expect(s.run('cd /nope').code).toBe(1);
  });
  it('ls lists entries; mkdir/touch/rm mutate', () => {
    const s = shell({ a: '1', b: '2' });
    expect(s.run('ls').output).toBe('a\nb\n');
    s.run('mkdir d');
    s.run('touch d/f');
    expect(s.fs.isFile('/d/f')).toBe(true);
    s.run('rm a');
    expect(s.fs.exists('/a')).toBe(false);
    expect(s.run('rm d').code).toBe(1); // dir without -r
    expect(s.run('rm -r d').code).toBe(0);
    expect(s.fs.exists('/d')).toBe(false);
  });
  it('cp / mv copy and move files', () => {
    const s = shell({ a: 'hello' });
    s.run('cp a b');
    expect(s.fs.readFile('/b')).toBe('hello');
    s.run('mv b c');
    expect(s.fs.exists('/b')).toBe(false);
    expect(s.fs.readFile('/c')).toBe('hello');
  });
  it('which identifies builtins', () => {
    expect(shell().run('which echo').output).toBe('echo: shell builtin\n');
  });
  it('clear emits the VT clear-screen escape (ED 2 + home)', () => {
    expect(shell().run('clear')).toEqual({ output: '\x1b[2J\x1b[H', code: 0 });
  });
});

describe('and-or + sequence + exit codes', () => {
  it('&& runs the second only on success', () => {
    expect(shell().run('true && echo yes').output).toBe('yes\n');
    expect(shell().run('false && echo no').output).toBe('');
  });
  it('|| runs the second only on failure', () => {
    expect(shell().run('false || echo recovered').output).toBe('recovered\n');
    expect(shell().run('true || echo skip').output).toBe('');
  });
  it('; sequences regardless of exit code', () => {
    expect(shell().run('echo a; echo b').output).toBe('a\nb\n');
  });
  it('$? reflects the previous exit code', () => {
    expect(shell().run('false; echo $?').output).toBe('1\n');
    expect(shell().run('true; echo $?').output).toBe('0\n');
  });
});

describe('errors + assignments', () => {
  it('an unknown command is "command not found" (code 127)', () => {
    const r = shell().run('nope');
    expect(r.code).toBe(127);
    expect(r.output).toBe('nope: command not found\n');
  });
  it('a syntax error is reported, not thrown', () => {
    const r = shell().run('echo |');
    expect(r.code).toBe(2);
    expect(r.output).toMatch(/syntax error/);
  });
  it('a pure assignment sets a variable', () => {
    const s = shell();
    expect(s.run('X=42').code).toBe(0);
    expect(s.run('echo $X').output).toBe('42\n');
  });
});
