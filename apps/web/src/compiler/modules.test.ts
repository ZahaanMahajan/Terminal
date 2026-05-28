/**
 * modules.test.ts — modules as composable, idempotent transforms.
 */

import { describe, it, expect } from 'vitest';
import { MODULES, applyModules, moduleIds } from './modules';
import { parseSetup } from './validate';
import type { Setup } from './ast';

function setup(over: Record<string, unknown> = {}): Setup {
  const r = parseSetup({ schemaVersion: 2, meta: { name: 't', os: ['macos'] }, shell: { kind: 'zsh' }, ...over });
  if (!r.ok) throw new Error('fixture failed to parse');
  return r.setup;
}

describe('individual modules', () => {
  it('git-aliases adds git aliases without touching the rest', () => {
    const out = MODULES['git-aliases'].apply(setup());
    expect(out.shell.aliases.map((a) => a.name)).toEqual(['gs', 'ga', 'gc', 'gco', 'gp', 'gl']);
  });

  it('fzf adds the plugin and declares the binary', () => {
    const out = MODULES['fzf'].apply(setup());
    expect(out.shell.plugins).toEqual(['fzf']);
    expect(MODULES['fzf'].requires).toEqual(['fzf']);
  });

  it('prompt-rust inserts rust before the character segment', () => {
    const out = MODULES['prompt-rust'].apply(setup({ prompt: { engine: 'starship', segments: ['directory', 'character'] } }));
    expect(out.prompt?.segments).toEqual(['directory', 'rust', 'character']);
  });

  it('prompt-rust creates a prompt when none exists', () => {
    const out = MODULES['prompt-rust'].apply(setup());
    expect(out.prompt?.segments).toEqual(['rust']);
  });
});

describe('idempotence + non-mutation', () => {
  it('applying a module twice changes nothing the second time', () => {
    const once = MODULES['git-aliases'].apply(setup());
    const twice = MODULES['git-aliases'].apply(once);
    expect(twice).toEqual(once);
  });

  it('does not mutate the input setup', () => {
    const base = setup();
    MODULES['git-aliases'].apply(base);
    expect(base.shell.aliases).toEqual([]);
  });

  it('preserves user-defined entries and appends module ones', () => {
    const base = setup({ shell: { kind: 'zsh', aliases: [{ name: 'v', value: 'nvim' }] } });
    const out = MODULES['git-aliases'].apply(base);
    expect(out.shell.aliases[0]).toEqual({ name: 'v', value: 'nvim' });
    expect(out.shell.aliases.some((a) => a.name === 'gs')).toBe(true);
  });
});

describe('applyModules', () => {
  it('folds declared modules and accumulates requires', () => {
    const r = applyModules(setup({ modules: ['git-aliases', 'fzf', 'eza'] }));
    expect(r.requires.sort()).toEqual(['eza', 'fzf']);
    expect(r.setup.shell.plugins).toContain('fzf');
    expect(r.diagnostics).toEqual([]);
  });

  it('warns on an unknown module id', () => {
    const r = applyModules(setup({ modules: ['nope'] }));
    expect(r.diagnostics).toContainEqual(expect.objectContaining({ level: 'warning', path: 'modules.0' }));
  });

  it('moduleIds lists the registry', () => {
    expect(moduleIds()).toEqual(['eza', 'fzf', 'git-aliases', 'prompt-rust']);
  });
});
