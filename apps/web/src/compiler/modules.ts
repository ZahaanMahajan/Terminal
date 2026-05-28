/**
 * compiler/modules.ts — Phase 4, step 3: modules as composable transforms.
 *
 * A module is a pure function `(setup) => setup` that contributes config — aliases, plugins,
 * options, prompt segments — and may declare the binaries it needs (`requires`). No registry
 * server, no marketplace, no sandbox: a module is just a function. The merge helpers are
 * *idempotent* (skip what's already present), so applying the same module twice is a no-op and
 * modules compose without creating duplicates.
 *
 * `applyModules` folds a setup's `modules: string[]` over the registry, accumulating binary
 * requirements and warning on unknown ids.
 */

import type { PromptSegment, Setup } from './ast';
import type { Diagnostic } from './diagnostics';

export type Module = {
  id: string;
  description: string;
  /** Binaries this module needs installed (surfaced as install hints, not enforced). */
  requires?: string[];
  apply: (setup: Setup) => Setup;
};

// ─── immutable, idempotent merge helpers ─────────────────────────────────────

function addAliases(s: Setup, aliases: Array<{ name: string; value: string }>): Setup {
  const have = new Set(s.shell.aliases.map((a) => a.name));
  const add = aliases.filter((a) => !have.has(a.name));
  return add.length ? { ...s, shell: { ...s.shell, aliases: [...s.shell.aliases, ...add] } } : s;
}

function addPlugins(s: Setup, ids: string[]): Setup {
  const have = new Set(s.shell.plugins);
  const add = ids.filter((id) => !have.has(id));
  return add.length ? { ...s, shell: { ...s.shell, plugins: [...s.shell.plugins, ...add] } } : s;
}

/** Ensure the prompt has these segments, inserting before `character` so the symbol stays last. */
function ensureSegments(s: Setup, segs: PromptSegment[]): Setup {
  const base = s.prompt ? s.prompt.segments : [];
  const have = new Set(base);
  const add = segs.filter((x) => !have.has(x));
  if (s.prompt && add.length === 0) return s;
  const charIdx = base.indexOf('character');
  const segments =
    charIdx >= 0 ? [...base.slice(0, charIdx), ...add, ...base.slice(charIdx)] : [...base, ...add];
  return { ...s, prompt: { engine: 'starship', segments } };
}

// ─── the modules ─────────────────────────────────────────────────────────────

const gitAliases: Module = {
  id: 'git-aliases',
  description: 'common git aliases (gs, ga, gc, …)',
  apply: (s) =>
    addAliases(s, [
      { name: 'gs', value: 'git status' },
      { name: 'ga', value: 'git add' },
      { name: 'gc', value: 'git commit' },
      { name: 'gco', value: 'git checkout' },
      { name: 'gp', value: 'git push' },
      { name: 'gl', value: 'git log --oneline --graph' },
    ]),
};

const fzf: Module = {
  id: 'fzf',
  description: 'fuzzy finder shell integration',
  requires: ['fzf'],
  apply: (s) => addPlugins(s, ['fzf']),
};

const eza: Module = {
  id: 'eza',
  description: 'modern ls (eza) aliases',
  requires: ['eza'],
  apply: (s) =>
    addAliases(s, [
      { name: 'ls', value: 'eza' },
      { name: 'll', value: 'eza -la --git' },
      { name: 'lt', value: 'eza --tree' },
    ]),
};

const promptRust: Module = {
  id: 'prompt-rust',
  description: 'add a Rust segment to the prompt',
  apply: (s) => ensureSegments(s, ['rust']),
};

export const MODULES: Record<string, Module> = {
  'git-aliases': gitAliases,
  fzf,
  eza,
  'prompt-rust': promptRust,
};

export function moduleIds(): string[] {
  return Object.keys(MODULES).sort();
}

export type ApplyModulesResult = {
  setup: Setup;
  /** Binaries the applied modules need installed. */
  requires: string[];
  diagnostics: Diagnostic[];
};

/** Fold a setup's declared modules over the registry. Pure; unknown ids become warnings. */
export function applyModules(setup: Setup): ApplyModulesResult {
  let cur = setup;
  const requires = new Set<string>();
  const diagnostics: Diagnostic[] = [];
  setup.modules.forEach((id, i) => {
    const mod = MODULES[id];
    if (!mod) {
      diagnostics.push({ level: 'warning', path: `modules.${i}`, message: `unknown module "${id}"` });
      return;
    }
    cur = mod.apply(cur);
    for (const r of mod.requires ?? []) requires.add(r);
  });
  return { setup: cur, requires: [...requires], diagnostics };
}
