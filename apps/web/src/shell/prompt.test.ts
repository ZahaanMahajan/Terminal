/**
 * prompt.test.ts — prompt ANSI + visible width.
 */

import { describe, it, expect } from 'vitest';
import { Env } from './env';
import { renderPrompt, visibleWidth } from './prompt';

describe('visibleWidth', () => {
  it('ignores SGR color escapes', () => {
    expect(visibleWidth('\x1b[36m~/src\x1b[0m ❯ ')).toBe('~/src ❯ '.length);
  });
});

describe('renderPrompt', () => {
  it('shortens home to ~', () => {
    const env = new Env({ HOME: '/home/you' }, '/home/you');
    const { ansi } = renderPrompt(env);
    expect(ansi).toContain('~');
    expect(ansi).not.toContain('/home/you');
  });

  it('shows a subpath under home', () => {
    const env = new Env({ HOME: '/home/you' }, '/home/you/docs');
    expect(renderPrompt(env).ansi).toContain('~/docs');
  });

  it('leaves non-home paths absolute', () => {
    const env = new Env({ HOME: '/home/you' }, '/etc');
    expect(renderPrompt(env).ansi).toContain('/etc');
  });

  it('width counts visible columns only', () => {
    const env = new Env({ HOME: '/home/you' }, '/home/you'); // cwd shows as '~'
    // '~' + ' ' + '❯' + ' ' = 4 visible columns
    expect(renderPrompt(env).width).toBe(4);
  });

  it('uses red for a failed last command, green otherwise', () => {
    const env = new Env({ HOME: '/home/you' }, '/home/you');
    expect(renderPrompt(env).ansi).toContain('\x1b[32m'); // green ok
    env.lastExit = 1;
    expect(renderPrompt(env).ansi).toContain('\x1b[31m'); // red fail
  });
});
