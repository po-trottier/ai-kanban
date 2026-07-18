import { describe, expect, it } from 'vitest'
import { DuplicatePositionError } from '../domain/errors.ts'
import { commentWith } from './defaults.ts'
import { createScenario } from './scenario.ts'
import { InMemoryDb } from './in-memory-db.ts'

describe('InMemoryDb — honest transactionality', () => {
  it('commits repository mutations when the unit of work succeeds', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard({ title: 'Before' })

    // Act
    await scenario.db.run(async (tx) => {
      const loaded = await tx.cards.findById(card.id)
      if (loaded) await tx.cards.update({ ...loaded, title: 'After' })
    })

    // Assert
    expect(scenario.db.getCard(card.id).title).toBe('After')
  })

  it('discards every mutation when the unit of work throws', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard({ title: 'Before' })

    // Act
    const act = scenario.db.run(async (tx) => {
      const loaded = await tx.cards.findById(card.id)
      if (loaded) await tx.cards.update({ ...loaded, title: 'Leaked?' })
      await tx.comments.insert(
        commentWith({
          id: '00000000-0000-7000-8000-00000000dead',
          cardId: card.id,
          authorId: card.reporterId,
          body: 'leaked comment',
          createdAt: card.createdAt,
        }),
      )
      throw new Error('boom')
    })

    // Assert
    await expect(act).rejects.toThrow('boom')
    expect(scenario.db.getCard(card.id).title).toBe('Before')
    expect(() => scenario.db.getComment('00000000-0000-7000-8000-00000000dead')).toThrow()
  })

  it('enforces UNIQUE(laneId, position) like the real backstop', async () => {
    // Arrange
    const scenario = createScenario()
    const existing = scenario.seedCard()
    const duplicate = { ...existing, id: existing.id + 1 }

    // Act
    const act = scenario.db.run((tx) => tx.cards.insert(duplicate))

    // Assert
    await expect(act).rejects.toBeInstanceOf(DuplicatePositionError)
  })

  it('isolates returned rows from committed state (defensive copies)', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard({ title: 'Immutable' })

    // Act
    const fetched = await scenario.db.run((tx) => tx.cards.findById(card.id))
    if (fetched) fetched.title = 'Mutated copy'

    // Assert
    expect(scenario.db.getCard(card.id).title).toBe('Immutable')
  })

  it('starts empty without the scenario seed', async () => {
    // Arrange
    const db = new InMemoryDb()

    // Act
    const lanes = await db.run((tx) => tx.lanes.listByBoard('any'))

    // Assert
    expect(lanes).toEqual([])
  })
})
