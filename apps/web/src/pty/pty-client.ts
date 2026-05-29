/**
 * pty/pty-client.ts — Phase 5, step 2: the browser side of the PTY bridge.
 *
 * Thin wrapper over the backend (`services/pty`): `POST /pty` to spawn, then a WebSocket to
 * stream. Input goes out as **binary** frames (the bytes from key-to-bytes); resize goes out as
 * a **text** JSON control frame. PTY output arrives as binary frames (decoded to a string and
 * handed to the renderer); `{type:'exit'}` arrives as a text frame.
 *
 * DOM glue (fetch + WebSocket) — verified by running, not unit-tested. The pure, tested half of
 * the bridge is key-to-bytes.
 */

const DEFAULT_BASE = 'http://127.0.0.1:7682';

export type PtyHandlers = {
  onData: (data: string) => void;
  onExit: (code: number) => void;
  onError: (message: string) => void;
  onOpen?: () => void;
};

export type PtySpawnOptions = { shell?: string; cols: number; rows: number };

export class PtyClient {
  private ws: WebSocket | null = null;
  private readonly base: string;
  private readonly handlers: PtyHandlers;

  constructor(handlers: PtyHandlers, base: string = DEFAULT_BASE) {
    this.handlers = handlers;
    this.base = base;
  }

  async connect(opts: PtySpawnOptions): Promise<void> {
    let res: Response;
    try {
      res = await fetch(`${this.base}/pty`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(opts),
      });
    } catch {
      this.handlers.onError(
        `Can't reach the PTY server at ${this.base}. Start it:  cd services/pty && npm install && npm start`,
      );
      return;
    }
    if (!res.ok) {
      this.handlers.onError(`PTY server returned HTTP ${res.status}`);
      return;
    }
    const { id } = (await res.json()) as { id: string };

    const ws = new WebSocket(`${this.base.replace(/^http/, 'ws')}/pty/${id}`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    const decoder = new TextDecoder();

    ws.onopen = () => this.handlers.onOpen?.();
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'exit') this.handlers.onExit(msg.code ?? 0);
        } catch {
          /* ignore malformed control */
        }
      } else {
        this.handlers.onData(decoder.decode(ev.data as ArrayBuffer));
      }
    };
    ws.onerror = () => this.handlers.onError('WebSocket error');
    ws.onclose = () => {
      this.ws = null;
    };
  }

  /** Send raw input bytes (a binary frame) to the PTY's stdin. */
  sendInput(bytes: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(new TextEncoder().encode(bytes));
  }

  /** Tell the PTY the window changed size (→ SIGWINCH). */
  resize(cols: number, rows: number): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'resize', cols, rows }));
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}
