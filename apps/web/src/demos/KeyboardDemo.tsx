import { useEffect, useMemo, useRef, useState } from 'react';
import {
  InputLayer,
  Keymap,
  KeyResolver,
  TextBuffer,
  applyMotion,
  describeConflict,
  findConflicts,
  isModifierCode,
  keysToString,
  normalizeCode,
  tokensToNotation,
  type ActionId,
  type Mods,
} from '../input';
import { OnScreenKeyboard } from './OnScreenKeyboard';

/**
 * KeyboardDemo — Phase 2 capstone (step 4): keymap + FSM + conflict detector + vim-motion
 * sandbox + on-screen keyboard. Click to focus, then drive the cursor with real vim motions —
 * the resolved *actions* move and edit the buffer, and the keyboard lights up the keys you hold.
 */

const ACTIONS: Record<ActionId, string> = {
  'cursor.left': 'left (h)',
  'cursor.down': 'down (j)',
  'cursor.up': 'up (k)',
  'cursor.right': 'right (l)',
  'word.next': 'next word (w)',
  'word.prev': 'prev word (b)',
  'word.end': 'word end (e)',
  'line.top': 'first line (gg)',
  'line.bottom': 'last line (G)',
  'delete.line': 'delete line (dd)',
  'delete.word': 'delete word (dw)',
  'change.innerWord': 'change inner word (ciw)',
  'space.single': 'single space (timeout demo)',
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
    .bind('normal', '<space>', 'space.single')
    .bind('normal', '<space><space>', 'space.double');
}

const SAMPLE = [
  'the quick brown fox',
  'jumps over the lazy dog',
  'move with h j k l',
  'words with w b e',
  'edit with dd dw ciw',
].join('\n');

const TIMEOUT_MS = 700;
const MAX_LOG = 14;
const NO_MODS: Mods = { ctrl: false, alt: false, shift: false, meta: false };

type LogEntry = { id: number; action: ActionId; viaTimeout: boolean };

/** Render one buffer line, inverting the cell under the cursor. */
function CursorLine({ line, col }: { line: string; col: number }) {
  const ch = line[col] ?? ' ';
  return (
    <span className="whitespace-pre">
      {line.slice(0, col)}
      <span className="bg-violet-400 text-neutral-950">{ch === '' ? ' ' : ch}</span>
      {line.slice(col + 1)}
    </span>
  );
}

