/**
 * semantic.test.ts — checks beyond shape (over a parsed Setup).
 */

import { describe, it, expect } from 'vitest';
import { validateSemantics } from './semantic';
import { parseSetup } from './validate';
import type { Setup } from './ast';

/** Parse a setup (must succeed) and return it. */
function setup(over: Record<string, unknown> = {}): Setup {
  const r = parseSetup({ schemaVersion: 2, meta: { name: 't', os: ['macos'] }, shell: { kind: 'zsh' }, ...over });
  if (!r.ok) throw new Error('fixture failed to parse');
  return r.setup;
}
const at = (over: Record<string, unknown>) => validateSemantics(setup(over));

describe('validateSemantics — clean setup', () => {
  it('reports nothing for a valid setup', () => {
    expect(
      at({
        shell: {
          kind: 'zsh',
          env: [{ name: 'EDITOR', value: 'nvim' }],
          aliases: [{ name: 'gs', value: 'git status' }],
          plugins: ['fzf'],
        },
        prompt: { engine: 'starship', segments: ['directory', 'character'] },
      }),
    ).toEqual([]);
  });
});

describe('validateSemantics — env', () => {
  it('flags an invalid env name as an error', () => {
    const d = at({ shell: { kind: 'zsh', env: [{ name: '1BAD', value: 'x' }] } });
    expect(d).toContainEqual(expect.objectContaining({ level: 'error', path: 'shell.env.0.name' }));
  });
  it('flags an empty env name', () => {
    const d = at({ shell: { kind: 'zsh', env: [{ name: '', value: 'x' }] } });
    expect(d.some((x) => x.level === 'error' && x.path === 'shell.env.0.name')).toBe(true);
  });
  it('warns on a duplicate env name', () => {
    const d = at({ shell: { kind: 'zsh', env: [{ name: 'A', value: '1' }, { name: 'A', value: '2' }] } });
    expect(d).toContainEqual(expect.objectContaining({ level: 'warning', path: 'shell.env.1.name' }));
  });
});

describe('validateSemantics — aliases', () => {
  it('flags an invalid alias name', () => {
    const d = at({ shell: { kind: 'zsh', aliases: [{ name: 'bad name', value: 'x' }] } });
    expect(d).toContainEqual(expect.objectContaining({ level: 'error', path: 'shell.aliases.0.name' }));
  });
  it('warns on a duplicate alias name', () => {
    const d = at({ shell: { kind: 'zsh', aliases: [{ name: 'g', value: '1' }, { name: 'g', value: '2' }] } });
    expect(d).toContainEqual(expect.objectContaining({ level: 'warning', path: 'shell.aliases.1.name' }));
  });
});

describe('validateSemantics — plugins', () => {
  it('warns on an unknown plugin', () => {
    const d = at({ shell: { kind: 'zsh', plugins: ['made-up-plugin'] } });
    expect(d).toContainEqual(expect.objectContaining({ level: 'warning', path: 'shell.plugins.0' }));
  });
  it('does not warn on a known plugin', () => {
    expect(at({ shell: { kind: 'zsh', plugins: ['zsh-autosuggestions'] } })).toEqual([]);
  });
  it('warns on a duplicate plugin', () => {
    const d = at({ shell: { kind: 'zsh', plugins: ['fzf', 'fzf'] } });
    expect(d).toContainEqual(expect.objectContaining({ level: 'warning', path: 'shell.plugins.1' }));
  });
});

describe('validateSemantics — prompt', () => {
  it('warns when the prompt has no character segment', () => {
    const d = at({ shell: { kind: 'zsh' }, prompt: { engine: 'starship', segments: ['directory'] } });
    expect(d).toContainEqual(expect.objectContaining({ level: 'warning', path: 'prompt.segments' }));
  });
});
