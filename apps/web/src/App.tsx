import { useState, type ReactNode } from 'react';
import { TerminalDemo } from './demos/TerminalDemo';
import { KeyboardDemo } from './demos/KeyboardDemo';
import { ShellDemo } from './demos/ShellDemo';
import { StudioDemo } from './demos/StudioDemo';
import { PtyDemo } from './demos/PtyDemo';
import { SyncDemo } from './demos/SyncDemo';

/**
 * App — a thin shell that switches between the per-phase demos.
 *
 * Each phase ships a self-contained demo; this is just the page chrome + a tab switcher so
 * they coexist. No router — a single `useState` is enough for two tabs.
 */

type Tab = { id: string; label: string; render: () => ReactNode };

const TABS: Tab[] = [
  { id: 'terminal', label: 'Terminal (P1)', render: () => <TerminalDemo /> },
  { id: 'keyboard', label: 'Keyboard (P2)', render: () => <KeyboardDemo /> },
  { id: 'shell', label: 'Shell (P3)', render: () => <ShellDemo /> },
  { id: 'compiler', label: 'Compiler (P4)', render: () => <StudioDemo /> },
  { id: 'pty', label: 'PTY (P5)', render: () => <PtyDemo /> },
  { id: 'sync', label: 'Sync (P6)', render: () => <SyncDemo /> },
];

export default function App() {
  const [active, setActive] = useState(TABS[0].id);
  const current = TABS.find((t) => t.id === active) ?? TABS[0];

  return (
    <div className="min-h-screen flex flex-col bg-neutral-950 text-neutral-200">
      <nav className="flex items-center gap-2 border-b border-neutral-800 px-4 py-2 font-mono text-[11px]">
        <span className="text-neutral-500 mr-2 uppercase tracking-widest">termi</span>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            className={[
              'px-3 py-1 rounded border transition-colors',
              t.id === active
                ? 'border-violet-500 bg-violet-500/10 text-violet-300'
                : 'border-neutral-800 text-neutral-400 hover:border-neutral-600 hover:text-neutral-200',
            ].join(' ')}
          >
            {t.label}
          </button>
        ))}
      </nav>
      {current.render()}
    </div>
  );
}
