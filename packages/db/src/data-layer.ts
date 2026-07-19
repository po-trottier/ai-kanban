import { type UnitOfWork } from '@rivian-kanban/core'
import { type DbConnection, openDatabase } from './connection.ts'
import { openPgConnection, type PgConnection } from './pg/connection.ts'
import { structuralSeedPg } from './pg/seed.ts'
import { PostgresUnitOfWork } from './pg/unit-of-work.ts'
import { demoSeed, structuralSeed } from './seed.ts'
import { SqliteUnitOfWork } from './unit-of-work.ts'

/**
 * The engine-agnostic data layer behind the app's ports (ADR-020): a
 * `UnitOfWork` plus the structural-seed result. SQLite (dev, the default) and
 * PostgreSQL (production, selected by `DATABASE_URL`) both satisfy it. The
 * SQLite-only operational surface (VACUUM snapshots, the db-size metric) reaches
 * for `sqliteConnection`, which is null on Postgres — Postgres has its own
 * backup/observability story.
 */
export interface DataLayer {
  uow: UnitOfWork
  boardId: string
  systemUserId: string
  /** The SQLite handle — VACUUM snapshots + db-size metric — or null on Postgres. */
  sqliteConnection: DbConnection | null
  /** Seeds the demo dataset (dev only). */
  seedDemo: () => void
  close: () => Promise<void>
}

/** SQLite (dev/test/single-node): one write connection + read companion (ADR-003). */
export function createSqliteDataLayer(databasePath: string, migrationsDir?: string): DataLayer {
  const connection = openDatabase(databasePath, migrationsDir)
  const { boardId, systemUserId } = structuralSeed(connection.db)
  return {
    uow: new SqliteUnitOfWork(connection),
    boardId,
    systemUserId,
    sqliteConnection: connection,
    seedDemo: () => {
      demoSeed(connection.db)
    },
    close: () => {
      connection.close()
      return Promise.resolve()
    },
  }
}

/** Wraps an already-open pg connection (node-postgres in prod, PGlite in tests) as a DataLayer. */
export async function createPgDataLayerFrom(connection: PgConnection): Promise<DataLayer> {
  const { boardId, systemUserId } = await structuralSeedPg(connection.db)
  return {
    uow: new PostgresUnitOfWork(connection.db),
    boardId,
    systemUserId,
    sqliteConnection: null,
    seedDemo: () => {
      throw new Error('the demo dataset seed is SQLite-only; run the dev server on SQLite for it')
    },
    close: () => connection.close(),
  }
}

/** PostgreSQL (production): a pooled node-postgres connection (ADR-020). */
/* v8 ignore next 3 -- prod-only node-postgres wiring; PGlite proves the layer via createPgDataLayerFrom */
export async function createPgDataLayer(url: string, migrationsDir?: string): Promise<DataLayer> {
  return createPgDataLayerFrom(await openPgConnection(url, migrationsDir))
}

/** Picks the engine: `DATABASE_URL` → Postgres (production); else SQLite (dev). */
export function createDataLayer(opts: {
  databaseUrl: string | undefined
  databasePath: string
  sqliteMigrationsDir?: string | undefined
  pgMigrationsDir?: string | undefined
}): Promise<DataLayer> {
  if (opts.databaseUrl !== undefined && opts.databaseUrl !== '') {
    /* v8 ignore next -- prod-only; pg tests inject the data layer directly */
    return createPgDataLayer(opts.databaseUrl, opts.pgMigrationsDir)
  }
  return Promise.resolve(createSqliteDataLayer(opts.databasePath, opts.sqliteMigrationsDir))
}
