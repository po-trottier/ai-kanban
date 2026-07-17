import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

/** One process-wide database handle (single-writer, ADR-003/deployment.md). */
export interface DbConnection {
  /** Drizzle over the single shared connection — what repositories consume. */
  db: BetterSQLite3Database
  /** The raw driver handle: transaction control (unit-of-work), pragmas, close. */
  raw: Database.Database
  close(): void
}

/**
 * Opens (or creates) the SQLite database file, applies the mandatory pragmas
 * (deployment.md#database-operations), and runs any pending committed
 * migrations. Open **exactly one** connection per process: better-sqlite3 is
 * synchronous, SQLite is single-writer, and the unit-of-work's manual
 * BEGIN/COMMIT discipline assumes no other connection shares the file from
 * this process.
 *
 * `migrationsFolder` defaults to this package's checked-in ./migrations; the
 * production bundle passes MIGRATIONS_DIR explicitly because esbuild
 * relocates this module away from the source tree (deployment.md#image).
 */
export function openDatabase(databasePath: string, migrationsFolder?: string): DbConnection {
  mkdirSync(dirname(databasePath), { recursive: true })
  const raw = new Database(databasePath)
  raw.pragma('journal_mode = WAL')
  raw.pragma('synchronous = NORMAL')
  raw.pragma('busy_timeout = 5000')
  raw.pragma('foreign_keys = ON')
  const db = drizzle({ client: raw })
  migrate(db, {
    migrationsFolder: migrationsFolder ?? fileURLToPath(new URL('../migrations', import.meta.url)),
  })
  return {
    db,
    raw,
    close: () => {
      raw.close()
    },
  }
}
