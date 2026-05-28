/**
 * shell/tokenizer.ts — Phase 3, step 1: hand-written shell lexer.
 *
 * Splits a command line into `word` and `op` tokens. It is a small state machine (NORMAL /
 * single-quote / double-quote, handled inline) — not `String.split(' ')`, which the planning
 * doc explicitly warns against because it can't honour quotes, escapes, or `echo "a b"`.
 *
 * The subtle part is **quoting for later expansion**. `$USER` must expand inside double quotes
 * and bare text, but NOT inside single quotes or after a backslash. So a word isn't a flat
 * string — it's a list of *parts*, each tagged:
 *
 *   - `expandable` — bare or double-quoted text; a later phase expands `$VAR` / `${VAR}`.
 *   - `literal`    — single-quoted or backslash-escaped text; taken verbatim, never expanded.
 *
 * Adjacent quotes concatenate into ONE word: `foo'bar'baz` is a single word with three parts.
 * Empty quotes (`""`, `''`) still produce a word (with empty `parts`), i.e. an empty argument.
 *
 * Operators (greedy: `>>` before `>`, `&&` before `&`, `||` before `|`):
 *   `|`  `||`  `&`  `&&`  `;`  `<`  `>`  `>>`
 *
 * Expansion, globbing, comments (`#`), `~`, fd-redirection (`2>`), and line-continuation
 * (`\\<newline>`) are intentionally NOT handled here — later phases / deferred. The exit
 * criterion (`echo "hello $USER" | tr a-z A-Z`) needs only quoting + the `|` operator.
 */

export class ShellError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShellError';
  }
}

export type OpType = '|' | '||' | '&' | '&&' | ';' | '<' | '>' | '>>';

export type WordPart =
  | { kind: 'literal'; value: string } // single-quoted / escaped — no expansion
  | { kind: 'expandable'; value: string }; // bare / double-quoted — $VAR expands later

export type Token =
  | { type: 'word'; parts: WordPart[] }
  | { type: 'op'; op: OpType };

const WHITESPACE = new Set([' ', '\t', '\n', '\r']);
/** In double quotes, backslash only escapes these; otherwise it's a literal backslash. */
const DQUOTE_ESCAPABLE = new Set(['"', '\\', '$', '`']);

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let current: WordPart[] | null = null;
  let i = 0;

  const startWord = (): void => {
    if (current === null) current = [];
  };
  const endWord = (): void => {
    if (current !== null) {
      tokens.push({ type: 'word', parts: current });
      current = null;
    }
  };
  const push = (kind: WordPart['kind'], str: string): void => {
    startWord();
    const parts = current!;
    const last = parts[parts.length - 1];
    if (last && last.kind === kind) last.value += str;
    else parts.push({ kind, value: str });
  };

  while (i < input.length) {
    const ch = input[i];

    if (WHITESPACE.has(ch)) {
      endWord();
      i++;
      continue;
    }

    // Operators (greedy on the two-char forms).
    if (ch === '|') {
      endWord();
      if (input[i + 1] === '|') {
        tokens.push({ type: 'op', op: '||' });
        i += 2;
      } else {
        tokens.push({ type: 'op', op: '|' });
        i++;
      }
      continue;
    }
    if (ch === '&') {
      endWord();
      if (input[i + 1] === '&') {
        tokens.push({ type: 'op', op: '&&' });
        i += 2;
      } else {
        tokens.push({ type: 'op', op: '&' });
        i++;
      }
      continue;
    }
    if (ch === '>') {
      endWord();
      if (input[i + 1] === '>') {
        tokens.push({ type: 'op', op: '>>' });
        i += 2;
      } else {
        tokens.push({ type: 'op', op: '>' });
        i++;
      }
      continue;
    }
    if (ch === ';') {
      endWord();
      tokens.push({ type: 'op', op: ';' });
      i++;
      continue;
    }
    if (ch === '<') {
      endWord();
      tokens.push({ type: 'op', op: '<' });
      i++;
      continue;
    }

    // Single quote — fully literal, up to the next single quote.
    if (ch === "'") {
      startWord();
      i++; // opening quote
      let buf = '';
      while (i < input.length && input[i] !== "'") {
        buf += input[i];
        i++;
      }
      if (i >= input.length) throw new ShellError('unterminated single quote');
      i++; // closing quote
      if (buf.length > 0) push('literal', buf);
      continue;
    }

    // Double quote — expandable, with a few backslash escapes.
    if (ch === '"') {
      startWord();
      i++; // opening quote
      while (i < input.length && input[i] !== '"') {
        if (input[i] === '\\' && i + 1 < input.length && DQUOTE_ESCAPABLE.has(input[i + 1])) {
          push('literal', input[i + 1]); // \" \\ \$ \` → literal char
          i += 2;
        } else {
          push('expandable', input[i]); // keep $ for later expansion
          i++;
        }
      }
      if (i >= input.length) throw new ShellError('unterminated double quote');
      i++; // closing quote
      continue;
    }

    // Backslash escape (bare) — the next char is literal.
    if (ch === '\\') {
      if (i + 1 < input.length) {
        push('literal', input[i + 1]);
        i += 2;
      } else {
        push('literal', '\\'); // trailing backslash → literal
        i++;
      }
      continue;
    }

    // Bare character — expandable.
    push('expandable', ch);
    i++;
  }

  endWord();
  return tokens;
}

/** Concatenate a word's parts into its raw (un-expanded) text. */
export function wordText(token: Extract<Token, { type: 'word' }>): string {
  return token.parts.map((p) => p.value).join('');
}
