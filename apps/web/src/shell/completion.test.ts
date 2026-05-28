/**
 * completion.test.ts — first-token (builtin) + path completion, incl. subdirectories and `cd`.
 */

import { describe, it, expect } from 'vitest';
import { Env } from './env';
import { FileSystem } from './filesystem';
import { complete } from './completion';

const fs = FileSystem.from({
  home: {
    you: {
      'readme.md': '',
      docs: { 'report.txt': '', 'readme.md': '' },
      downloads: {},
      notes: {},
    },
  },
});
const env = new Env({ HOME: '/home/you' }, '/home/you');

const at = (line: string) => complete(line, line.length, fs, env);

describe('complete — first token (builtins)', () => {
  it('completes a unique builtin and adds a space', () => {
    expect(at('ec')).toEqual({ insert: 'ho ', candidates: ['echo'] });
  });
  it('inserts the common prefix for several builtins', () => {
    // 'c' → cat, cd, cp → common prefix 'c' → nothing more to insert
    const r = at('c');
    expect(r.insert).toBe('');
    expect(r.candidates).toEqual(expect.arrayContaining(['cat', 'cd', 'cp']));
  });
});

describe('complete — path arguments', () => {
  it('completes a unique file and adds a space', () => {
    expect(at('cat read')).toEqual({ insert: 'me.md ', candidates: ['readme.md'] });
  });
  it('completes a unique directory and adds a slash', () => {
    expect(at('ls down')).toEqual({ insert: 'loads/', candidates: ['downloads'] });
  });
  it('inserts the common prefix when several match', () => {
    // 'do' → docs, downloads → common 'do' → nothing more
    const r = at('ls do');
    expect(r.insert).toBe('');
    expect(r.candidates.sort()).toEqual(['docs', 'downloads']);
  });
  it('completes inside a subdirectory (dir/base split)', () => {
    // docs/ contains readme.md, report.txt → 're' common prefix
    const r = at('cat docs/re');
    expect(r.candidates.sort()).toEqual(['readme.md', 'report.txt']);
    const unique = at('cat docs/rep');
    expect(unique).toEqual({ insert: 'ort.txt ', candidates: ['report.txt'] });
  });
});

describe('complete — cd offers only directories', () => {
  it('filters out files', () => {
    // at /home/you: dirs docs/downloads/notes, file readme.md
    const r = at('cd ');
    expect(r.candidates.sort()).toEqual(['docs', 'downloads', 'notes']);
    expect(r.candidates).not.toContain('readme.md');
  });
  it('completes a unique directory with a slash', () => {
    expect(at('cd not')).toEqual({ insert: 'es/', candidates: ['notes'] });
  });
});

describe('complete — no matches', () => {
  it('returns empty', () => {
    expect(at('cat zzz')).toEqual({ insert: '', candidates: [] });
  });
});
