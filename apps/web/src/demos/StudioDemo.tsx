import { useMemo, useState } from 'react';
import {
  KNOWN_PLUGINS,
  MODULES,
  compileRaw,
  moduleIds,
  type Diagnostic,
} from '../compiler';

/**
 * StudioDemo — Phase 4 capstone (step 4). A visual config builder over the compiler: toggle the
 * shell, aliases, env, plugins, options, prompt segments, and modules, and watch the generated
 * dotfiles regenerate on every change. Compilation is synchronous and re-runs via `useMemo` on
 * the config — the readout shows it well under the "< 50ms" exit-criterion budget. Diagnostics
 * (with paths) and module binary requirements are surfaced live.
 */

type Draft = {
  schemaVersion: 2;
  meta: { name: string; os: Array<'macos' | 'linux'> };
  shell: {
    kind: 'zsh' | 'bash';
    aliases: Array<{ name: string; value: string }>;
    env: Array<{ name: string; value: string }>;
    plugins: string[];
    options: string[];
  };
  prompt: { engine: 'starship'; segments: string[] } | null;
  modules: string[];
};

const SEGMENTS = [
  'directory',
  'git_branch',
  'git_status',
  'cmd_duration',
  'nodejs',
  'rust',
  'python',
  'character',
];
const COMMON_OPTIONS = ['AUTO_CD', 'HIST_IGNORE_DUPS', 'SHARE_HISTORY', 'CORRECT'];

const INITIAL: Draft = {
  schemaVersion: 2,
  meta: { name: 'my-setup', os: ['macos'] },
  shell: {
    kind: 'zsh',
    aliases: [{ name: 'gs', value: 'git status' }],
    env: [{ name: 'EDITOR', value: 'nvim' }],
    plugins: ['zsh-autosuggestions'],
    options: ['AUTO_CD'],
  },
  prompt: { engine: 'starship', segments: ['directory', 'git_branch', 'character'] },
  modules: ['git-aliases'],
};

const toggle = (arr: string[], item: string): string[] =>
  arr.includes(item) ? arr.filter((x) => x !== item) : [...arr, item];

