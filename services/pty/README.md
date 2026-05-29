# `services/pty/` — Phase 5: the PTY backend

> Per `docs/PLANNING_AND_ARCHITECTURE.md` §4 Phase 5. A separate, self-contained Node service —
> its own `package.json`, no workspace, no shared imports with the web app (they talk over the
> wire). It extracts here because it has a genuinely different runtime (a real OS process holding
> pseudo-terminals), unlike the framework-free libraries in `apps/web/src/`.

## What it is

A tiny HTTP + WebSocket server that owns real pseudo-terminals (via `node-pty`) and bridges them
to the browser terminal. This is where the *fake* shell (Phase 3) gives way to the *real* one —
`vim`, `htop`, `nano`, `nvim` actually run.

## ⚠ Security — localhost only

This server binds to **`127.0.0.1`** and rejects non-localhost WebSocket `Origin`s. A PTY
endpoint is **remote code execution by design** — anyone who can reach it runs shell commands as
you. **Never** bind it to `0.0.0.0` or expose it through a tunnel/proxy. If you don't understand
that sentence, don't change the `HOST` constant.

## Run it

```bash
cd services/pty
npm install     # node-pty 1.1.0 ships prebuilt binaries (no toolchain needed); postinstall fixes
                # the spawn-helper's executable bit (see Troubleshooting below)
npm start       # → http://127.0.0.1:7682  (override with TERMI_PTY_PORT)
```

Then open the web app (`cd apps/web && npm run dev`) and use the **Shell (PTY)** tab. With the
server down, that tab shows how to start it; everything else works without it.

`npm run typecheck` checks `server.ts` without running.

## Troubleshooting: `Error: posix_spawnp failed.`

If `POST /pty` crashes the server with `posix_spawnp failed` (thrown from inside `node-pty`'s
`UnixTerminal`), the cause is **node-pty 1.1.0 shipping its prebuilt `spawn-helper` without the
executable bit**. node-pty `posix_spawn`s that little helper to set up the slave TTY; mode `0644`
makes the exec fail. (Confirm with `ls -la node_modules/node-pty/prebuilds/darwin-*/spawn-helper`
— if there's no `x`, that's it. It is *not* a missing C toolchain or the wrong shell.)

`scripts/fix-perms.mjs` restores `+x` on every prebuilt helper present; it runs automatically on
`postinstall` **and** `prestart`/`predev`, so a fresh `npm install` followed by `npm start` self-
heals. To fix by hand: `chmod +x node_modules/node-pty/prebuilds/*/spawn-helper`.

## Protocol

```
POST /pty            body {shell?,cols?,rows?,cwd?} → 201 { id, shell, cols, rows }
WS   /pty/:id        binary frame  = raw terminal data (both directions)
                     text frame    = JSON control: ↑ {type:'resize',cols,rows}  ↓ {type:'exit',code}
GET  /health         { ok, sessions }
```

Why binary-for-data, text-for-control: it lets the bridge tell "type a key" from "the window
resized" without a header byte. node-pty does the UTF-8 decode internally (buffering partial
multi-byte sequences — the "don't split a codepoint" hazard), so its string output ships as
binary frames and the browser feeds them straight into the Phase 1 ANSI parser.

## Lifecycle

- A spawned-but-never-connected session is reaped after 30s (orphan).
- On socket close the child is killed after a 5s grace period (survives an HMR reconnect).
- `child.onExit` (you typed `exit`) closes the socket with `{type:'exit',code}`.

## Not unit-tested here (on purpose)

This is integration glue over `node-pty` + `ws`; its correctness is "does `htop` run and reflow."
Verify by running it. The *pure, testable* half of Phase 5 — encoding browser keystrokes into the
byte sequences a terminal app expects — lives in the web app (`apps/web/src/pty/key-to-bytes.ts`).
