/**
 * services/pty/server.ts — Phase 5, step 1: a tiny PTY backend.
 *
 * Owns real pseudo-terminals (via node-pty) and bridges them to the browser over WebSocket, so
 * the in-browser terminal (Phase 1) can run real programs — vim, htop, nano, nvim.
 *
 *   POST /pty           spawn a PTY → { id, shell, cols, rows }
 *   WS   /pty/:id       bidirectional bridge:
 *                         binary frame  = raw terminal data (browser→stdin, stdout→browser)
 *                         text frame    = a JSON control message ({type:'resize',cols,rows} up;
 *                                          {type:'exit',code} down)
 *   GET  /health        { ok, sessions }
 *
 * SECURITY — this binds to 127.0.0.1 ONLY. A PTY endpoint is remote code execution by design:
 * anyone who can reach it can run shell commands as you. We also reject non-localhost WS
 * Origins (defense against a malicious page in your browser reaching localhost). Never expose
 * this to a network. (The planning doc is emphatic about exactly this.)
 *
 * The "bytes, not strings" concern is handled at one boundary: node-pty does the UTF-8 decode
 * internally (buffering partial multi-byte sequences), so we ship its string output as binary
 * frames and the browser feeds them straight into the Phase 1 ANSI parser.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import * as pty from 'node-pty';

const HOST = '127.0.0.1'; // localhost only — do not change without understanding the risk
const PORT = Number(process.env.TERMI_PTY_PORT ?? 7682);
/** Kill a session that's spawned but never connected to, or whose socket has closed. */
const ORPHAN_MS = 30_000;
const DISCONNECT_GRACE_MS = 5_000;

type Session = { pty: pty.IPty; orphanTimer: NodeJS.Timeout };
const sessions = new Map<string, Session>();

function originAllowed(origin?: string): boolean {
  if (!origin) return true; // native ws clients / curl send no Origin
  try {
    const host = new URL(origin).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  } catch {
    return false;
  }
}

function cors(origin?: string): Record<string, string> {
  return {
    'access-control-allow-origin': origin && originAllowed(origin) ? origin : 'null',
    'access-control-allow-methods': 'POST, GET, OPTIONS',
    'access-control-allow-headers': 'content-type',
  };
}

function sendJson(res: ServerResponse, code: number, body: unknown, origin?: string): void {
  res.writeHead(code, { 'content-type': 'application/json', ...cors(origin) });
  res.end(JSON.stringify(body));
}

function handleSpawn(req: IncomingMessage, res: ServerResponse): void {
  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => {
    let opts: { shell?: string; cols?: number; rows?: number; cwd?: string } = {};
    try {
      opts = raw ? JSON.parse(raw) : {};
    } catch {
      /* ignore — use defaults */
    }
    const shell =
      opts.shell ?? process.env.SHELL ?? (process.platform === 'win32' ? 'powershell.exe' : 'bash');
    const cols = opts.cols ?? 80;
    const rows = opts.rows ?? 24;
    const cwd = opts.cwd ?? process.env.HOME ?? process.cwd();

    const child = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
    });

    const id = randomUUID();
    const orphanTimer = setTimeout(() => closeSession(id), ORPHAN_MS);
    sessions.set(id, { pty: child, orphanTimer });
    child.onExit(() => closeSession(id));

    sendJson(res, 201, { id, shell, cols, rows }, req.headers.origin);
  });
}

function closeSession(id: string): void {
  const session = sessions.get(id);
  if (!session) return;
  clearTimeout(session.orphanTimer);
  sessions.delete(id);
  try {
    session.pty.kill();
  } catch {
    /* already gone */
  }
}

/** Wire a connected WebSocket to a session's PTY (both directions). */
function bridge(ws: WebSocket, id: string): void {
  const session = sessions.get(id);
  if (!session) {
    ws.close();
    return;
  }
  clearTimeout(session.orphanTimer); // it's connected now
  const child = session.pty;

  const onData = child.onData((data) => {
    if (ws.readyState === ws.OPEN) ws.send(Buffer.from(data, 'utf8')); // binary frame
  });
  const onExit = child.onExit(({ exitCode }) => {
    try {
      ws.send(JSON.stringify({ type: 'exit', code: exitCode })); // text control frame
    } catch {
      /* socket may be closing */
    }
    ws.close();
  });

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      child.write(data.toString('utf8')); // raw input → PTY stdin
      return;
    }
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'resize' && Number.isInteger(msg.cols) && Number.isInteger(msg.rows)) {
        child.resize(msg.cols, msg.rows); // → SIGWINCH; the program reflows
      }
    } catch {
      /* ignore malformed control */
    }
  });

  ws.on('close', () => {
    onData.dispose();
    onExit.dispose();
    // Give a brief grace period (e.g. a quick reconnect during HMR) before reaping.
    setTimeout(() => closeSession(id), DISCONNECT_GRACE_MS);
  });
}

const server = createServer((req, res) => {
  const origin = req.headers.origin;
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors(origin));
    res.end();
    return;
  }
  if (req.method === 'POST' && req.url === '/pty') return handleSpawn(req, res);
  if (req.method === 'GET' && req.url === '/health') {
    return sendJson(res, 200, { ok: true, sessions: sessions.size }, origin);
  }
  sendJson(res, 404, { error: 'not found' }, origin);
});

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  if (!originAllowed(req.headers.origin)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  const match = (req.url ?? '').match(/^\/pty\/([0-9a-fA-F-]+)$/);
  const id = match?.[1];
  if (!id || !sessions.has(id)) {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => bridge(ws, id));
});

server.listen(PORT, HOST, () => {
  console.log(`termi pty server → http://${HOST}:${PORT}  (localhost only)`);
});
