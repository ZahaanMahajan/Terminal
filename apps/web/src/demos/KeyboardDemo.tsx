import { useEffect, useRef, useState } from 'react';
import { InputLayer, isBrowserReserved, keyToString, type Key } from '../input';

/**
 * KeyboardDemo — Phase 2, step 1: the input layer + Key tokens.
 *
 * Click the surface to focus it, then type. Each keypress is captured via `event.code`
 * (physical position, layout-independent), normalized to a `Key`, and shown in canonical
 * notation. Browser-reserved combos (Cmd+…, Ctrl+W/T/N/Q/R/L) are logged but NOT trapped —
 * the input layer deliberately lets the browser act on them.
 *
 * No keymap / FSM / actions yet — that's step 2. This proves the abstraction layer:
 *   physical code  →  normalized Key  →  canonical string.
 */

type LogEntry = {
  id: number;
  token: string;
  key: Key;
  reserved: boolean;
};

const MAX_LOG = 24;

export function KeyboardDemo() {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [focused, setFocused] = useState(false);
  const [last, setLast] = useState<Key | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const idRef = useRef(0);

  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;

    const input = new InputLayer({
      onKey: (key) => {
        const reserved = isBrowserReserved(key);
        setLast(key);
        setLog((prev) =>
          [{ id: idRef.current++, token: keyToString(key), key, reserved }, ...prev].slice(0, MAX_LOG),
        );
        // Mark handled so the layer preventDefaults (except reserved combos, which it exempts).
        return true;
      },
    });
    input.attach(el);

    const onFocus = () => setFocused(true);
    const onBlur = () => setFocused(false);
    el.addEventListener('focus', onFocus);
    el.addEventListener('blur', onBlur);

    return () => {
      input.detach();
      el.removeEventListener('focus', onFocus);
      el.removeEventListener('blur', onBlur);
    };
  }, []);

  const mods = last?.mods;

  return (
    <main className="flex-1 flex flex-col items-center justify-center gap-6 p-8 font-mono">
      <header className="text-xs uppercase tracking-widest text-neutral-500">
        phase 2 — keyboard &amp; input systems · step 1: key tokens
      </header>

      <div
        ref={surfaceRef}
        tabIndex={0}
        className={[
          'w-[min(680px,90vw)] rounded-lg border p-6 outline-none transition-colors',
          focused
            ? 'border-violet-500 bg-neutral-900/70 shadow-lg shadow-violet-500/10'
            : 'border-neutral-800 bg-neutral-900/40',
        ].join(' ')}
      >
        <div className="text-[11px] text-neutral-500 mb-4">
          {focused ? (
            <span className="text-violet-300">● capturing — type any key or chord</span>
          ) : (
            <span>click here to focus, then type</span>
          )}
        </div>

        {/* Last key breakdown: physical name + modifier flags + canonical token */}
        <div className="flex items-end gap-6 mb-5">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-neutral-600">last key</div>
            <div className="text-3xl text-neutral-100 min-h-[2.5rem]">
              {last ? keyToString(last) : <span className="text-neutral-700">—</span>}
            </div>
          </div>
          <div className="text-[11px] text-neutral-400">
            <div>
              <span className="text-neutral-600">physical</span>{' '}
              <span className="text-neutral-200">{last ? last.key : '—'}</span>
            </div>
            <div className="flex gap-2 mt-1">
              {(['ctrl', 'alt', 'shift', 'meta'] as const).map((m) => (
                <span
                  key={m}
                  className={
                    mods?.[m]
                      ? 'text-emerald-300 border border-emerald-700 rounded px-1'
                      : 'text-neutral-700 border border-neutral-800 rounded px-1'
                  }
                >
                  {m}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Rolling log of recent keys */}
        <div className="text-[10px] uppercase tracking-widest text-neutral-600 mb-2">
          recent ({log.length})
        </div>
        <div className="flex flex-wrap gap-1.5 min-h-[3rem]">
          {log.length === 0 && <span className="text-neutral-700 text-xs">nothing yet</span>}
          {log.map((e) => (
            <span
              key={e.id}
              className={[
                'px-1.5 py-0.5 rounded text-xs border',
                e.reserved
                  ? 'border-amber-700/60 text-amber-400/80'
                  : 'border-neutral-700 text-neutral-200 bg-neutral-800/50',
              ].join(' ')}
              title={e.reserved ? 'browser-reserved — not trapped' : undefined}
            >
              {e.token}
            </span>
          ))}
        </div>
      </div>

      <p className="text-xs text-neutral-500 max-w-xl text-center leading-relaxed">
        captured by <code className="text-neutral-300">event.code</code> (physical position) — on
        Dvorak/Colemak the home-row keys still report <code className="text-neutral-300">hjkl</code>.
        amber chips are browser-reserved (Cmd+…, Ctrl+W/T/N/Q/R/L); we log them but never trap them.
      </p>
    </main>
  );
}
