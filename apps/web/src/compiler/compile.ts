/**
 * compiler/compile.ts — Phase 4, step 2: the orchestrator.
 *
 * `compile(setup)` runs each target's lower → emit and collects the resulting files. The shell
 * becomes `.zshrc`/`.bashrc`; a starship prompt becomes `starship.toml`. `compileRaw(raw)` is
 * the front door for the studio: parse (migrate + validate) first, surfacing diagnostics on
 * failure, then compile.
 */

import type { Setup } from './ast';
import type { Diagnostic } from './diagnostics';
import { emitShell, emitStarship } from './emit';
import { lowerPrompt, lowerShell } from './lower';
import { applyModules } from './modules';
import { validateSemantics } from './semantic';
import { parseSetup } from './validate';

export type Artifact = { filename: string; content: string };
export type CompileResult = {
  artifacts: Artifact[];
  diagnostics: Diagnostic[];
  /** Binaries the setup's modules need installed (install hints for the user). */
  requires: string[];
};

export function compile(setup: Setup): CompileResult {
  // Semantic checks run on the user's setup (so paths point at what they wrote); module
  // expansion then produces the setup we actually lower + emit.
  const semantic = validateSemantics(setup);
  const expanded = applyModules(setup);

  const artifacts: Artifact[] = [
    {
      filename: expanded.setup.shell.kind === 'zsh' ? '.zshrc' : '.bashrc',
      content: emitShell(lowerShell(expanded.setup)),
    },
  ];

  const promptIR = lowerPrompt(expanded.setup.prompt);
  if (promptIR) {
    artifacts.push({ filename: 'starship.toml', content: emitStarship(promptIR) });
  }

  return {
    artifacts,
    diagnostics: [...semantic, ...expanded.diagnostics],
    requires: expanded.requires,
  };
}

export type CompileRawResult = CompileResult & { ok: boolean };

/** Parse raw input then compile. On a parse failure, returns `ok: false` with diagnostics. */
export function compileRaw(raw: unknown): CompileRawResult {
  const parsed = parseSetup(raw);
  if (!parsed.ok) return { ok: false, artifacts: [], diagnostics: parsed.diagnostics, requires: [] };
  return { ok: true, ...compile(parsed.setup) };
}
