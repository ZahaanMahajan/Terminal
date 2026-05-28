import { useEffect, useMemo, useRef, useState } from 'react';
import {
  InputLayer,
  Keymap,
  KeyResolver,
  keysToString,
  tokensToNotation,
  type ActionId,
} from '../input';

/**
 * KeyboardDemo — Phase 2, step 2: keymap + trie + mode-aware FSM resolver.
 *
 * Live keys flow: InputLayer → KeyResolver.feed → fired actions / pending buffer. A timer
 * (owned here, not the resolver) fires staged actions on timeout. Type vim motions and watch:
 *   - single keys (hjkl/w/b/e/G) fire instantly,
 *   - prefixes (d, c, ci, g) hold the buffer pending,
 *   - dd/dw/ciw/gg complete the sequence,
 *   - <space> is *ambiguous* (bound, and a prefix of <space><space>): press once and wait to
 *     see it fire on timeout, or twice for the double-space action.
 */

/** Action id → human description (the host owns metadata; the resolver only emits ids). */
const ACTIONS: Record<ActionId, string> = {
  'cursor.left': 'move left',
  'cursor.down': 'move down',
  'cursor.up': 'move up',
  'cursor.right': 'move right',
  'word.next': 'next word',
  'word.prev': 'previous word',
  'word.end': 'end of word',
  'line.top': 'go to first line',
  'line.bottom': 'go to last line',
  'delete.line': 'delete line',
  'delete.word': 'delete word',
  'change.innerWord': 'change inner word',
  'space.single': 'single space (fires on timeout)',
  'space.double': 'double space',
};

function buildKeymap(): Keymap {
  return new Keymap()
    .bind('normal', 'h', 'cursor.left')
    .bind('normal', 'j', 'cursor.down')
    .bind('normal', 'k', 'cursor.up')
    .bind('normal', 'l', 'cursor.right')
    .bind('normal', 'w', 'word.next')
    .bind('normal', 'b', 'word.prev')
    .bind('normal', 'e', 'word.end')
    .bind('normal', 'gg', 'line.top')
    .bind('normal', 'G', 'line.bottom')
    .bind('normal', 'dd', 'delete.line')
    .bind('normal', 'dw', 'delete.word')
    .bind('normal', 'ciw', 'change.innerWord')
    // Deliberately ambiguous pair to demonstrate the timeout:
    .bind('normal', '<space>', 'space.single')
    .bind('normal', '<space><space>', 'space.double');
}

const TIMEOUT_MS = 700;
const MAX_LOG = 18;

type LogEntry = { id: number; action: ActionId; viaTimeout: boolean };

