import { DuplicatePositionError } from '@rivian-kanban/core'
import { describe, expect, it } from 'vitest'
import { isUniqueViolation, mapCardWriteError, toError } from './errors.ts'

const positionViolation = 'UNIQUE constraint failed: cards.lane_id, cards.position'

/** A better-sqlite3 SqliteError shape: message plus a SQLITE_* `code`. */
function driverError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code })
}

describe('isUniqueViolation', () => {
  it('matches a direct driver error naming every column', () => {
    // Arrange
    const error = driverError(positionViolation, 'SQLITE_CONSTRAINT_UNIQUE')

    // Act
    const result = isUniqueViolation(error, ['cards.lane_id', 'cards.position'])

    // Assert
    expect(result).toBe(true)
  })

  it('walks the cause chain of a wrapped query error', () => {
    // Arrange
    const wrapped = new Error('Failed query: insert into "cards" …', {
      cause: driverError(positionViolation, 'SQLITE_CONSTRAINT_UNIQUE'),
    })

    // Act
    const result = isUniqueViolation(wrapped, ['cards.lane_id', 'cards.position'])

    // Assert
    expect(result).toBe(true)
  })

  it('rejects a unique violation on different columns', () => {
    // Arrange
    const error = driverError('UNIQUE constraint failed: tags.name', 'SQLITE_CONSTRAINT_UNIQUE')

    // Act
    const result = isUniqueViolation(error, ['cards.lane_id', 'cards.position'])

    // Assert
    expect(result).toBe(false)
  })

  it('ignores the magic strings in messages without a SQLITE_CONSTRAINT code', () => {
    // Arrange — DrizzleQueryError embeds bound params in its message; a pasted
    // error log inside a card description must not spoof a UNIQUE violation.
    const spoofed = new Error(
      `Failed query: update "cards" …\nparams: pasted log: ${positionViolation}`,
      { cause: driverError('FOREIGN KEY constraint failed', 'SQLITE_CONSTRAINT_FOREIGNKEY') },
    )

    // Act
    const result = isUniqueViolation(spoofed, ['cards.lane_id', 'cards.position'])

    // Assert
    expect(result).toBe(false)
  })

  it('rejects non-error values', () => {
    // Arrange
    const error: unknown = 'UNIQUE constraint failed: cards.lane_id, cards.position'

    // Act
    const result = isUniqueViolation(error, ['cards.lane_id', 'cards.position'])

    // Assert
    expect(result).toBe(false)
  })
})

describe('mapCardWriteError', () => {
  it('maps the lane/position backstop to DuplicatePositionError', () => {
    // Arrange
    const error = new Error('Failed query', {
      cause: driverError(positionViolation, 'SQLITE_CONSTRAINT_UNIQUE'),
    })

    // Act
    const mapped = mapCardWriteError(error)

    // Assert
    expect(mapped).toBeInstanceOf(DuplicatePositionError)
  })

  it('passes every other error through untouched', () => {
    // Arrange
    const error = driverError('FOREIGN KEY constraint failed', 'SQLITE_CONSTRAINT_FOREIGNKEY')

    // Act
    const mapped = mapCardWriteError(error)

    // Assert
    expect(mapped).toBe(error)
  })
})

describe('toError', () => {
  it('returns Error instances unchanged', () => {
    // Arrange
    const error = new Error('already an error')

    // Act
    const result = toError(error)

    // Assert
    expect(result).toBe(error)
  })

  it('wraps non-Error throwables so rejection reasons are always Errors', () => {
    // Arrange
    const thrown: unknown = 'a bare string'

    // Act
    const result = toError(thrown)

    // Assert
    expect(result).toBeInstanceOf(Error)
    expect(result.message).toBe('a bare string')
  })
})
