/**
 * input/ — Phase 2: Keyboard & Input Systems.
 *
 *   key.ts          — the Key model (physical/logical), notation parser + serializer
 *   input-layer.ts  — scoped DOM capture (events in → Keys out)
 *   keymap.ts       — bindings as a trie of named actions
 *   resolver.ts     — the mode-aware FSM (feed / flushTimeout)
 *   conflicts.ts    — static prefix-conflict detection
 *   text-buffer.ts  — the vim-motion sandbox model (closes the phase exit criteria)
 */

export * from './key';
export * from './input-layer';
export * from './keymap';
export * from './resolver';
export * from './conflicts';
export * from './text-buffer';
