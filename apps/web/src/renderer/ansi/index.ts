/**
 * renderer/ansi — public surface for the VT100/ECMA-48 parser & interpreter.
 *
 * Architecture:
 *   parser.ts      — Williams's state machine: bytes → typed Action[]
 *   sgr.ts         — Select Graphic Rendition: SGR params → mutate pen colors
 *   interpret.ts   — apply Actions to (Screen, Cursor); also exports `feed`
 */

export { AnsiParser } from './parser';
export type { Action } from './parser';
export { applyAction, feed } from './interpret';
export { applySgr, ansi256 } from './sgr';
