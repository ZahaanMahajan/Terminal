/**
 * tokenizer.test.ts — golden tests: input string → exact token list.
 *
 * The planning doc asks for "at least 50 golden tests" for the tokenizer. The table below is
 * the workhorse; each row is one test via `it.each`. Error cases follow.
 */

import { describe, it, expect } from 'vitest';
import { ShellError, tokenize, wordText, type OpType, type Token, type WordPart } from './tokenizer';

const lit = (value: string): WordPart => ({ kind: 'literal', value });
const exp = (value: string): WordPart => ({ kind: 'expandable', value });
const word = (...parts: WordPart[]): Token => ({ type: 'word', parts });
const op = (o: OpType): Token => ({ type: 'op', op: o });

// [description, input, expected tokens]
const CASES: Array<[string, string, Token[]]> = [
  // ── empty / whitespace ──
  ['empty', '', []],
  ['spaces only', '   ', []],
  ['mixed whitespace only', '\t \n ', []],

  // ── plain words ──
  ['single word', 'echo', [word(exp('echo'))]],
  ['two words', 'echo hi', [word(exp('echo')), word(exp('hi'))]],
  ['three words', 'a b c', [word(exp('a')), word(exp('b')), word(exp('c'))]],
  ['leading/trailing spaces', '  echo   hi  ', [word(exp('echo')), word(exp('hi'))]],
  ['tab separator', 'one\ttwo', [word(exp('one')), word(exp('two'))]],
  ['newline separator', 'one\ntwo', [word(exp('one')), word(exp('two'))]],
  ['flag-looking word', 'ls -la', [word(exp('ls')), word(exp('-la'))]],
  ['assignment looks like a word', 'PATH=/usr/bin', [word(exp('PATH=/usr/bin'))]],

  // ── single-char operators ──
  ['pipe', 'a|b', [word(exp('a')), op('|'), word(exp('b'))]],
  ['pipe spaced', 'a | b', [word(exp('a')), op('|'), word(exp('b'))]],
  ['semicolon', 'a;b', [word(exp('a')), op(';'), word(exp('b'))]],
  ['background', 'a&b', [word(exp('a')), op('&'), word(exp('b'))]],
  ['redirect in', 'a<b', [word(exp('a')), op('<'), word(exp('b'))]],
  ['redirect out', 'a>b', [word(exp('a')), op('>'), word(exp('b'))]],

  // ── two-char operators (greedy) ──
  ['or', 'a||b', [word(exp('a')), op('||'), word(exp('b'))]],
  ['and', 'a&&b', [word(exp('a')), op('&&'), word(exp('b'))]],
  ['append', 'a>>b', [word(exp('a')), op('>>'), word(exp('b'))]],
  ['append spaced', 'cmd >> log', [word(exp('cmd')), op('>>'), word(exp('log'))]],
  ['append glued', 'echo>>log', [word(exp('echo')), op('>>'), word(exp('log'))]],

  // ── pipelines / multi-op ──
  ['pipeline', 'ls | grep x', [word(exp('ls')), op('|'), word(exp('grep')), word(exp('x'))]],
  ['triple pipe', 'a|b|c', [word(exp('a')), op('|'), word(exp('b')), op('|'), word(exp('c'))]],
  [
    'logical chain',
    'true && echo ok || echo no',
    [word(exp('true')), op('&&'), word(exp('echo')), word(exp('ok')), op('||'), word(exp('echo')), word(exp('no'))],
  ],

  // ── redirections ──
  ['redirect out spaced', 'cmd > out', [word(exp('cmd')), op('>'), word(exp('out'))]],
  ['redirect in spaced', 'cmd < in', [word(exp('cmd')), op('<'), word(exp('in'))]],
  ['fd looks like a word', '2>out', [word(exp('2')), op('>'), word(exp('out'))]],

  // ── single quotes (literal) ──
  ['single-quoted word', "'hello'", [word(lit('hello'))]],
  ['single-quoted spaces', "'hello world'", [word(lit('hello world'))]],
  ['echo single-quoted', "echo 'a b'", [word(exp('echo')), word(lit('a b'))]],
  ['empty single quotes', "''", [word()]],
  ['operators literal in single quotes', "'a|b'", [word(lit('a|b'))]],
  ['dollar literal in single quotes', "'$USER'", [word(lit('$USER'))]],

  // ── double quotes (expandable) ──
  ['double-quoted word', '"hello"', [word(exp('hello'))]],
  ['double-quoted spaces', '"hello world"', [word(exp('hello world'))]],
  ['echo double-quoted', 'echo "a b"', [word(exp('echo')), word(exp('a b'))]],
  ['empty double quotes', '""', [word()]],
  ['operators literal in double quotes', '"a|b"', [word(exp('a|b'))]],
  ['dollar preserved in double quotes', '"a$B"', [word(exp('a$B'))]],
  ['the exit-criterion arg', '"hello $USER"', [word(exp('hello $USER'))]],

  // ── adjacent / mixed quoting (one word) ──
  ['bare + single', "foo'bar'", [word(exp('foo'), lit('bar'))]],
  ['bare + double merges', 'foo"bar"', [word(exp('foobar'))]],
  ['bare single bare', "a'b'c", [word(exp('a'), lit('b'), exp('c'))]],
  ['double single double', '"a"\'b\'"c"', [word(exp('a'), lit('b'), exp('c'))]],

  // ── backslash escapes (bare) ──
  ['escaped space joins a word', 'a\\ b', [word(exp('a'), lit(' '), exp('b'))]],
  ['escaped dollar is literal', '\\$USER', [word(lit('$'), exp('USER'))]],
  ['escaped pipe is literal', 'a\\|b', [word(exp('a'), lit('|'), exp('b'))]],
  ['escaped backslash', '\\\\', [word(lit('\\'))]],

  // ── backslash escapes (in double quotes) ──
  ['escaped dollar in dquotes', '"\\$"', [word(lit('$'))]],
  ['escaped backslash in dquotes', '"\\\\"', [word(lit('\\'))]],
  ['escaped quote in dquotes', '"a\\"b"', [word(exp('a'), lit('"'), exp('b'))]],
  ['non-escape backslash stays in dquotes', '"a\\tb"', [word(exp('a\\tb'))]],

  // ── variables (left for the expander) ──
  ['bare variable', 'echo $HOME', [word(exp('echo')), word(exp('$HOME'))]],
  ['braced variable', 'echo ${HOME}', [word(exp('echo')), word(exp('${HOME}'))]],

  // ── the full exit-criterion line ──
  [
    'echo "hello $USER" | tr a-z A-Z',
    'echo "hello $USER" | tr a-z A-Z',
    [word(exp('echo')), word(exp('hello $USER')), op('|'), word(exp('tr')), word(exp('a-z')), word(exp('A-Z'))],
  ],
];

describe('tokenize — golden cases', () => {
  it.each(CASES)('%s', (_desc, input, expected) => {
    expect(tokenize(input)).toEqual(expected);
  });
});

describe('tokenize — errors', () => {
  it('throws on an unterminated single quote', () => {
    expect(() => tokenize("echo 'foo")).toThrow(ShellError);
  });
  it('throws on an unterminated double quote', () => {
    expect(() => tokenize('echo "foo')).toThrow(ShellError);
  });
  it('throws on a lone opening quote', () => {
    expect(() => tokenize("'")).toThrow(ShellError);
  });
});

describe('wordText', () => {
  it('concatenates parts into raw (un-expanded) text', () => {
    const [w] = tokenize("foo'bar'baz") as [Extract<Token, { type: 'word' }>];
    expect(wordText(w)).toBe('foobarbaz');
  });
  it('reads an escaped-space word as a single string', () => {
    const [w] = tokenize('a\\ b') as [Extract<Token, { type: 'word' }>];
    expect(wordText(w)).toBe('a b');
  });
});
