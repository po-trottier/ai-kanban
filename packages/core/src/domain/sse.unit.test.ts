import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import { sseHintSchema } from './sse.ts'

const UUID = '10000000-0000-7000-8000-000000000001'

describe('sseHintSchema (ADR-008 hint catalog)', () => {
  it('parses a card-scoped hint with cardId, version, and eventId', () => {
    // Arrange
    const hint = { type: 'card.status_changed', cardId: 42, version: 4, eventId: UUID }

    // Act
    const parsed = sseHintSchema.parse(hint)

    // Assert
    expect(parsed).toEqual(hint)
  })

  it('parses a board-scoped hint with no card fields', () => {
    // Arrange
    const hint = { type: 'policy.updated' }

    // Act
    const parsed = sseHintSchema.parse(hint)

    // Assert
    expect(parsed).toEqual(hint)
  })

  it('rejects a card-scoped hint missing its card fields', () => {
    // Arrange
    const hint = { type: 'card.created' }

    // Act
    const act = () => sseHintSchema.parse(hint)

    // Assert
    expect(act).toThrow(ZodError)
  })

  it('rejects a board-scoped hint carrying card fields', () => {
    // Arrange
    const hint = { type: 'lane.updated', cardId: UUID, version: 1, eventId: UUID }

    // Act
    const act = () => sseHintSchema.parse(hint)

    // Assert
    expect(act).toThrow(ZodError)
  })

  it('rejects an unknown hint type', () => {
    // Arrange
    const hint = { type: 'board.exploded' }

    // Act
    const act = () => sseHintSchema.parse(hint)

    // Assert
    expect(act).toThrow(ZodError)
  })
})
