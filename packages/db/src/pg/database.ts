import { type PgDatabase, type PgQueryResultHKT } from 'drizzle-orm/pg-core'

/**
 * What a pg repository runs against: either the pooled database or an open
 * transaction (both are a `PgDatabase`), so the same repository body serves a
 * standalone query and a unit-of-work statement. The concrete driver (PGlite
 * in tests, node-postgres in production) is irrelevant here.
 */
export type PgDb = PgDatabase<PgQueryResultHKT>
