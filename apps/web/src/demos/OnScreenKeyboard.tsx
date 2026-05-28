import type { Mods } from '../input';

/**
 * OnScreenKeyboard — Phase 2, step 4: a rendered keyboard that lights up held keys + modifiers.
 *
 * Pure presentational: it takes the set of currently-held key tokens (from `normalizeCode`) and
 * the live modifier flags, and highlights the matching caps. The demo owns the event listeners
 * and passes this state down — so the overlay reuses the exact `Key` token vocabulary from
 * step 1 (press the H position on any layout → the `h` cap lights up).
 */

type KeySpec = {
  /** Matches `normalizeCode` output, e.g. 'h', '1', ';', 'space', 'enter', 'bspace'. */
  token: string;
  label: string;
  /** Relative width (flex-grow units); default 1. */
  w?: number;
  /** If set, this cap lights when that modifier flag is active (left+right share a flag). */
  mod?: keyof Mods;
};

const letter = (ch: string): KeySpec => ({ token: ch, label: ch.toUpperCase() });
const sym = (ch: string): KeySpec => ({ token: ch, label: ch });

const LAYOUT: KeySpec[][] = [
  [sym('`'), sym('1'), sym('2'), sym('3'), sym('4'), sym('5'), sym('6'), sym('7'), sym('8'), sym('9'), sym('0'), sym('-'), sym('='), { token: 'bspace', label: '⌫', w: 2 }],
  [{ token: 'tab', label: 'tab', w: 1.5 }, letter('q'), letter('w'), letter('e'), letter('r'), letter('t'), letter('y'), letter('u'), letter('i'), letter('o'), letter('p'), sym('['), sym(']'), sym('\\')],
  [{ token: 'caps', label: 'caps', w: 1.75 }, letter('a'), letter('s'), letter('d'), letter('f'), letter('g'), letter('h'), letter('j'), letter('k'), letter('l'), sym(';'), sym("'"), { token: 'enter', label: '⏎', w: 2.25 }],
  [{ token: 'lshift', label: 'shift', w: 2.25, mod: 'shift' }, letter('z'), letter('x'), letter('c'), letter('v'), letter('b'), letter('n'), letter('m'), sym(','), sym('.'), sym('/'), { token: 'rshift', label: 'shift', w: 2.25, mod: 'shift' }],
  [{ token: 'lctrl', label: 'ctrl', w: 1.5, mod: 'ctrl' }, { token: 'lalt', label: 'alt', w: 1.25, mod: 'alt' }, { token: 'space', label: 'space', w: 7 }, { token: 'ralt', label: 'alt', w: 1.25, mod: 'alt' }, { token: 'rctrl', label: 'ctrl', w: 1.5, mod: 'ctrl' }],
];

export function OnScreenKeyboard({ held, mods }: { held: Set<string>; mods: Mods }) {
  return (
    <div className="w-[min(720px,92vw)] flex flex-col gap-1 select-none">
      {LAYOUT.map((row, r) => (
        <div key={r} className="flex gap-1">
          {row.map((key) => {
            const active = key.mod ? mods[key.mod] : held.has(key.token);
            return (
              <div
                key={key.token}
                style={{ flexGrow: key.w ?? 1, flexBasis: 0 }}
                className={[
                  'h-9 rounded flex items-center justify-center text-[11px] border transition-colors',
                  active
                    ? 'border-violet-400 bg-violet-500/30 text-violet-100 shadow shadow-violet-500/30'
                    : 'border-neutral-800 bg-neutral-900/60 text-neutral-400',
                ].join(' ')}
              >
                {key.label}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
