import { DuplicatePositionError } from '@rivian-kanban/core'

/**
 * SQLite constraint-error translation. better-sqlite3 throws `SqliteError`
 * (message `UNIQUE constraint failed: <table>.<col>, …`, `code`
 * `SQLITE_CONSTRAINT_*`); drizzle wraps it in `DrizzleQueryError` with the
 * driver error on `cause`. These helpers walk the cause chain so mapping works
 * on either shape.
 */

/**
 * Messages of the driver's own constraint errors in the `cause` chain,
 * identified structurally by `code` (`SQLITE_CONSTRAINT*`). Wrapper messages
 * are deliberately excluded: DrizzleQueryError embeds the bound params —
 * user-controlled text (e.g. a pasted error log in a card description) must
 * never be able to masquerade as a constraint violation.
 */
function constraintMessagesIn(error: unknown): string[] {
  const messages: string[] = []
  let current: unknown = error
  while (current instanceof Error) {
    if (
      'code' in current &&
      typeof current.code === 'string' &&
      current.code.startsWith('SQLITE_CONSTRAINT')
    ) {
      messages.push(current.message)
    }
    current = current.cause
  }
  return messages
}

/**
 * True when the error (or any cause) is a driver UNIQUE violation covering
 * every one of the given `table.column` names.
 */
export function isUniqueViolation(error: unknown, qualifiedColumns: readonly string[]): boolean {
  return constraintMessagesIn(error).some(
    (message) =>
      message.includes('UNIQUE constraint failed') &&
      qualifiedColumns.every((column) => message.includes(column)),
  )
}

/** Rejection reasons must be Errors; non-Error throwables get wrapped. */
export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

/**
 * Maps a card-write failure to the port-contract error: the
 * `UNIQUE(lane_id, position)` backstop becomes DuplicatePositionError — the
 * exact type CardService's one-retry logic depends on (ADR-006). Anything
 * else passes through untouched.
 */
export function mapCardWriteError(error: unknown): Error {
  if (isUniqueViolation(error, ['cards.lane_id', 'cards.position'])) {
    return new DuplicatePositionError()
  }
  return toError(error)
}
