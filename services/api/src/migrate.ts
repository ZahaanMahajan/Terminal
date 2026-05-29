/**
 * src/migrate.ts — the *pure* half of the migration system: deciding what to run.
 *
 * No I/O, no database, no `node:fs` — just "given the migration files on disk and the set already
 * applied, which ones run next, and in what order?" Keeping this pure means the gnarly part (order,
 * filtering, what counts as a migration) is exhaustively testable with zero setup. The glue that
 * actually reads files and executes SQL lives in db.ts.
 *
 * Convention: a migration file is `NNN_snake_name.sql` — a zero-padded 3-digit ordinal, an
 * underscore, a lowercase snake_case name, `.sql`. Zero-padding is the whole trick: it makes
 * lexicographic sort == numeric order, so `001` < `002` < ... < `010` without parsing integers.
 */

/** True iff `name` is a well-formed migration filename (`001_init.sql`). */
export function isValidMigrationName(name: string): boolean {
  return /^\d{3}_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/.test(name);
}

/**
 * Given every entry in the migrations directory and the names already applied, return the
 * migrations to run now — valid files only, sorted into ordinal order, minus the applied set.
 * Non-migration entries (`README.md`, `.DS_Store`, an editor swapfile) are ignored, so the
 * directory can hold docs alongside the SQL.
 */
export function pendingMigrations(allEntries: string[], applied: Iterable<string>): string[] {
  const done = new Set(applied);
  return allEntries
    .filter(isValidMigrationName)
    .sort() // zero-padded ordinals → lexicographic sort is numeric order
    .filter((name) => !done.has(name));
}
