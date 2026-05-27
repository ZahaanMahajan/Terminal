/**
 * renderer/ansi/parser.ts — Phase 1, step 6: Paul Williams's VT100/ECMA-48 parser.
 *
 * A finite state machine over a stream of code points that emits a sequence of typed
 * `Action`s. The state diagram is the canonical one from <https://vt100.net/emu/dec_ansi_parser>.
 *
 * States we implement (subset that covers what real terminals produce in practice):
 *
 *     GROUND               printing characters + C0 controls
 *     ESCAPE               saw ESC (0x1B); waiting for the rest of the sequence
 *     ESCAPE_INTERMEDIATE  collecting intermediate bytes (0x20–0x2F)
 *     CSI_ENTRY            saw '[' after ESC
 *     CSI_PARAM            collecting digits 0–9 and ';' separators
 *     CSI_INTERMEDIATE     collecting intermediate bytes after params
 *     CSI_IGNORE           malformed CSI — skip to the final byte
 *     OSC_STRING           operating-system command; we consume until BEL/ST and ignore content
 *
 * (DCS, SOS, PM, APC are intentionally not modeled.)
 *
 * Anywhere transitions:
 *   - 0x18 CAN, 0x1A SUB → return to GROUND, emit `execute`
 *   - 0x1B ESC           → ESCAPE (reset accumulators)
 *
 * Stream safety: state + accumulators persist across `parse()` calls, so feeding
 * `"AB\x1b[3"` followed by `"1mCD"` produces the same actions as feeding the full string at
 * once. This is the whole point of a state machine.
 */

/** One unit of work emitted by the parser. The interpreter (interpret.ts) applies it. */
export type Action =
  | { type: 'print'; char: string }
  | { type: 'execute'; code: number }
  | {
    type: 'csi';
    /** The final byte (a single character) that dispatched this CSI. */
    final: string;
    /** Numeric parameters in order. Empty params are pushed as 0. */
    params: number[];
    /** Intermediate bytes between params and final (0x20–0x2F). Rare. */
    intermediate: string;
    /** Private-marker prefix immediately after CSI (`<`, `=`, `>`, `?`). */
    prefix: string;
  }
  | { type: 'esc'; final: string; intermediate: string };

// We use a const object + union type instead of `enum` because tsconfig has
// `erasableSyntaxOnly: true` (enums emit runtime code; const objects don't).
const STATE = {
  Ground: 0,
  Escape: 1,
  EscapeIntermediate: 2,
  CsiEntry: 3,
  CsiParam: 4,
  CsiIntermediate: 5,
  CsiIgnore: 6,
  OscString: 7,
} as const;
type State = (typeof STATE)[keyof typeof STATE];

export class AnsiParser {
  private state: State = STATE.Ground;
  private params: number[] = [];
  /**
   * Currently-accumulating numeric parameter. `null` means "no digit seen since the last `;`."
   * Pushed into `params` on `;` or on the final byte.
   */
  private currentParam: number | null = null;
  private intermediate: string = '';
  private prefix: string = '';

  /** Reset accumulators. Called on entering ESCAPE and CSI_ENTRY. */
  private clearAccumulators(): void {
    this.params = [];
    this.currentParam = null;
    this.intermediate = '';
    this.prefix = '';
  }

  /** Flush a pending currentParam into params. */
  private flushCurrentParam(): void {
    if (this.currentParam !== null) {
      this.params.push(this.currentParam);
      this.currentParam = null;
    }
  }

  /**
   * Feed a chunk of input. Returns the sequence of actions emitted by this chunk.
   * State persists across calls (chunked input is safe).
   */
  parse(input: string): Action[] {
    const out: Action[] = [];
    for (const ch of input) {
      this.consume(ch, out);
    }
    return out;
  }

  private consume(ch: string, out: Action[]): void {
    const cp = ch.codePointAt(0)!;

    // ── Anywhere transitions ──────────────────────────────────────────────
    if (cp === 0x18 || cp === 0x1A) {
      // CAN / SUB: abort whatever we were doing, emit an execute, return to ground.
      this.state = STATE.Ground;
      out.push({ type: 'execute', code: cp });
      return;
    }
    if (cp === 0x1B) {
      // ESC: reset accumulators, enter ESCAPE.
      this.clearAccumulators();
      this.state = STATE.Escape;
      return;
    }

    // ── State-specific transitions ────────────────────────────────────────
    switch (this.state) {
      case STATE.Ground:
        this.groundConsume(cp, ch, out);
        return;

      case STATE.Escape:
        this.escapeConsume(cp, ch, out);
        return;

      case STATE.EscapeIntermediate:
        if (cp >= 0x20 && cp <= 0x2F) {
          this.intermediate += ch;
        } else if (cp >= 0x30 && cp <= 0x7E) {
          out.push({ type: 'esc', final: ch, intermediate: this.intermediate });
          this.state = STATE.Ground;
        } else if (cp < 0x20) {
          out.push({ type: 'execute', code: cp });
        }
        return;

      case STATE.CsiEntry:
        this.csiEntryConsume(cp, ch, out);
        return;

      case STATE.CsiParam:
        this.csiParamConsume(cp, ch, out);
        return;

      case STATE.CsiIntermediate:
        if (cp >= 0x20 && cp <= 0x2F) {
          this.intermediate += ch;
        } else if (cp >= 0x40 && cp <= 0x7E) {
          out.push(this.dispatchCsi(ch));
          this.state = STATE.Ground;
        } else if (cp >= 0x30 && cp <= 0x3F) {
          // Param/private bytes are not allowed after intermediates → ignore the rest.
          this.state = STATE.CsiIgnore;
        } else if (cp < 0x20) {
          out.push({ type: 'execute', code: cp });
        }
        return;

      case STATE.CsiIgnore:
        // Wait for a final byte; then return to ground without dispatching.
        if (cp >= 0x40 && cp <= 0x7E) {
          this.state = STATE.Ground;
        } else if (cp < 0x20) {
          out.push({ type: 'execute', code: cp });
        }
        return;

      case STATE.OscString:
        // BEL terminates OSC. (ESC \ also terminates, via the anywhere-ESC rule + ESCAPE
        // state seeing '\' as a benign esc dispatch.)
        if (cp === 0x07) {
          this.state = STATE.Ground;
        }
        // All other bytes are consumed silently (we don't implement OSC dispatch yet).
        return;
    }
  }

