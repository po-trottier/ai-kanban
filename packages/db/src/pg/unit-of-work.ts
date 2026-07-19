import { type TransactionContext, type UnitOfWork } from '@rivian-kanban/core'
import { type PgDb } from './database.ts'
import { createPgTransactionContext } from './transaction-context.ts'

/**
 * The Postgres UnitOfWork: a real `db.transaction()` per unit of work. Unlike
 * the SQLite adapter (which serializes callers through an in-process queue
 * because SQLite is single-writer, ADR-003/ADR-020), Postgres gives genuine
 * transactional isolation and multi-writer concurrency, so units of work run
 * concurrently — the transaction Drizzle opens holds for the whole async
 * callback, so an `await` chain between repository calls stays atomic.
 */
export class PostgresUnitOfWork implements UnitOfWork {
  private readonly db: PgDb

  constructor(db: PgDb) {
    this.db = db
  }

  run<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => fn(createPgTransactionContext(tx)))
  }

  read<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
    // A transaction gives each read a consistent snapshot; it never writes.
    return this.db.transaction((tx) => fn(createPgTransactionContext(tx)))
  }
}
