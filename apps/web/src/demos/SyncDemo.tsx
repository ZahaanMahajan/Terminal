import { useEffect, useMemo, useState } from 'react';
import { compileRaw } from '../compiler';
import {
  getMe,
  listSetups,
  getSetup,
  createSetup,
  updateSetup,
  deleteSetup,
  publishSetup,
  logout,
  loginUrl,
  ApiError,
  type Me,
  type SetupSummary,
} from '../persistence';

/**
 * SyncDemo — Phase 6 capstone. Sign in with GitHub, then save/load setups across devices via the
 * `services/api` backend. The AST you save is the Phase-4 compiler's source of truth: loading a
 * setup re-runs `compileRaw` here, so you can see the same dotfiles regenerate on another browser.
 *
 * Auth is cookie-based — login is a full-page navigation to the API; the API redirects back here
 * and `getMe()` picks up the session. Needs `services/api` running with GitHub creds (else the
 * page shows how to start it).
 */

const DEFAULT_AST = {
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

const errText = (e: unknown): string =>
  e instanceof ApiError ? `${e.status} — ${e.message}` : String(e);

type Msg = { kind: 'ok' | 'err'; text: string };

export function SyncDemo() {
  const [me, setMe] = useState<Me | null | undefined>(undefined); // undefined = checking
  const [apiDown, setApiDown] = useState(false);
  const [setups, setSetups] = useState<SetupSummary[]>([]);
  const [name, setName] = useState('my-setup');
  const [astText, setAstText] = useState(JSON.stringify(DEFAULT_AST, null, 2));
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg | null>(null);

  const refresh = async () => {
    try {
      setSetups(await listSetups());
    } catch {
      /* leave the list as-is */
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ae = params.get('auth_error');
    if (ae) {
      setMsg({ kind: 'err', text: `sign-in failed: ${ae}` });
      window.history.replaceState({}, '', window.location.pathname);
    }
    (async () => {
      try {
        const m = await getMe();
        setMe(m);
        if (m) await refresh();
      } catch {
        setApiDown(true);
        setMe(null);
      }
    })();
  }, []);

  // Re-compile the editor's AST so a loaded setup visibly produces real dotfiles.
  const compiled = useMemo(() => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(astText);
    } catch {
      return { ok: false as const, note: 'AST is not valid JSON' };
    }
    try {
      const r = compileRaw(parsed);
      const errors = r.diagnostics.filter((d) => d.level === 'error').length;
      return { ok: true as const, files: r.artifacts.map((a) => a.filename), errors };
    } catch (e) {
      return { ok: false as const, note: String(e) };
    }
  }, [astText]);

  const save = async () => {
    let ast: unknown;
    try {
      ast = JSON.parse(astText);
    } catch {
      setMsg({ kind: 'err', text: 'AST is not valid JSON' });
      return;
    }
    if (!name.trim()) {
      setMsg({ kind: 'err', text: 'name is required' });
      return;
    }
    try {
      const saved = currentId
        ? await updateSetup(currentId, { name, ast })
        : await createSetup(name, ast);
      setCurrentId(saved.id);
      setMsg({ kind: 'ok', text: currentId ? `saved "${saved.name}"` : `created "${saved.name}"` });
      await refresh();
    } catch (e) {
      setMsg({ kind: 'err', text: errText(e) });
    }
  };

  const load = async (id: string) => {
    try {
      const s = await getSetup(id);
      setAstText(JSON.stringify(s.ast, null, 2));
      setName(s.name);
      setCurrentId(s.id);
      setMsg({ kind: 'ok', text: `loaded "${s.name}"` });
    } catch (e) {
      setMsg({ kind: 'err', text: errText(e) });
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteSetup(id);
      if (currentId === id) setCurrentId(null);
      setMsg({ kind: 'ok', text: 'deleted' });
      await refresh();
    } catch (e) {
      setMsg({ kind: 'err', text: errText(e) });
    }
  };

  const publish = async (id: string) => {
    try {
      const v = await publishSetup(id);
      setMsg({ kind: 'ok', text: `published version ${v.version}` });
    } catch (e) {
      setMsg({ kind: 'err', text: errText(e) });
    }
  };

  const signOut = async () => {
    try {
      await logout();
    } finally {
      setMe(null);
      setSetups([]);
      setCurrentId(null);
    }
  };

  // ── render ──
  return (
    <main className="flex-1 flex flex-col items-center gap-4 p-6 font-mono w-full">
      <header className="text-xs uppercase tracking-widest text-neutral-500">
        phase 6 — persistence · sign in, save &amp; load across devices
      </header>

      {msg && (
        <div
          className={[
            'text-[11px] px-3 py-1 rounded border',
            msg.kind === 'ok'
              ? 'border-emerald-700 text-emerald-300 bg-emerald-500/5'
              : 'border-red-800 text-red-300 bg-red-500/5',
          ].join(' ')}
        >
          {msg.text}
        </div>
      )}

      {me === undefined && <p className="text-[11px] text-neutral-500">checking session…</p>}

      {me === null && (
        <div className="flex flex-col items-center gap-3 text-[11px] text-neutral-400 max-w-md text-center">
          {apiDown && (
            <div className="border border-amber-800 text-amber-300 bg-amber-500/5 rounded px-3 py-2">
              Can't reach the API. Start it:
              <br />
              <code className="text-neutral-200">cd services/api &amp;&amp; npm install &amp;&amp; npm start</code>
              <br />
              (with <code>GITHUB_CLIENT_ID</code> / <code>GITHUB_CLIENT_SECRET</code> set)
            </div>
          )}
          <button
            onClick={() => {
              window.location.href = loginUrl();
            }}
            className="px-3 py-1.5 rounded border border-violet-500 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20"
          >
            Sign in with GitHub
          </button>
          <p className="leading-relaxed">
            you'll be sent to GitHub, then back here. the session is a signed httpOnly cookie — no
            token ever touches this page.
          </p>
        </div>
      )}

      {me && (
        <div className="flex flex-col lg:flex-row gap-6 w-full max-w-5xl">
          {/* editor */}
          <section className="flex-1 flex flex-col gap-3 text-[11px]">
            <div className="flex items-center gap-2">
              {me.avatar_url && (
                <img src={me.avatar_url} alt="" className="w-5 h-5 rounded-full" />
              )}
              <span className="text-neutral-300">
                {me.name ?? me.login}{' '}
                <span className="text-neutral-600">@{me.login}</span>
              </span>
              <button
                onClick={signOut}
                className="ml-auto text-neutral-500 hover:text-red-400"
              >
                sign out
              </button>
            </div>

            <label className="flex items-center gap-2">
              <span className="w-12 text-neutral-500">name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="flex-1 bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-neutral-200"
              />
            </label>

            <textarea
              value={astText}
              onChange={(e) => setAstText(e.target.value)}
              spellCheck={false}
              rows={16}
              className="bg-neutral-950 border border-neutral-800 rounded px-2 py-1 text-[11px] leading-5 text-neutral-200 font-mono"
            />

            <div className="flex items-center gap-2">
              <button
                onClick={save}
                className="px-2.5 py-1 rounded border border-violet-500 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20"
              >
                {currentId ? 'save changes' : 'create setup'}
              </button>
              {currentId && (
                <button
                  onClick={() => {
                    setCurrentId(null);
                    setName('untitled');
                    setMsg({ kind: 'ok', text: 'new (unsaved) — “create setup” to store it' });
                  }}
                  className="px-2.5 py-1 rounded border border-neutral-800 text-neutral-400 hover:border-neutral-600"
                >
                  new
                </button>
              )}
              <span className="ml-auto text-neutral-500">
                {compiled.ok ? (
                  <>
                    compiles → <span className="text-emerald-300">{compiled.files.join(', ')}</span>
                    {compiled.errors > 0 && <span className="text-red-400"> · {compiled.errors} errors</span>}
                  </>
                ) : (
                  <span className="text-amber-400">{compiled.note}</span>
                )}
              </span>
            </div>
          </section>

          {/* setups list */}
          <section className="w-full lg:w-72 flex flex-col gap-2 text-[11px]">
            <div className="text-neutral-500 uppercase tracking-widest">your setups</div>
            {setups.length === 0 && <p className="text-neutral-600">none yet — save one.</p>}
            {setups.map((s) => (
              <div
                key={s.id}
                className={[
                  'rounded border px-2 py-1.5 flex flex-col gap-1',
                  s.id === currentId ? 'border-violet-700 bg-violet-500/5' : 'border-neutral-800',
                ].join(' ')}
              >
                <div className="text-neutral-200 truncate">{s.name}</div>
                <div className="text-neutral-600 text-[10px]">updated {s.updated_at}</div>
                <div className="flex gap-2">
                  <button onClick={() => load(s.id)} className="text-violet-300 hover:underline">
                    load
                  </button>
                  <button onClick={() => publish(s.id)} className="text-cyan-300 hover:underline">
                    publish
                  </button>
                  <button onClick={() => remove(s.id)} className="text-neutral-500 hover:text-red-400">
                    delete
                  </button>
                </div>
              </div>
            ))}
          </section>
        </div>
      )}

      <p className="text-xs text-neutral-500 max-w-2xl text-center leading-relaxed">
        the saved AST is the same source of truth the compiler (P4) consumes. sign in here, save a
        setup, then open this app in another browser signed in as the same user — your setups load,
        and the AST recompiles to identical dotfiles.
      </p>
    </main>
  );
}
