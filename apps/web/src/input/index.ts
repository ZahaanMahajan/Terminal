/**
 * input/ — Phase 2: Keyboard & Input Systems.
 *
 *   key.ts          — the Key model (physical/logical), notation parser + serializer
 *   input-layer.ts  — scoped DOM capture (events in → Keys out)
 *
 * Still to come this phase: keymap + trie + mode-aware FSM resolver (step 2), conflict
 * detection (step 3), on-screen keyboard overlay + action toast (step 4).
 */

export * from './key';
export * from './input-layer';
export * from './keymap';
export * from './resolver';
