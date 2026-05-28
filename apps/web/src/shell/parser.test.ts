/**
 * parser.test.ts — input string → AST. The tokenizer's quoting is already tested; here we focus
 * on structure (commands, pipelines, redirects, and-or, sequence/background) + errors.
 */

import { describe, it, expect } from 'vitest';
import { ShellError } from './tokenizer';
import {
  parse,
  type AndOr,
  type Command,
  type Pipeline,
  type Redirect,
  type RedirectOp,
  type Script,
  type Statement,
  type Word,
} from './parser';

// Builders mirroring how the tokenizer emits bare words (all-expandable).
const W = (s: string): Word => [{ kind: 'expandable', value: s }];
const cmd = (words: string[], redirects: Redirect[] = []): Command => ({
  type: 'command',
  words: words.map(W),
  redirects,
});
const pipe = (...commands: Command[]): Pipeline => ({ type: 'pipeline', commands });
const andor = (pipelines: Pipeline[], connectors: Array<'&&' | '||'> = []): AndOr => ({
  type: 'and-or',
  pipelines,
  connectors,
});
const stmt = (a: AndOr, background = false): Statement => ({ andOr: a, background });
const script = (...statements: Statement[]): Script => ({ type: 'script', statements });
const redir = (op: RedirectOp, target: string): Redirect => ({ op, target: W(target) });

describe('parse — structure', () => {
  it('empty input → empty script', () => {
    expect(parse('')).toEqual(script());
  });

  it('a single command', () => {
    expect(parse('echo')).toEqual(script(stmt(andor([pipe(cmd(['echo']))]))));
  });

  it('a command with arguments', () => {
    expect(parse('ls -la /tmp')).toEqual(script(stmt(andor([pipe(cmd(['ls', '-la', '/tmp']))]))));
  });

  it('a two-stage pipeline', () => {
    expect(parse('a | b')).toEqual(script(stmt(andor([pipe(cmd(['a']), cmd(['b']))]))));
  });

  it('a three-stage pipeline', () => {
    expect(parse('a | b | c')).toEqual(
      script(stmt(andor([pipe(cmd(['a']), cmd(['b']), cmd(['c']))]))),
    );
  });

  it('redirections attach to their command', () => {
    expect(parse('cat > out')).toEqual(script(stmt(andor([pipe(cmd(['cat'], [redir('>', 'out')]))]))));
    expect(parse('cat >> out')).toEqual(script(stmt(andor([pipe(cmd(['cat'], [redir('>>', 'out')]))]))));
    expect(parse('sort < in')).toEqual(script(stmt(andor([pipe(cmd(['sort'], [redir('<', 'in')]))]))));
  });

  it('a redirect-only command is allowed (`> f`)', () => {
    expect(parse('> out')).toEqual(script(stmt(andor([pipe(cmd([], [redir('>', 'out')]))]))));
  });

  it('redirect within a pipeline binds to the right command', () => {
    expect(parse('cat f | wc -l > out')).toEqual(
      script(stmt(andor([pipe(cmd(['cat', 'f']), cmd(['wc', '-l'], [redir('>', 'out')]))]))),
    );
  });

  it('sequence with ;', () => {
    expect(parse('a; b')).toEqual(script(stmt(andor([pipe(cmd(['a']))])), stmt(andor([pipe(cmd(['b']))]))));
  });

  it('a trailing ; does not create an empty statement', () => {
    expect(parse('a;')).toEqual(script(stmt(andor([pipe(cmd(['a']))]))));
  });

  it('background with &', () => {
    expect(parse('a &')).toEqual(script(stmt(andor([pipe(cmd(['a']))]), true)));
  });

  it('background then foreground', () => {
    expect(parse('a & b')).toEqual(
      script(stmt(andor([pipe(cmd(['a']))]), true), stmt(andor([pipe(cmd(['b']))]))),
    );
  });

  it('&& / || build an and-or list with connectors', () => {
    expect(parse('a && b')).toEqual(script(stmt(andor([pipe(cmd(['a'])), pipe(cmd(['b']))], ['&&']))));
    expect(parse('a || b')).toEqual(script(stmt(andor([pipe(cmd(['a'])), pipe(cmd(['b']))], ['||']))));
  });

  it('chained && / || keep left-to-right order', () => {
    expect(parse('a && b || c')).toEqual(
      script(stmt(andor([pipe(cmd(['a'])), pipe(cmd(['b'])), pipe(cmd(['c']))], ['&&', '||']))),
    );
  });

  it('| binds tighter than && (pipeline inside an and-or)', () => {
    expect(parse('a | b && c')).toEqual(
      script(stmt(andor([pipe(cmd(['a']), cmd(['b'])), pipe(cmd(['c']))], ['&&']))),
    );
  });

  it('preserves a quoted word as expandable parts', () => {
    const s = parse('echo "a b"');
    const command = s.statements[0].andOr.pipelines[0].commands[0];
    expect(command.words).toEqual([[{ kind: 'expandable', value: 'echo' }], [{ kind: 'expandable', value: 'a b' }]]);
  });

  it('parses the phase exit-criterion line', () => {
    const s = parse('echo "hello $USER" | tr a-z A-Z');
    const pipeline = s.statements[0].andOr.pipelines[0];
    expect(pipeline.commands).toHaveLength(2);
    expect(pipeline.commands[0].words).toEqual([
      [{ kind: 'expandable', value: 'echo' }],
      [{ kind: 'expandable', value: 'hello $USER' }],
    ]);
    expect(pipeline.commands[1]).toEqual(cmd(['tr', 'a-z', 'A-Z']));
  });
});

describe('parse — errors', () => {
  it('throws on a leading pipe', () => {
    expect(() => parse('| a')).toThrow(ShellError);
  });
  it('throws on a dangling pipe', () => {
    expect(() => parse('a |')).toThrow(ShellError);
  });
  it('throws on a redirect with no filename', () => {
    expect(() => parse('cat >')).toThrow(ShellError);
  });
  it('throws on a lone semicolon', () => {
    expect(() => parse(';')).toThrow(ShellError);
  });
  it('throws on a doubled separator', () => {
    expect(() => parse('a ; ; b')).toThrow(ShellError);
  });
  it('throws on a dangling &&', () => {
    expect(() => parse('a &&')).toThrow(ShellError);
  });
});
