/// <reference types="node" />
/**
 * compile.test.ts — golden fixtures (the soul of the compiler) + orchestration.
 *
 * Each fixture is `<name>.ast.json` (input) plus one expected file per emitted artifact
 * (`<name>.zshrc`, `<name>.starship.toml`, …). The runner parses the AST, compiles, and asserts
 * each artifact byte-for-byte against its expected file. To re-bless: run the compiler and write
 * its output back over the fixtures.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { compile, compileRaw } from './compile';
import { parseSetup } from './validate';

const read = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), 'utf8');
const readAst = (name: string): unknown => JSON.parse(read(name));

const FIXTURES: Array<{ name: string; outputs: string[] }> = [
  { name: 'minimal-zsh', outputs: ['.zshrc'] },
  { name: 'full-zsh', outputs: ['.zshrc', 'starship.toml'] },
  { name: 'minimal-bash', outputs: ['.bashrc'] },
  { name: 'with-modules', outputs: ['.zshrc'] },
];

describe('golden fixtures', () => {
  for (const fx of FIXTURES) {
    for (const out of fx.outputs) {
      it(`${fx.name} → ${out}`, () => {
        const parsed = parseSetup(readAst(`${fx.name}.ast.json`));
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        const artifact = compile(parsed.setup).artifacts.find((a) => a.filename === out);
        expect(artifact).toBeDefined();
        expect(artifact!.content).toBe(read(`${fx.name}.${out.replace(/^\./, '')}`));
      });
    }
  }
});

describe('compile — orchestration', () => {
  const setup = (over: Record<string, unknown> = {}) => {
    const r = parseSetup({
      schemaVersion: 2,
      meta: { name: 't', os: ['macos'] },
      shell: { kind: 'zsh' },
      ...over,
    });
    if (!r.ok) throw new Error('fixture setup failed to parse');
    return r.setup;
  };

  it('maps zsh → .zshrc and bash → .bashrc', () => {
    expect(compile(setup()).artifacts[0].filename).toBe('.zshrc');
    expect(compile(setup({ shell: { kind: 'bash' } })).artifacts[0].filename).toBe('.bashrc');
  });

  it('emits starship.toml only when a prompt is present', () => {
    const without = compile(setup());
    expect(without.artifacts.some((a) => a.filename === 'starship.toml')).toBe(false);
    const withPrompt = compile(setup({ prompt: { engine: 'starship', segments: ['character'] } }));
    expect(withPrompt.artifacts.some((a) => a.filename === 'starship.toml')).toBe(true);
  });

  it('is deterministic (same setup → identical output)', () => {
    const s = setup({
      shell: { kind: 'zsh', aliases: [{ name: 'a', value: 'b' }], env: [{ name: 'E', value: 'v' }] },
      prompt: { engine: 'starship', segments: ['directory', 'character'] },
    });
    expect(compile(s)).toEqual(compile(s));
  });

  it('expands modules and surfaces their binary requirements', () => {
    const r = compile(setup({ modules: ['git-aliases', 'fzf', 'eza'] }));
    expect(r.requires.sort()).toEqual(['eza', 'fzf']);
    // git-aliases + eza both contribute aliases; fzf a plugin
    const zshrc = r.artifacts[0].content;
    expect(zshrc).toContain("alias gs='git status'");
    expect(zshrc).toContain('source "$HOME/.zsh/plugins/fzf/fzf.zsh"');
  });

  it('surfaces semantic diagnostics from the user setup', () => {
    const r = compile(setup({ shell: { kind: 'zsh', aliases: [{ name: 'x', value: '1' }, { name: 'x', value: '2' }] } }));
    expect(r.diagnostics).toContainEqual(expect.objectContaining({ level: 'warning', path: 'shell.aliases.1.name' }));
  });
});

describe('compileRaw', () => {
  it('compiles valid raw input', () => {
    const r = compileRaw({ schemaVersion: 2, meta: { name: 't', os: ['macos'] }, shell: { kind: 'zsh' } });
    expect(r.ok).toBe(true);
    expect(r.artifacts[0].filename).toBe('.zshrc');
  });

  it('returns diagnostics (not artifacts) on a parse failure', () => {
    const r = compileRaw({ schemaVersion: 2, meta: { name: 't', os: ['macos'] }, shell: { kind: 'fish' } });
    expect(r.ok).toBe(false);
    expect(r.artifacts).toEqual([]);
    expect(r.diagnostics.some((d) => d.path === 'shell.kind')).toBe(true);
  });
});