  private groundConsume(cp: number, ch: string, out: Action[]): void {
    if (cp < 0x20 || cp === 0x7F) {
      out.push({ type: 'execute', code: cp });
    } else {
      out.push({ type: 'print', char: ch });
    }
  }

  private escapeConsume(cp: number, ch: string, out: Action[]): void {
    if (cp < 0x20) {
      out.push({ type: 'execute', code: cp });
      return;
    }
    if (cp >= 0x20 && cp <= 0x2F) {
      this.intermediate += ch;
      this.state = STATE.EscapeIntermediate;
      return;
    }
    if (cp === 0x5B /* '[' */) {
      this.clearAccumulators();
      this.state = STATE.CsiEntry;
      return;
    }
    if (cp === 0x5D /* ']' */) {
      this.clearAccumulators();
      this.state = STATE.OscString;
      return;
    }
    if (cp >= 0x30 && cp <= 0x7E) {
      // 0x30..0x7E (other than '[' and ']'): final byte for an ESC sequence.
      out.push({ type: 'esc', final: ch, intermediate: this.intermediate });
      this.state = STATE.Ground;
      return;
    }
  }

  private csiEntryConsume(cp: number, ch: string, out: Action[]): void {
    if (cp >= 0x30 && cp <= 0x39 /* 0–9 */) {
      this.currentParam = cp - 0x30;
      this.state = STATE.CsiParam;
      return;
    }
    if (cp === 0x3B /* ';' */) {
      // Empty leading param → push 0, stay in CsiParam.
      this.params.push(0);
      this.state = STATE.CsiParam;
      return;
    }
    if (cp === 0x3A /* ':' */) {
      // Sub-param separator. Treat as ';' for our SGR dispatcher's purposes.
      this.params.push(0);
      this.state = STATE.CsiParam;
      return;
    }
    if (cp === 0x3C || cp === 0x3D || cp === 0x3E || cp === 0x3F /* '<' '=' '>' '?' */) {
      this.prefix = ch;
      this.state = STATE.CsiParam;
      return;
    }
    if (cp >= 0x20 && cp <= 0x2F) {
      this.intermediate += ch;
      this.state = STATE.CsiIntermediate;
      return;
    }
    if (cp >= 0x40 && cp <= 0x7E /* final byte */) {
      out.push(this.dispatchCsi(ch));
      this.state = STATE.Ground;
      return;
    }
    if (cp < 0x20) {
      out.push({ type: 'execute', code: cp });
      return;
    }
    this.state = STATE.CsiIgnore;
  }

  private csiParamConsume(cp: number, ch: string, out: Action[]): void {
    if (cp >= 0x30 && cp <= 0x39) {
      this.currentParam = (this.currentParam ?? 0) * 10 + (cp - 0x30);
      return;
    }
    if (cp === 0x3B /* ';' */ || cp === 0x3A /* ':' */) {
      // Flush whatever digit we'd been collecting (null → 0 for empty slot).
      this.params.push(this.currentParam ?? 0);
      this.currentParam = null;
      return;
    }
    if (cp === 0x3C || cp === 0x3D || cp === 0x3E || cp === 0x3F) {
      this.state = STATE.CsiIgnore;
      return;
    }
    if (cp >= 0x20 && cp <= 0x2F) {
      this.flushCurrentParam();
      this.intermediate += ch;
      this.state = STATE.CsiIntermediate;
      return;
    }
    if (cp >= 0x40 && cp <= 0x7E) {
      this.flushCurrentParam();
      out.push(this.dispatchCsi(ch));
      this.state = STATE.Ground;
      return;
    }
    if (cp < 0x20) {
      out.push({ type: 'execute', code: cp });
      return;
    }
    this.state = STATE.CsiIgnore;
  }

  private dispatchCsi(final: string): Action {
    return {
      type: 'csi',
      final,
      params: this.params.slice(),
      intermediate: this.intermediate,
      prefix: this.prefix,
    };
  }
}
