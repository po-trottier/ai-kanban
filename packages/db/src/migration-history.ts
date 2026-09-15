import { createHash } from 'node:crypto'
import { readMigrationFiles } from 'drizzle-orm/migrator'

export interface AppliedMigration {
  hash: string
  created_at: number | string | null
}

/** Applied migrations are an immutable prefix of the migrations shipped with this app. */
export function assertMigrationHistory(folder: string, applied: AppliedMigration[]): void {
  const expected = readMigrationFiles({ migrationsFolder: folder })
  let previous = -Infinity
  for (const migration of expected) {
    if (!Number.isSafeInteger(migration.folderMillis) || migration.folderMillis <= previous)
      throw new Error('Unsafe migration history: migration timestamps must increase strictly')
    previous = migration.folderMillis
  }
  for (const [index, row] of applied.entries()) {
    const migration = expected.at(index)
    if (
      migration === undefined ||
      row.created_at === null ||
      Number(row.created_at) !== migration.folderMillis
    )
      throw new Error(
        'Incompatible migration history: database is newer or migrations are missing; use a compatible app image',
      )
    // Git may check out the same SQL with LF or CRLF on different hosts.
    const sql = migration.sql.join('--> statement-breakpoint').replace(/\r\n/g, '\n')
    const hashes = [sql, sql.replace(/\n/g, '\r\n')].map((text) =>
      createHash('sha256').update(text).digest('hex'),
    )
    if (!hashes.includes(row.hash))
      throw new Error(
        'Incompatible migration history: an applied migration was modified; restore the original migration',
      )
  }
}
