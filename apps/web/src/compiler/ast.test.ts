/**
 * ast.test.ts — parseSetup: shape validation, defaults, and diagnostics.
 */

import { describe, it, expect } from 'vitest';
import { parseSetup } from './validate';
import { SCHEMA_VERSION } from './migrations';

const minimal = () => ({
  schemaVersion: SCHEMA_VERSION,
  meta: { name: 'test', os: ['macos'] },
  shell: { kind: 'zsh' },
});

describe('parseSetup — valid', () => {
  it('accepts a minimal setup and fills array defaults', () => {
    const r = parseSetup(minimal());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.setup.shell.aliases).toEqual([]);
    expect(r.setup.shell.env).toEqual([]);
    expect(r.setup.shell.plugins).toEqual([]);
    expect(r.setup.shell.options).toEqual([]);
    expect(r.setup.prompt).toBeUndefined();
  });

  it('accepts a fuller setup', () => {
    const r = parseSetup({
      schemaVersion: SCHEMA_VERSION,
      meta: { name: 'rust', os: ['macos', 'linux'] },
      shell: {
        kind: 'zsh',
        aliases: [{ name: 'gs', value: 'git status' }],
        env: [{ name: 'EDITOR', value: 'nvim' }],
        plugins: ['zsh-autosuggestions'],
        options: ['AUTO_CD'],
      },
      prompt: { engine: 'starship', segments: ['directory', 'git_branch', 'character'] },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.setup.shell.aliases[0]).toEqual({ name: 'gs', value: 'git status' });
    expect(r.setup.prompt?.segments).toContain('git_branch');
  });
});

describe('parseSetup — diagnostics', () => {
  it('reports a missing required field with its path', () => {
    const r = parseSetup({ schemaVersion: SCHEMA_VERSION, meta: { name: 'x', os: ['macos'] }, shell: {} });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.diagnostics.some((d) => d.path === 'shell.kind')).toBe(true);
  });

  it('reports a wrong enum value', () => {
    const r = parseSetup({ schemaVersion: SCHEMA_VERSION, meta: { name: 'x', os: ['macos'] }, shell: { kind: 'fish' } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.diagnostics.some((d) => d.path === 'shell.kind')).toBe(true);
  });

  it('reports a bad prompt segment with an array-indexed path', () => {
    const r = parseSetup({
      schemaVersion: SCHEMA_VERSION,
      meta: { name: 'x', os: ['macos'] },
      shell: { kind: 'bash' },
      prompt: { engine: 'starship', segments: ['directory', 'not_a_segment'] },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.diagnostics.some((d) => d.path === 'prompt.segments.1')).toBe(true);
  });

  it('rejects a non-object and labels the root', () => {
    const r = parseSetup(42);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.diagnostics[0].path).toBe('(root)');
  });
});
