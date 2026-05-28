/**
 * compiler/migrations.ts — Phase 4, step 1: forward schema migrations.
 *
 * Long-lived software changes its data shape; the honest way to handle it is a *versioned*
 * schema plus forward migrations that upgrade old documents on read. A published setup never
 * breaks: load it, migrate it to the current version, then validate.
 *
 * Concrete example baked in: v1 stored `meta.os` as a single string; v2 (current) makes it an
 * array. `migrations[1]` performs that upgrade. Each `migrations[n]` upgrades version n → n+1;
 * `migrate` applies the chain until the document reaches `SCHEMA_VERSION`.
 *
 * Migrations operate on raw (untyped) data — that's intrinsic: an old document doesn't satisfy
 * the current types. `any` here is honest, not lazy.
 */

export const SCHEMA_VERSION = 2;

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Migration = (raw: any) => any;

export const migrations: Record<number, Migration> = {
  // v1 → v2: `meta.os` was a single OS string; wrap it into an array.
  1: (raw) => ({
    ...raw,
    schemaVersion: 2,
    meta: {
      ...(raw.meta ?? {}),
      os: Array.isArray(raw?.meta?.os)
        ? raw.meta.os
        : raw?.meta?.os != null
          ? [raw.meta.os]
          : [],
    },
  }),
};

/**
 * Upgrade a raw document to the current schema version by applying the migration chain.
 * A missing `schemaVersion` is treated as v1 (the oldest). Non-objects pass through untouched
 * so the validator can reject them with a clear message.
 */
export function migrate(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  let cur: any = raw;
  let version = typeof cur.schemaVersion === 'number' ? cur.schemaVersion : 1;
  while (version < SCHEMA_VERSION && migrations[version]) {
    cur = migrations[version](cur);
    version = typeof cur.schemaVersion === 'number' ? cur.schemaVersion : version + 1;
  }
  return cur;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
