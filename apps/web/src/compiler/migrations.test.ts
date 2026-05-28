/**
 * migrations.test.ts — forward schema migration + integration with parseSetup.
 */

import { describe, it, expect } from 'vitest';
import { migrate, SCHEMA_VERSION } from './migrations';
import { parseSetup } from './validate';

describe('migrate', () => {
  it('v1 → v2: wraps meta.os string into an array and bumps the version', () => {
    const v1 = { schemaVersion: 1, meta: { name: 'old', os: 'macos' }, shell: { kind: 'zsh' } };
    const out = migrate(v1) as { schemaVersion: number; meta: { os: unknown } };
    expect(out.schemaVersion).toBe(2);
    expect(out.meta.os).toEqual(['macos']);
  });

  it('leaves a current-version document unchanged', () => {
    const v2 = { schemaVersion: SCHEMA_VERSION, meta: { name: 'x', os: ['linux'] }, shell: { kind: 'bash' } };
    expect(migrate(v2)).toEqual(v2);
  });

  it('treats a missing schemaVersion as v1 and migrates', () => {
    const raw = { meta: { name: 'x', os: 'linux' }, shell: { kind: 'zsh' } };
    const out = migrate(raw) as { schemaVersion: number; meta: { os: unknown } };
    expect(out.schemaVersion).toBe(2);
    expect(out.meta.os).toEqual(['linux']);
  });

  it('passes non-objects through (the validator rejects them)', () => {
    expect(migrate(null)).toBeNull();
    expect(migrate('nope')).toBe('nope');
  });
});

describe('parseSetup migrates before validating', () => {
  it('accepts a v1 document and yields a valid, current Setup', () => {
    const v1 = { schemaVersion: 1, meta: { name: 'legacy', os: 'macos' }, shell: { kind: 'zsh' } };
    const r = parseSetup(v1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.setup.schemaVersion).toBe(SCHEMA_VERSION);
    expect(r.setup.meta.os).toEqual(['macos']);
  });
});
