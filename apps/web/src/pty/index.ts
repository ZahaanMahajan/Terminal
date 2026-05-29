/**
 * pty/ — Phase 5: the browser side of the real-PTY bridge.
 *
 *   key-to-bytes.ts — encode a Key into terminal input bytes (inverse of the ANSI parser)
 *   pty-client.ts   — WebSocket client to the services/pty backend
 *
 * The backend lives in `services/pty/` (a separate Node process). Full-screen apps (vim/htop)
 * are supported: the renderer gained alt-screen + cursor show/hide in Phase 5 step 3
 * (see renderer/screen.ts `enterAltScreen`/`exitAltScreen` and ansi/interpret.ts `setPrivateModes`).
 */

export * from './key-to-bytes';
export * from './pty-client';
