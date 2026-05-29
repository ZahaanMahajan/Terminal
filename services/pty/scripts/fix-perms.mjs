/**
 * scripts/fix-perms.mjs — work around a node-pty 1.1.0 packaging bug.
 *
 * node-pty ships a prebuilt `spawn-helper` (the small executable its native code `posix_spawn`s
 * to set up the slave TTY). On some installs the prebuild lands with mode 0644 — no executable
 * bit — and every `pty.spawn` then dies with:
 *
 *     Error: posix_spawnp failed.
 *         at new UnixTerminal (node-pty/src/unixTerminal.ts:106)
 *
 * The fix is simply `chmod +x` on the helper. We do it for every platform dir present (only the
 * darwin builds carry a spawn-helper; linux uses forkpty, win32 uses conpty), idempotently, so
 * it's safe to run on `postinstall` and again on `prestart`.
 *
 * Cross-platform on purpose (a node script, not `chmod` in package.json) so `npm start` works on
 * Windows too, where the helper simply doesn't exist and we no-op.
 */

import { chmodSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const prebuilds = join(here, '..', 'node_modules', 'node-pty', 'prebuilds');

if (!existsSync(prebuilds)) process.exit(0); // node-pty not installed (or not yet) — nothing to do

for (const platform of readdirSync(prebuilds)) {
  const helper = join(prebuilds, platform, 'spawn-helper');
  if (!existsSync(helper)) continue;
  // Already executable? Leave it alone (keeps output quiet on the common path).
  if (statSync(helper).mode & 0o111) continue;
  chmodSync(helper, 0o755);
  console.log(`[fix-perms] +x ${helper}`);
}
