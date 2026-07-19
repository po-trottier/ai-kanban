import { DuplicatePositionError } from '@rivian-kanban/core'
import { toError } from '../errors.ts'

/**
 * PostgreSQL constraint-error translation — the pg analogue of the sqlite
 * `errors.ts`. node-postgres and PGlite both throw an error carrying the
 * SQLSTATE `code` (`23505` unique, `23503` foreign-key) and the offending
 * `constraint` name; drizzle wraps it in `DrizzleQueryError` with the driver
 * error on `cause`. These helpers walk the cause chain and match structurally
 * by code, so a user-controlled string can never masquerade as a violation.
 */
function pgConstraintErrorsIn(error: unknown): { code: string; constraint: string }[] {
  const found: { code: string; constraint: string }[] = []
  let current: unknown = error
  while (current instanceof Error) {
    if ('code' in current && typeof current.code === 'string') {
      const constraint =
        'constraint' in current && typeof current.constraint === 'string' ? current.constraint : ''
      found.push({ code: current.code, constraint })
    }
    current = current.cause
  }
  return found
}

/** True when the error (or any cause) is a UNIQUE violation on one of the named constraints. */
export function isPgUniqueViolation(error: unknown, constraintNames: readonly string[]): boolean {
  return pgConstraintErrorsIn(error).some(
    (candidate) => candidate.code === '23505' && constraintNames.includes(candidate.constraint),
  )
}

/** True when the error (or any cause) is a FOREIGN KEY violation. */
export function isPgForeignKeyViolation(error: unknown): boolean {
  return pgConstraintErrorsIn(error).some((candidate) => candidate.code === '23503')
}

/**
 * The pg analogue of `mapCardWriteError`: the `UNIQUE(lane_id, position)`
 * backstop becomes DuplicatePositionError — the type CardService's one-retry
 * logic depends on (ADR-006). Anything else passes through untouched.
 */
export function mapPgCardWriteError(error: unknown): Error {
  if (isPgUniqueViolation(error, ['cards_lane_id_position_unique'])) {
    return new DuplicatePositionError()
  }
  return toError(error)
}
