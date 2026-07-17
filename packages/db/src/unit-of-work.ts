import { AsyncLocalStorage } from 'node:async_hooks'
import { type TransactionContext, type UnitOfWork } from '@rivian-kanban/core'
import { type DbConnection } from './connection.ts'
import { createTransactionContext } from './repositories/transaction-context.ts'

/**
 * The UnitOfWork adapter: manual `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` on
 * the single shared better-sqlite3 connection.
 *
 * Why not drizzle's `transaction()`? Its better-sqlite3 callback is
 * synchronous, but core services `await` between repository calls inside one
 * unit of work — an async callback cannot run inside it. Manual transaction
 * control on the shared connection bridges the async/sync gap.
 *
 * ## INVARIANT — read before touching this class
 *
 * This is safe only because every repository method is synchronous under the
 * hood (better-sqlite3 executes inline; the methods return pre-resolved
 * Promises). An `await` chain inside `fn` therefore drains entirely in
 * microtasks without yielding to I/O, and `run` additionally serializes
 * callers through an in-process queue, so no other caller's statements can
 * interleave into the open transaction. Two rules keep it that way:
 *
 * 1. **Nothing inside `fn` may perform real async I/O** (network, disk,
 *    timers). Core already guarantees this: blob I/O, notifications, and SSE
 *    publishing all happen outside the unit of work. The repositories handed
 *    to `fn` via TransactionContext are the only database surface available.
 * 2. **Never nest**: calling `uow.run` from inside `fn` would deadlock on the
 *    serialization queue by design (a nested transaction is a logic error —
 *    SQLite has no nested BEGIN). The inner call would chain behind the outer
 *    task, which awaits the inner — a silent circular wait that also wedges
 *    every later `run` process-wide. Enforced: a reentrancy guard
 *    (AsyncLocalStorage) makes a nested `run` reject immediately instead.
 *
 * `BEGIN IMMEDIATE` (not DEFERRED) takes the write lock up front so a
 * read-then-write unit of work cannot hit SQLITE_BUSY mid-transaction; with
 * one connection per process (see connection.ts) contention only exists
 * against external processes, absorbed by busy_timeout.
 */
export class SqliteUnitOfWork implements UnitOfWork {
  private readonly connection: DbConnection
  private readonly context: TransactionContext
  /** Serialization queue: concurrent run() calls execute strictly one at a time. */
  private chain: Promise<unknown> = Promise.resolve()
  /** Reentrancy guard: set while `fn` executes so a nested run() fails fast. */
  private readonly inRun = new AsyncLocalStorage<true>()

  constructor(connection: DbConnection) {
    this.connection = connection
    this.context = createTransactionContext(connection.db)
  }

  run<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
    if (this.inRun.getStore() === true) {
      return Promise.reject(
        new Error(
          'nested UnitOfWork.run() — a unit of work must not open another (would deadlock the serialization queue)',
        ),
      )
    }
    const task = this.chain.then(() => this.inRun.run(true, () => this.runExclusive(fn)))
    this.chain = task.then(
      () => undefined,
      () => undefined,
    )
    return task
  }

  private async runExclusive<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
    const { raw } = this.connection
    raw.exec('BEGIN IMMEDIATE')
    try {
      const result = await fn(this.context)
      raw.exec('COMMIT')
      return result
    } catch (error) {
      // A failed statement may already have aborted the transaction.
      if (raw.inTransaction) raw.exec('ROLLBACK')
      throw error
    }
  }
}