export function KeyboardDemo() {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const keymap = useMemo(buildKeymap, []);
  const bufferRef = useRef<TextBuffer | null>(null);
  bufferRef.current ??= new TextBuffer(SAMPLE);
  const buffer = bufferRef.current;

  const [, setTick] = useState(0);
  const bump = () => setTick((t) => t + 1);

  const [focused, setFocused] = useState(false);
  const [pending, setPending] = useState('');
  const [staged, setStaged] = useState<ActionId | null>(null);
  const [lastAction, setLastAction] = useState<ActionId | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [held, setHeld] = useState<Set<string>>(new Set());
  const [mods, setMods] = useState<Mods>(NO_MODS);
  const idRef = useRef(0);

  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;

    const resolver = new KeyResolver(keymap, 'normal', TIMEOUT_MS);
    let timer: number | null = null;

    const runActions = (actions: ActionId[], viaTimeout: boolean) => {
      if (actions.length === 0) return;
      let changed = false;
      for (const a of actions) if (applyMotion(buffer, a)) changed = true;
      if (changed) bump();
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
        runActions(res.actions, false);
        setPending(keysToString(res.pending));
        setStaged(res.stagedAction);
        clearTimer();
        if (res.pending.length > 0) {
          timer = window.setTimeout(() => {
            timer = null;
            runActions(resolver.flushTimeout(), true);
            setPending('');
            setStaged(null);
          }, TIMEOUT_MS);
        }
        return true;
      },
    });
    input.attach(el);

    // Raw listeners purely for the on-screen keyboard highlight (modifier-only presses too).
    const onRawDown = (e: KeyboardEvent) => {
      if (!isModifierCode(e.code)) {
        setHeld((prev) => new Set(prev).add(normalizeCode(e.code)));
      }
      setMods({ ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey });
    };
    const onRawUp = (e: KeyboardEvent) => {
      if (!isModifierCode(e.code)) {
        setHeld((prev) => {
          const next = new Set(prev);
          next.delete(normalizeCode(e.code));
          return next;
        });
      }
      setMods({ ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey });
    };
    const onFocus = () => setFocused(true);
    const onBlur = () => {
      setFocused(false);
      clearTimer();
      resolver.reset();
      setPending('');
      setStaged(null);
      setHeld(new Set());
      setMods(NO_MODS);
    };
    el.addEventListener('keydown', onRawDown);
    el.addEventListener('keyup', onRawUp);
    el.addEventListener('focus', onFocus);
    el.addEventListener('blur', onBlur);

    return () => {
      clearTimer();
      input.detach();
      el.removeEventListener('keydown', onRawDown);
      el.removeEventListener('keyup', onRawUp);
      el.removeEventListener('focus', onFocus);
      el.removeEventListener('blur', onBlur);
    };
  }, [buffer, keymap]);

  const legend = useMemo(
    () =>
      keymap
        .bindings('normal')
        .map((b) => ({ notation: tokensToNotation(b.tokens), desc: ACTIONS[b.action] ?? b.action }))
        .sort((a, b) => a.notation.length - b.notation.length || a.notation.localeCompare(b.notation)),
    [keymap],
  );
  const conflicts = useMemo(() => findConflicts(keymap, 'normal'), [keymap]);

  return (
    <main className="flex-1 flex flex-col items-center justify-center gap-5 p-6 font-mono">
      <header className="text-xs uppercase tracking-widest text-neutral-500">
        phase 2 — keyboard &amp; input · step 4: motion sandbox + on-screen keyboard
      </header>

      {/* Focusable sandbox surface */}
      <div
        ref={surfaceRef}
        tabIndex={0}
        className={[
          'w-[min(720px,92vw)] rounded-lg border p-4 outline-none transition-colors',
          focused
            ? 'border-violet-500 bg-neutral-900/70 shadow-lg shadow-violet-500/10'
            : 'border-neutral-800 bg-neutral-900/40',
        ].join(' ')}
      >
        <div className="flex items-center justify-between text-[11px] text-neutral-500 mb-3">
          <span>
            mode <span className="text-violet-300 border border-violet-700 rounded px-1">normal</span>
            {pending && (
              <span className="ml-3 text-neutral-300">
                pending <span className="text-violet-300">{pending}</span>
                <span className="text-violet-400 animate-pulse">▏</span>
                {staged && <span className="ml-2 text-amber-400">⏳ {ACTIONS[staged] ?? staged}</span>}
              </span>
            )}
          </span>
          {focused ? <span className="text-violet-300">● capturing</span> : <span>click to focus</span>}
        </div>

        {/* The text buffer with a block cursor */}
        <div className="text-sm leading-6 text-neutral-200">
          {buffer.lines.map((line, r) => (
            <div key={r} className="whitespace-pre">
              {r === buffer.cursor.row ? (
                <CursorLine line={line} col={buffer.cursor.col} />
              ) : line === '' ? (
                ' '
              ) : (
                line
              )}
            </div>
          ))}
        </div>
      </div>

      <OnScreenKeyboard held={held} mods={mods} />

      {/* Last action + conflicts */}
      <div className="w-[min(720px,92vw)] flex flex-wrap gap-x-8 gap-y-2 text-[11px]">
        <span>
          <span className="text-neutral-500">last</span>{' '}
          {lastAction ? (
            <span className="text-emerald-300">{lastAction}</span>
          ) : (
            <span className="text-neutral-700">—</span>
          )}
        </span>
        {conflicts.map((c, i) => (
          <span key={i} className="text-amber-300">
            ⚠ {describeConflict(c, TIMEOUT_MS)}
          </span>
        ))}
      </div>

      {/* Fired-action log */}
      <div className="w-[min(720px,92vw)] flex flex-wrap gap-1.5 min-h-[1.5rem]">
        {log.map((e) => (
          <span
            key={e.id}
            className={[
              'px-1.5 py-0.5 rounded text-[11px] border',
              e.viaTimeout
                ? 'border-amber-700/60 text-amber-300'
                : 'border-emerald-800 text-emerald-300 bg-emerald-900/20',
            ].join(' ')}
          >
            {e.action}
          </span>
        ))}
      </div>

      {/* Keymap legend */}
      <div className="w-[min(720px,92vw)] grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-0.5 text-[11px]">
        {legend.map((b) => (
          <div key={b.notation} className="flex gap-2">
            <span className="text-violet-300 w-14 shrink-0">{b.notation}</span>
            <span className="text-neutral-500 truncate">{b.desc}</span>
          </div>
        ))}
      </div>

      <p className="text-xs text-neutral-500 max-w-xl text-center leading-relaxed">
        every keystroke is captured by physical position, resolved through a trie + FSM into a named
        action, and applied to the buffer. the keyboard lights up what you hold; the detector warns
        that <code className="text-neutral-300">space</code> is a prefix of{' '}
        <code className="text-neutral-300">space space</code>.
      </p>
    </main>
  );
}
