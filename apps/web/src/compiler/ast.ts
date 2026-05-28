/**
 * compiler/ast.ts — Phase 4, step 1: the Config AST, defined once with zod.
 *
 * This is the *source of truth* for a setup — tool-agnostic intent, not any one tool's syntax.
 * The compiler lowers it to per-target IRs and emits real dotfiles (later steps). Defining the
 * schema with zod gives us BOTH a runtime validator (untrusted JSON in → checked, or precise
 * diagnostics out) and the static `Setup` type (via `z.infer`), from a single declaration —
 * they can never drift apart.
 *
 * "Start tiny" (per the planning doc): two shells (zsh/bash) and a starship prompt — three
 * emitter targets. The shape is deliberately small so the AST → IR → emit pipeline is
 * comprehensible end-to-end before breadth is added.
 */

import { z } from 'zod';

export const OsTarget = z.enum(['macos', 'linux']);
export type OsTarget = z.infer<typeof OsTarget>;

export const ShellKind = z.enum(['zsh', 'bash']);
export type ShellKind = z.infer<typeof ShellKind>;

export const AliasSchema = z.object({ name: z.string(), value: z.string() });
export type Alias = z.infer<typeof AliasSchema>;

export const EnvVarSchema = z.object({ name: z.string(), value: z.string() });
export type EnvVar = z.infer<typeof EnvVarSchema>;

export const ShellConfigSchema = z.object({
  kind: ShellKind,
  aliases: z.array(AliasSchema).default([]),
  env: z.array(EnvVarSchema).default([]),
  /** Plugin ids, e.g. "zsh-autosuggestions". Sourced in order by the emitter. */
  plugins: z.array(z.string()).default([]),
  /** Shell option names: `setopt` (zsh) / `shopt -s` (bash), e.g. "AUTO_CD". */
  options: z.array(z.string()).default([]),
});
export type ShellConfig = z.infer<typeof ShellConfigSchema>;

/** Starship prompt modules, rendered top-to-bottom in `format`. */
export const PromptSegment = z.enum([
  'directory',
  'git_branch',
  'git_status',
  'cmd_duration',
  'nodejs',
  'rust',
  'python',
  'character',
]);
export type PromptSegment = z.infer<typeof PromptSegment>;

export const PromptConfigSchema = z.object({
  engine: z.literal('starship'),
  segments: z.array(PromptSegment),
});
export type PromptConfig = z.infer<typeof PromptConfigSchema>;

export const MetaSchema = z.object({
  name: z.string(),
  os: z.array(OsTarget),
});
export type Meta = z.infer<typeof MetaSchema>;

export const SetupSchema = z.object({
  schemaVersion: z.number(),
  meta: MetaSchema,
  shell: ShellConfigSchema,
  prompt: PromptConfigSchema.optional(),
  /** Module ids to apply during compilation (composable `(setup)=>setup` transforms). */
  modules: z.array(z.string()).default([]),
});
export type Setup = z.infer<typeof SetupSchema>;
