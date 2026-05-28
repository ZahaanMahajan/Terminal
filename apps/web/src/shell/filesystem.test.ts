/**
 * filesystem.test.ts — path resolution + node operations on the in-memory tree.
 */

import { describe, it, expect } from 'vitest';
import { FileSystem, cloneNode, basename, dirname, splitPath } from './filesystem';

describe('path helpers', () => {
  it('splits, joins, dirname, basename', () => {
    expect(splitPath('/a/b/c')).toEqual(['a', 'b', 'c']);
    expect(splitPath('/')).toEqual([]);
    expect(dirname('/a/b/c')).toBe('/a/b');
    expect(basename('/a/b/c')).toBe('c');
  });
});

describe('FileSystem.resolvePath', () => {
  const fs = new FileSystem();
  it('keeps absolute paths', () => {
    expect(fs.resolvePath('/x/y', '/home')).toBe('/x/y');
  });
  it('joins relative onto cwd', () => {
    expect(fs.resolvePath('y/z', '/x')).toBe('/x/y/z');
  });
  it('normalizes . and ..', () => {
    expect(fs.resolvePath('./y/../z', '/x')).toBe('/x/z');
    expect(fs.resolvePath('..', '/a/b')).toBe('/a');
    expect(fs.resolvePath('../..', '/a/b')).toBe('/');
  });
});

describe('FileSystem.from + reads', () => {
  const fs = FileSystem.from({
    home: { user: { 'notes.txt': 'hi', docs: {} } },
    'readme.md': 'top',
  });
  it('builds the tree', () => {
    expect(fs.isDir('/home/user')).toBe(true);
    expect(fs.isFile('/home/user/notes.txt')).toBe(true);
    expect(fs.readFile('/home/user/notes.txt')).toBe('hi');
    expect(fs.readFile('/readme.md')).toBe('top');
  });
  it('lists directory entries sorted', () => {
    expect(fs.list('/home/user')).toEqual(['docs', 'notes.txt']);
  });
  it('returns null reading a missing or non-file path', () => {
    expect(fs.readFile('/missing')).toBeNull();
    expect(fs.readFile('/home')).toBeNull(); // a dir
    expect(fs.list('/readme.md')).toBeNull(); // a file
  });
});

describe('FileSystem mutations', () => {
  it('writeFile creates and overwrites; appendFile appends', () => {
    const fs = new FileSystem();
    expect(fs.writeFile('/a.txt', 'one')).toBe(true);
    expect(fs.readFile('/a.txt')).toBe('one');
    fs.writeFile('/a.txt', 'two');
    expect(fs.readFile('/a.txt')).toBe('two');
    fs.appendFile('/a.txt', '!');
    expect(fs.readFile('/a.txt')).toBe('two!');
  });

  it('writeFile fails when the parent does not exist', () => {
    const fs = new FileSystem();
    expect(fs.writeFile('/nope/a.txt', 'x')).toBe(false);
  });

  it('mkdir reports ok / exists / no-parent', () => {
    const fs = new FileSystem();
    expect(fs.mkdir('/d')).toBe('ok');
    expect(fs.mkdir('/d')).toBe('exists');
    expect(fs.mkdir('/x/y')).toBe('no-parent');
  });

  it('remove deletes a file or a whole subtree', () => {
    const fs = FileSystem.from({ dir: { a: '1', b: '2' } });
    expect(fs.remove('/dir/a')).toBe(true);
    expect(fs.exists('/dir/a')).toBe(false);
    expect(fs.remove('/dir')).toBe(true);
    expect(fs.exists('/dir')).toBe(false);
    expect(fs.remove('/missing')).toBe(false);
  });

  it('putNode places a node (used by cp/mv)', () => {
    const fs = FileSystem.from({ a: 'hello' });
    const node = fs.getNode('/a')!;
    expect(fs.putNode('/b', cloneNode(node))).toBe(true);
    expect(fs.readFile('/b')).toBe('hello');
  });
});

describe('cloneNode', () => {
  it('deep-clones a directory (independent copy)', () => {
    const src = FileSystem.from({ d: { f: 'x' } }).getNode('/d')!;
    const copy = cloneNode(src);
    expect(copy).toEqual(src);
    if (src.kind === 'dir' && copy.kind === 'dir') {
      copy.children.set('g', { kind: 'file', content: 'y' });
      expect(src.children.has('g')).toBe(false); // original untouched
    }
  });
});