export function KeyboardDemo() {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const keymap = useMemo(buildKeymap, []);
  const [focused, setFocused] = useState(false);
  const [pending, setPending] = useState('');
  const [staged, setStaged] = useState<ActionId | null>(null);
  const [lastAction, setLastAction] = useState<ActionId | null>(null);
  const [unbound, setUnbound] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const idRef = useRef(0);

  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;

    const resolver = new KeyResolver(keymap, 'normal', TIMEOUT_MS);
    let timer: number | null = null;

    const fireActions = (actions: ActionId[], viaTimeout: boolean) => {
      if (actions.length === 0) return;
      setLog((prev) =>
        [...actions.map((a) => ({ id: idRef.current++, action: a, viaTimeout })).reverse(), ...prev].slice(0, MAX_LOG),
      );
      setLastAction(actions[actions.length - 1]);
    };

    const clearTimer = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    const input = new InputLayer({
      onKey: (key) => {
        const res = resolver.feed(key);
        fireActions(res.actions, false);
        setPending(keysToString(res.pending));
        setStaged(res.stagedAction);
        if (res.unbound.length) setUnbound(keysToString(res.unbound));
        else if (res.actions.length) setUnbound(null);

        clearTimer();
        if (res.pending.length > 0) {
          timer = window.setTimeout(() => {
            timer = null;
            fireActions(resolver.flushTimeout(), true);
            setPending('');
            setStaged(null);
          }, TIMEOUT_MS);
        }
        return true;
      },
    });
    input.attach(el);

    const onFocus = () => setFocused(true);
    const onBlur = () => {
      setFocused(false);
      clearTimer();
      resolver.reset();
      setPending('');
      setStaged(null);
    };
    el.addEventListener('focus', onFocus);
    el.addEventListener('blur', onBlur);

    return () => {
      clearTimer();
      input.detach();
      el.removeEventListener('focus', onFocus);
      el.removeEventListener('blur', onBlur);
    };
  }, [keymap]);

  const legend = useMemo(
    () =>
      keymap
        .bindings('normal')
        .map((b) => ({ notation: tokensToNotation(b.tokens), desc: ACTIONS[b.action] ?? b.action }))
        .sort((a, b) => a.notation.length - b.notation.length || a.notation.localeCompare(b.notation)),
    [keymap],
  );

  return (
    <main className="flex-1 flex flex-col items-center justify-center gap-6 p-8 font-mono">
      <header className="text-xs uppercase tracking-widest text-neutral-500">
        phase 2 — keyboard &amp; input · step 2: keymap + trie + fsm
      </header>

      <div
        ref={surfaceRef}
        tabIndex={0}
        className={[
          'w-[min(720px,92vw)] rounded-lg border p-6 outline-none transition-colors',
          focused
            ? 'border-violet-500 bg-neutral-900/70 shadow-lg shadow-violet-500/10'
            : 'border-neutral-800 bg-neutral-900/40',
        ].join(' ')}
      >
        <div className="flex items-center justify-between text-[11px] text-neutral-500 mb-4">
          <span>
            mode <span className="text-violet-300 border border-violet-700 rounded px-1">normal</span>
          </span>
          {focused ? (
            <span className="text-violet-300">● capturing</span>
          ) : (
            <span>click to focus, then type vim motions</span>
          )}
        </div>

        {/* Pending sequence buffer */}
        <div className="mb-5">
          <div className="text-[10px] uppercase tracking-widest text-neutral-600 mb-1">pending</div>
          <div className="flex items-baseline gap-3">
            <div className="text-3xl text-neutral-100 min-h-[2.5rem]">
              {pending ? (
                <span>
                  {pending}
                  <span className="text-violet-400 animate-pulse">▏</span>
                </span>
              ) : (
                <span className="text-neutral-700">—</span>
              )}
            </div>
            {staged && (
              <span className="text-[11px] text-amber-400">
                ⏳ timeout → {ACTIONS[staged] ?? staged}
              </span>
            )}
          </div>
        </div>

        {/* Last resolved action */}
        <div className="grid grid-cols-2 gap-4 mb-5">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-neutral-600 mb-1">last action</div>
            {lastAction ? (
              <div>
                <div className="text-emerald-300 text-sm">{lastAction}</div>
                <div className="text-neutral-500 text-[11px]">{ACTIONS[lastAction] ?? ''}</div>
              </div>
            ) : (
              <span className="text-neutral-700 text-sm">—</span>
            )}
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-neutral-600 mb-1">unbound</div>
            <span className={unbound ? 'text-amber-400 text-sm' : 'text-neutral-700 text-sm'}>
              {unbound ?? '—'}
            </span>
          </div>
        </div>

        {/* Fired-action log */}
        <div className="text-[10px] uppercase tracking-widest text-neutral-600 mb-2">log</div>
        <div className="flex flex-wrap gap-1.5 min-h-[2rem]">
          {log.length === 0 && <span className="text-neutral-700 text-xs">nothing fired yet</span>}
          {log.map((e) => (
            <span
              key={e.id}
              className={[
                'px-1.5 py-0.5 rounded text-xs border',
                e.viaTimeout
                  ? 'border-amber-700/60 text-amber-300'
                  : 'border-emerald-800 text-emerald-300 bg-emerald-900/20',
              ].join(' ')}
              title={e.viaTimeout ? 'fired on timeout' : 'fired on keypress'}
            >
              {e.action}
            </span>
          ))}
        </div>
      </div>

      {/* Keymap legend */}
      <div className="w-[min(720px,92vw)] grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1 text-[11px]">
        {legend.map((b) => (
          <div key={b.notation} className="flex gap-2">
            <span className="text-violet-300 w-16 shrink-0">{b.notation}</span>
            <span className="text-neutral-500 truncate">{b.desc}</span>
          </div>
        ))}
      </div>

      <p className="text-xs text-neutral-500 max-w-xl text-center leading-relaxed">
        named actions (not callbacks) resolved by a trie + FSM. prefixes hold pending; press{' '}
        <code className="text-neutral-300">space</code> once and wait to watch the{' '}
        <span className="text-amber-400">timeout</span> fire <code className="text-neutral-300">space.single</code>,
        or twice for <code className="text-neutral-300">space.double</code>.
      </p>
    </main>
  );
}
