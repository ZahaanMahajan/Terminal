/**
 * compiler/semantic.ts — Phase 4, step 3: checks beyond shape.
 *
 * zod proves the AST has the right *shape*; these checks prove it makes *sense*. They run over a
 * parsed `Setup` and return `Diagnostic`s with paths — the studio renders them next to the
 * fields. Errors don't block compilation (we still emit best-effort); they inform.
 *
 * Errors:   empty / invalid environment-variable names, empty / invalid alias names.
 * Warnings: duplicate alias / env / plugin (the later one wins), unknown plugin, and the
 *           domain-specific lint "a starship prompt with no `character` segment shows no symbol".
 */

import type { Setup } from './ast';
import type { Diagnostic } from './diagnostics';

/** Plugins the compiler recognizes; others get an "unknown plugin" warning. */
export const KNOWN_PLUGINS = new Set([
  'zsh-autosuggestions',
  'zsh-syntax-highlighting',
  'fast-syntax-highlighting',
  'zsh-completions',
  'fzf',
  'z',
  'you-should-use',
]);

const ENV_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ALIAS_NAME = /^[^\s='"`]+$/; // no whitespace, '=', or quote characters

export function validateSemantics(setup: Setup): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const { shell } = setup;

  const envSeen = new Set<string>();
  shell.env.forEach((e, i) => {
    if (e.name === '') {
      diags.push({ level: 'error', path: `shell.env.${i}.name`, message: 'empty environment variable name' });
    } else if (!ENV_IDENT.test(e.name)) {
      diags.push({ level: 'error', path: `shell.env.${i}.name`, message: `invalid environment variable name "${e.name}"` });
    }
    if (envSeen.has(e.name)) {
      diags.push({ level: 'warning', path: `shell.env.${i}.name`, message: `duplicate environment variable "${e.name}" (overrides the earlier value)` });
    }
    envSeen.add(e.name);
  });

  const aliasSeen = new Set<string>();
  shell.aliases.forEach((a, i) => {
    if (a.name === '') {
      diags.push({ level: 'error', path: `shell.aliases.${i}.name`, message: 'empty alias name' });
    } else if (!ALIAS_NAME.test(a.name)) {
      diags.push({ level: 'error', path: `shell.aliases.${i}.name`, message: `invalid alias name "${a.name}"` });
    }
    if (aliasSeen.has(a.name)) {
      diags.push({ level: 'warning', path: `shell.aliases.${i}.name`, message: `duplicate alias "${a.name}" (overrides the earlier value)` });
    }
    aliasSeen.add(a.name);
  });

  const pluginSeen = new Set<string>();
  shell.plugins.forEach((p, i) => {
    if (pluginSeen.has(p)) {
      diags.push({ level: 'warning', path: `shell.plugins.${i}`, message: `duplicate plugin "${p}"` });
    } else if (!KNOWN_PLUGINS.has(p)) {
      diags.push({ level: 'warning', path: `shell.plugins.${i}`, message: `unknown plugin "${p}" (will be sourced only if installed)` });
    }
    pluginSeen.add(p);
  });

  if (setup.prompt && !setup.prompt.segments.includes('character')) {
    diags.push({ level: 'warning', path: 'prompt.segments', message: 'prompt has no "character" segment — you won\'t see a prompt symbol' });
  }

  return diags;
}
