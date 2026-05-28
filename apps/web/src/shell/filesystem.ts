/**
 * shell/filesystem.ts — Phase 3, step 3: an in-memory POSIX-ish filesystem.
 *
 * A tree of dirs and files. Paths are POSIX strings ("/a/b/c"); `resolvePath` joins a relative
 * path onto a cwd and normalizes `.`/`..`. Everything is synchronous — there's no real disk, no
 * permissions, no mtimes. The point is to give the builtins something to read/write so the
 * shell feels real; persistence (IndexedDB) is a later, optional concern.
 */

export type FsFile = { kind: 'file'; content: string };
export type FsDir = { kind: 'dir'; children: Map<string, FsNode> };
export type FsNode = FsFile | FsDir;

/** Nested spec for seeding a tree: string = file content, object = directory. */
export type FsSpec = { [name: string]: string | FsSpec };

export function splitPath(p: string): string[] {
  return p.split('/').filter((s) => s.length > 0);
}
export function joinAbs(segs: string[]): string {
  return '/' + segs.join('/');
}
export function dirname(absPath: string): string {
  return joinAbs(splitPath(absPath).slice(0, -1));
}
export function basename(absPath: string): string {
  const segs = splitPath(absPath);
  return segs[segs.length - 1] ?? '';
}

/** Deep-clone a node (for `cp`). */
export function cloneNode(node: FsNode): FsNode {
  if (node.kind === 'file') return { kind: 'file', content: node.content };
  const children = new Map<string, FsNode>();
  for (const [name, child] of node.children) children.set(name, cloneNode(child));
  return { kind: 'dir', children };
}

export class FileSystem {
  private readonly root: FsDir = { kind: 'dir', children: new Map() };

  /** Seed a filesystem from a nested spec object. */
  static from(spec: FsSpec): FileSystem {
    const fs = new FileSystem();
    const build = (dir: FsDir, s: FsSpec): void => {
      for (const [name, value] of Object.entries(s)) {
        if (typeof value === 'string') {
          dir.children.set(name, { kind: 'file', content: value });
        } else {
          const child: FsDir = { kind: 'dir', children: new Map() };
          dir.children.set(name, child);
          build(child, value);
        }
      }
    };
    build(fs.root, spec);
    return fs;
  }

  /** Join `path` onto `cwd` (unless absolute) and normalize `.`/`..`. */
  resolvePath(path: string, cwd: string): string {
    const out = path.startsWith('/') ? [] : splitPath(cwd);
    for (const seg of splitPath(path)) {
      if (seg === '.') continue;
      else if (seg === '..') out.pop();
      else out.push(seg);
    }
    return joinAbs(out);
  }

  getNode(absPath: string): FsNode | null {
    let node: FsNode = this.root;
    for (const seg of splitPath(absPath)) {
      if (node.kind !== 'dir') return null;
      const child = node.children.get(seg);
      if (!child) return null;
      node = child;
    }
    return node;
  }

  exists(absPath: string): boolean {
    return this.getNode(absPath) !== null;
  }
  isDir(absPath: string): boolean {
    return this.getNode(absPath)?.kind === 'dir';
  }
  isFile(absPath: string): boolean {
    return this.getNode(absPath)?.kind === 'file';
  }

  readFile(absPath: string): string | null {
    const node = this.getNode(absPath);
    return node?.kind === 'file' ? node.content : null;
  }

  /** Create or overwrite a file. Fails if the parent isn't a dir or the target is a dir. */
  writeFile(absPath: string, content: string): boolean {
    const name = basename(absPath);
    if (!name) return false;
    const parent = this.getNode(dirname(absPath));
    if (parent?.kind !== 'dir') return false;
    if (parent.children.get(name)?.kind === 'dir') return false;
    parent.children.set(name, { kind: 'file', content });
    return true;
  }

  appendFile(absPath: string, content: string): boolean {
    return this.writeFile(absPath, (this.readFile(absPath) ?? '') + content);
  }

  mkdir(absPath: string): 'ok' | 'exists' | 'no-parent' {
    const name = basename(absPath);
    if (!name) return 'exists'; // root
    const parent = this.getNode(dirname(absPath));
    if (parent?.kind !== 'dir') return 'no-parent';
    if (parent.children.has(name)) return 'exists';
    parent.children.set(name, { kind: 'dir', children: new Map() });
    return 'ok';
  }

  /** Sorted entry names of a directory, or null if it's not a directory. */
  list(absPath: string): string[] | null {
    const node = this.getNode(absPath);
    return node?.kind === 'dir' ? [...node.children.keys()].sort() : null;
  }

  /** Remove an entry (file or whole subtree). Returns false if it doesn't exist. */
  remove(absPath: string): boolean {
    const parent = this.getNode(dirname(absPath));
    const name = basename(absPath);
    if (parent?.kind === 'dir' && parent.children.has(name)) {
      parent.children.delete(name);
      return true;
    }
    return false;
  }

  /** Place a node at a path (for cp/mv). Fails if the parent isn't a dir. */
  putNode(absPath: string, node: FsNode): boolean {
    const name = basename(absPath);
    if (!name) return false;
    const parent = this.getNode(dirname(absPath));
    if (parent?.kind !== 'dir') return false;
    parent.children.set(name, node);
    return true;
  }
}