function Chip({
  active,
  onClick,
  children,
  tone = 'violet',
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  tone?: 'violet' | 'amber';
  title?: string;
}) {
  const on =
    tone === 'amber'
      ? 'border-amber-500 bg-amber-500/10 text-amber-300'
      : 'border-violet-500 bg-violet-500/10 text-violet-300';
  return (
    <button
      onClick={onClick}
      title={title}
      className={[
        'px-2 py-0.5 rounded border text-[11px] transition-colors',
        active ? on : 'border-neutral-800 text-neutral-400 hover:border-neutral-600',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function CodeBlock({ filename, content }: { filename: string; content: string }) {
  return (
    <div className="rounded border border-neutral-800 overflow-hidden">
      <div className="bg-neutral-900 px-3 py-1 text-[11px] text-neutral-400 border-b border-neutral-800">
        {filename}
      </div>
      <pre className="bg-neutral-950 px-3 py-2 text-[11px] leading-5 overflow-x-auto">
        {content.split('\n').map((line, i) => (
          <div key={i} className={line.startsWith('#') ? 'text-neutral-600' : 'text-neutral-200'}>
            {line || ' '}
          </div>
        ))}
      </pre>
    </div>
  );
}

export function StudioDemo() {
  const [config, setConfig] = useState<Draft>(INITIAL);
  const [customPlugin, setCustomPlugin] = useState('');

  const result = useMemo(() => {
    const payload = { ...config, prompt: config.prompt ?? undefined };
    const t0 = performance.now();
    const r = compileRaw(payload);
    return { ...r, ms: performance.now() - t0 };
  }, [config]);

  // ── config updaters ──
  const setShell = (patch: Partial<Draft['shell']>) =>
    setConfig((c) => ({ ...c, shell: { ...c.shell, ...patch } }));
  const setAlias = (i: number, field: 'name' | 'value', v: string) =>
    setConfig((c) => ({
      ...c,
      shell: { ...c.shell, aliases: c.shell.aliases.map((a, j) => (j === i ? { ...a, [field]: v } : a)) },
    }));
  const setEnv = (i: number, field: 'name' | 'value', v: string) =>
    setConfig((c) => ({
      ...c,
      shell: { ...c.shell, env: c.shell.env.map((e, j) => (j === i ? { ...e, [field]: v } : e)) },
    }));

  const knownPlugins = [...KNOWN_PLUGINS].sort();
  const unknownPlugins = config.shell.plugins.filter((p) => !KNOWN_PLUGINS.has(p));
  const errors = result.diagnostics.filter((d) => d.level === 'error').length;
  const warnings = result.diagnostics.filter((d) => d.level === 'warning').length;

  return (
    <main className="flex-1 flex flex-col items-center gap-4 p-6 font-mono w-full">
      <header className="text-xs uppercase tracking-widest text-neutral-500">
        phase 4 — config compiler · step 4: live studio
      </header>

      <div className="flex flex-col lg:flex-row gap-6 w-full max-w-6xl">
        {/* ── Controls ── */}
        <section className="flex-1 flex flex-col gap-4 text-[11px]">
          <Field label="shell">
            {(['zsh', 'bash'] as const).map((k) => (
              <Chip key={k} active={config.shell.kind === k} onClick={() => setShell({ kind: k })}>
                {k}
              </Chip>
            ))}
          </Field>

          <Field label="aliases">
            <div className="flex flex-col gap-1 w-full">
              {config.shell.aliases.map((a, i) => (
                <div key={i} className="flex gap-1 items-center">
                  <input
                    value={a.name}
                    onChange={(e) => setAlias(i, 'name', e.target.value)}
                    className="w-20 bg-neutral-900 border border-neutral-800 rounded px-1 py-0.5 text-neutral-200"
                  />
                  <span className="text-neutral-600">=</span>
                  <input
                    value={a.value}
                    onChange={(e) => setAlias(i, 'value', e.target.value)}
                    className="flex-1 bg-neutral-900 border border-neutral-800 rounded px-1 py-0.5 text-neutral-200"
                  />
                  <button
                    onClick={() => setShell({ aliases: config.shell.aliases.filter((_, j) => j !== i) })}
                    className="text-neutral-600 hover:text-red-400 px-1"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                onClick={() => setShell({ aliases: [...config.shell.aliases, { name: '', value: '' }] })}
                className="self-start text-neutral-500 hover:text-violet-300"
              >
                + alias
              </button>
            </div>
          </Field>

          <Field label="env">
            <div className="flex flex-col gap-1 w-full">
              {config.shell.env.map((e, i) => (
                <div key={i} className="flex gap-1 items-center">
                  <input
                    value={e.name}
                    onChange={(ev) => setEnv(i, 'name', ev.target.value)}
                    className="w-20 bg-neutral-900 border border-neutral-800 rounded px-1 py-0.5 text-neutral-200"
                  />
                  <span className="text-neutral-600">=</span>
                  <input
                    value={e.value}
                    onChange={(ev) => setEnv(i, 'value', ev.target.value)}
                    className="flex-1 bg-neutral-900 border border-neutral-800 rounded px-1 py-0.5 text-neutral-200"
                  />
                  <button
                    onClick={() => setShell({ env: config.shell.env.filter((_, j) => j !== i) })}
                    className="text-neutral-600 hover:text-red-400 px-1"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                onClick={() => setShell({ env: [...config.shell.env, { name: '', value: '' }] })}
                className="self-start text-neutral-500 hover:text-violet-300"
              >
                + env var
              </button>
            </div>
          </Field>

          <Field label="plugins">
            <div className="flex flex-wrap gap-1 items-center">
              {knownPlugins.map((p) => (
                <Chip
                  key={p}
                  active={config.shell.plugins.includes(p)}
                  onClick={() => setShell({ plugins: toggle(config.shell.plugins, p) })}
                >
                  {p}
                </Chip>
              ))}
              {unknownPlugins.map((p) => (
                <Chip key={p} tone="amber" active onClick={() => setShell({ plugins: toggle(config.shell.plugins, p) })} title="unknown plugin">
                  {p} ×
                </Chip>
              ))}
              <input
                value={customPlugin}
                onChange={(e) => setCustomPlugin(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && customPlugin.trim()) {
                    setShell({ plugins: toggle(config.shell.plugins, customPlugin.trim()) });
                    setCustomPlugin('');
                  }
                }}
                placeholder="add+enter"
                className="w-24 bg-neutral-900 border border-neutral-800 rounded px-1 py-0.5 text-neutral-200 placeholder:text-neutral-700"
              />
            </div>
          </Field>

          <Field label="options">
            {COMMON_OPTIONS.map((o) => (
              <Chip key={o} active={config.shell.options.includes(o)} onClick={() => setShell({ options: toggle(config.shell.options, o) })}>
                {o}
              </Chip>
            ))}
          </Field>

          <Field label="prompt">
            <div className="flex flex-wrap gap-1 items-center">
              <Chip
                active={config.prompt !== null}
                onClick={() =>
                  setConfig((c) => ({
                    ...c,
                    prompt: c.prompt ? null : { engine: 'starship', segments: ['directory', 'character'] },
                  }))
                }
              >
                starship
              </Chip>
              {config.prompt &&
                SEGMENTS.map((s) => (
                  <Chip
                    key={s}
                    active={config.prompt!.segments.includes(s)}
                    onClick={() =>
                      setConfig((c) => ({
                        ...c,
                        prompt: c.prompt ? { ...c.prompt, segments: toggle(c.prompt.segments, s) } : c.prompt,
                      }))
                    }
                  >
                    {s}
                  </Chip>
                ))}
            </div>
          </Field>

          <Field label="modules">
            {moduleIds().map((id) => (
              <Chip
                key={id}
                active={config.modules.includes(id)}
                onClick={() => setConfig((c) => ({ ...c, modules: toggle(c.modules, id) }))}
                title={MODULES[id].description}
              >
                {id}
              </Chip>
            ))}
          </Field>
        </section>

        {/* ── Output ── */}
        <section className="flex-1 flex flex-col gap-3 min-w-0">
          <div className="flex flex-wrap gap-3 items-center text-[11px]">
            <span className="text-neutral-500">
              compiled in <span className="text-emerald-300">{result.ms.toFixed(2)}ms</span>
            </span>
            <span className="text-neutral-700">·</span>
            <span className={errors ? 'text-red-400' : 'text-neutral-600'}>{errors} errors</span>
            <span className={warnings ? 'text-amber-400' : 'text-neutral-600'}>{warnings} warnings</span>
            {result.requires.length > 0 && (
              <>
                <span className="text-neutral-700">·</span>
                <span className="text-neutral-500">
                  install <span className="text-cyan-300">{result.requires.join(' ')}</span>
                </span>
              </>
            )}
          </div>

          {result.diagnostics.length > 0 && (
            <div className="flex flex-col gap-0.5 text-[11px]">
              {result.diagnostics.map((d: Diagnostic, i) => (
                <div key={i} className={d.level === 'error' ? 'text-red-400' : 'text-amber-300'}>
                  {d.level === 'error' ? '✕' : '⚠'} <span className="text-violet-300">{d.path}</span> — {d.message}
                </div>
              ))}
            </div>
          )}

          {result.artifacts.map((a) => (
            <CodeBlock key={a.filename} filename={a.filename} content={a.content} />
          ))}
        </section>
      </div>

      <p className="text-xs text-neutral-500 max-w-2xl text-center leading-relaxed">
        the AST is the source of truth → migrate + validate → expand modules → lower → IR → emit.
        every toggle recompiles in well under a millisecond. add a made-up plugin to see a
        diagnostic; turn off the <code className="text-neutral-300">character</code> segment to see a lint.
      </p>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="w-16 shrink-0 text-neutral-500 pt-0.5">{label}</div>
      <div className="flex flex-wrap gap-1 items-start flex-1">{children}</div>
    </div>
  );
}
