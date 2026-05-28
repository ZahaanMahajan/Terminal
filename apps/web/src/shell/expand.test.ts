/**
 * expand.test.ts — variable + tilde expansion, and the literal/expandable distinction.
 */

import { describe, it, expect } from 'vitest';
import { Env } from './env';
import { expandVars, expandWord } from './expand';
import { parse } from './parser';

/** Expand the Nth word of a single-command line, given an env. */
function expandNthWord(line: string, n: number, env: Env): string {
  const cmd = parse(line).statements[0].andOr.pipelines[0].commands[0];
  return expandWord(cmd.words[n], env);
}

describe('expandVars', () => {
  const env = new Env({ USER: 'alice', HOME: '/home/alice' });
  it('expands $NAME', () => {
    expect(expandVars('hi $USER', env)).toBe('hi alice');
  });
  it('expands ${NAME}', () => {
    expect(expandVars('${USER}!', env)).toBe('alice!');
  });
  it('undefined variables expand to empty', () => {
    expect(expandVars('[$NOPE]', env)).toBe('[]');
  });
  it('$? expands to the last exit code', () => {
    env.lastExit = 3;
    expect(expandVars('code=$?', env)).toBe('code=3');
  });
  it('a bare $ with no name stays literal', () => {
    expect(expandVars('cost: $5', env)).toBe('cost: $5');
  });
  it('handles adjacent variables', () => {
    expect(expandVars('$USER$USER', env)).toBe('alicealice');
  });
});

describe('expandWord — literal vs expandable', () => {
  const env = new Env({ USER: 'alice', HOME: '/home/alice' });

  it('double-quoted text expands $VAR (the exit-criterion arg)', () => {
    expect(expandNthWord('echo "hello $USER"', 1, env)).toBe('hello alice');
  });
  it('single-quoted text does NOT expand', () => {
    expect(expandNthWord("echo 'hello $USER'", 1, env)).toBe('hello $USER');
  });
  it('an escaped dollar is literal', () => {
    expect(expandNthWord('echo \\$USER', 1, env)).toBe('$USER');
  });
  it('mixes literal and expandable parts in one word', () => {
    // foo'$USER'$USER → literal "$USER" + expandable "$USER"
    expect(expandNthWord("echo foo'$USER'$USER", 1, env)).toBe('foo$USERalice');
  });

  describe('tilde', () => {
    it('expands a leading ~ to $HOME', () => {
      expect(expandNthWord('cat ~', 1, env)).toBe('/home/alice');
      expect(expandNthWord('cat ~/notes', 1, env)).toBe('/home/alice/notes');
    });
    // KNOWN SIMPLIFICATION: the tokenizer tags both bare and double-quoted text `expandable`
    // (so `$VAR` expands in both). It can't tell them apart, so a double-quoted `"~"` also
    // expands — unlike a real shell. Single-quoted `'~'` is `literal` and correctly stays put.
    it("a single-quoted ~ is literal (not expanded)", () => {
      expect(expandNthWord("cat '~'", 1, env)).toBe('~');
    });
  });
});
