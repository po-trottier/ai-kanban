import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres'
import { migrate as migrateNodePg } from 'drizzle-orm/node-postgres/migrator'
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite'
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator'
// node-postgres is CommonJS — the named `Pool` export isn't ESM-importable.
import pg from 'pg'
import { type PgDb } from './database.ts'
import { sql } from 'drizzle-orm'
import { assertMigrationHistory } from '../migration-history.ts'

/**
 * A Postgres database handle for the unit of work (ADR-020). Two drivers back
 * it: node-postgres for production (a real server, launched by docker-compose)
 * and PGlite for tests (an in-process WASM Postgres — real pg SQL, no server or
 * Docker). Both run the committed pg migrations (./migrations/pg) on open.
 */
export interface PgConnection {
  db: PgDb
  close: () => Promise<void>
}

/** ./migrations/pg from this module; production passes MIGRATIONS_DIR explicitly. */
function defaultMigrationsFolder(): string {
  return fileURLToPath(new URL('../../migrations/pg', import.meta.url))
}

async function checkHistory(db: PgDb, folder: string): Promise<void> {
  const [history] = await db
    .select({
      exists: sql<boolean>`to_regclass('drizzle.__drizzle_migrations') is not null`,
      populated: sql<boolean>`to_regclass('public.boards') is not null`,
    })
    .from(sql`pg_catalog.pg_namespace`)
    .limit(1)
  const applied = history?.exists
    ? await db
        .select({ hash: sql<string>`hash`, created_at: sql<string | number | null>`created_at` })
        .from(sql`drizzle.__drizzle_migrations`)
        .orderBy(sql`created_at`)
    : []
  if (applied.length === 0 && history?.populated)
    throw new Error(
      'Missing migration history on an existing database; restore its migration history before upgrading',
    )
  assertMigrationHistory(folder, applied)
}

/**
 * Production: a pooled node-postgres connection to `DATABASE_URL`. The
 * node-postgres wire driver needs a real server, so this is not exercised
 * in-process — PGlite proves the identical SQL against the same repositories
 * and unit of work (ADR-020).
 */
/* v8 ignore start */
export async function openPgConnection(
  url: string,
  migrationsFolder?: string,
): Promise<PgConnection> {
  const pool = new pg.Pool({ connectionString: url })
  const db = drizzleNodePg({ client: pool })
  try {
    const folder = migrationsFolder ?? defaultMigrationsFolder()
    await checkHistory(db, folder)
    await migrateNodePg(db, { migrationsFolder: folder })
  } catch (error) {
    await pool.end()
    throw error
  }
  return {
    db,
    close: async () => {
      await pool.end()
    },
  }
}
/* v8 ignore stop */

/** Tests: an in-process PGlite database (real Postgres semantics, no server). */
export async function openPgliteConnection(
  migrationsFolder?: string,
  dataDir?: string,
): Promise<PgConnection> {
  const client = new PGlite(dataDir)
  const db = drizzlePglite(client)
  try {
    const folder = migrationsFolder ?? defaultMigrationsFolder()
    await checkHistory(db, folder)
    await migratePglite(db, { migrationsFolder: folder })
  } catch (error) {
    await client.close()
    throw error
  }
  return {
    db,
    close: async () => {
      await client.close()
    },
  }
}
