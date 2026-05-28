/**
 * shell/parser.ts — Phase 3, step 2: hand-written recursive-descent parser.
 *
 * Consumes the tokenizer's `Token[]` and produces an AST. The grammar is the classic shell
 * decomposition, one method per production (the textbook recursive-descent shape — no
 * `nearley`/`pegjs`, per the planning doc):
 *
 *     script   := (andOr (';' | '&')?)*           a list of statements
 *     andOr    := pipeline (('&&' | '||') pipeline)*
 *     pipeline := command ('|' command)*
 *     command  := (word | redirect)+              redirect-only commands are allowed (`> f`)
 *     redirect := ('>' | '>>' | '<') word
 *
 * Precedence falls out of the nesting: `|` binds tighter than `&&`/`||`, which bind tighter
 * than `;`/`&`. A `Word` is carried through verbatim as the tokenizer's `WordPart[]`, so the
 * literal/expandable tagging survives for the expander (step 3).
 *
 * Errors throw `ShellError` ("syntax error near …"): a leading/dangling operator, a redirect
 * with no filename, or a separator with nothing before it.
 */

import { ShellError, tokenize, type OpType, type Token, type WordPart } from './tokenizer';

export type Word = WordPart[];
export type RedirectOp = '>' | '>>' | '<';
export type Redirect = { op: RedirectOp; target: Word };

export type Command = { type: 'command'; words: Word[]; redirects: Redirect[] };
export type Pipeline = { type: 'pipeline'; commands: Command[] };
export type AndOr = { type: 'and-or'; pipelines: Pipeline[]; connectors: Array<'&&' | '||'> };
export type Statement = { andOr: AndOr; background: boolean };
export type Script = { type: 'script'; statements: Statement[] };

class Parser {
  private readonly tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  /** The op at the cursor, or null if the cursor is at a word / end of input. */
  private peekOp(): OpType | null {
    const t = this.peek();
    return t && t.type === 'op' ? t.op : null;
  }

  private next(): Token {
    return this.tokens[this.pos++];
  }

  parseScript(): Script {
    const statements: Statement[] = [];
    while (this.pos < this.tokens.length) {
      const andOr = this.parseAndOr();
      let background = false;
      const term = this.peekOp();
      if (term === ';' || term === '&') {
        background = term === '&';
        this.next();
      }
      statements.push({ andOr, background });
    }
    return { type: 'script', statements };
  }

  private parseAndOr(): AndOr {
    const pipelines: Pipeline[] = [this.parsePipeline()];
    const connectors: Array<'&&' | '||'> = [];
    let op = this.peekOp();
    while (op === '&&' || op === '||') {
      this.next();
      connectors.push(op);
      pipelines.push(this.parsePipeline());
      op = this.peekOp();
    }
    return { type: 'and-or', pipelines, connectors };
  }

  private parsePipeline(): Pipeline {
    const commands: Command[] = [this.parseCommand()];
    while (this.peekOp() === '|') {
      this.next();
      commands.push(this.parseCommand());
    }
    return { type: 'pipeline', commands };
  }

  private parseCommand(): Command {
    const words: Word[] = [];
    const redirects: Redirect[] = [];

    for (;;) {
      const t = this.peek();
      if (!t) break;
      if (t.type === 'word') {
        words.push(t.parts);
        this.next();
        continue;
      }
      const op = t.op;
      if (op === '>' || op === '>>' || op === '<') {
        this.next();
        const target = this.peek();
        if (!target || target.type !== 'word') {
          throw new ShellError(`syntax error: expected filename after '${op}'`);
        }
        this.next();
        redirects.push({ op, target: target.parts });
        continue;
      }
      break; // | && || ; & — ends this command
    }

    if (words.length === 0 && redirects.length === 0) {
      const t = this.peek();
      const near = t && t.type === 'op' ? `'${t.op}'` : 'end of input';
      throw new ShellError(`syntax error near ${near}`);
    }
    return { type: 'command', words, redirects };
  }
}

/** Tokenize (if needed) and parse a command line into a Script AST. */
export function parse(input: string | Token[]): Script {
  const tokens = typeof input === 'string' ? tokenize(input) : input;
  return new Parser(tokens).parseScript();
}
