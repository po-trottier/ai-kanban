import { describe, expect, it } from 'vitest'
import { NotFoundError } from '../domain/errors.ts'
import { createScenario } from '../testing/index.ts'

describe('CardWatchService', () => {
  it('watches (idempotently) then unwatches a card', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard()
    const actor = scenario.actors.technician

    // Act — watching twice is a no-op (unique row); then unwatch.
    await scenario.watch.watch(actor, card.id)
    await scenario.watch.watch(actor, card.id)

    // Assert — exactly one watcher row, and isWatching reflects it.
    expect(await scenario.watch.isWatching(actor, card.id)).toBe(true)
    expect(scenario.db.watcherIdsFor(card.id).filter((id) => id === actor.id)).toHaveLength(1)

    await scenario.watch.unwatch(actor, card.id)
    expect(await scenario.watch.isWatching(actor, card.id)).toBe(false)
  })

  it('404s watching a card that does not exist', async () => {
    // Arrange
    const scenario = createScenario()

    // Act
    const act = scenario.watch.watch(scenario.actors.requester, 999_999)

    // Assert
    await expect(act).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('CardService auto-watch', () => {
  it('auto-watches the reporter AND the assignee on create', async () => {
    // Arrange
    const scenario = createScenario()
    // Act — the requester files a card assigned to the technician.
    const card = await scenario.cards.create(scenario.actors.requester, {
      title: 'Fix the boiler',
      priority: 'P2',
      assigneeId: scenario.users.technician.id,
    })

    // Assert — both follow the card by default.
    const watchers = scenario.db.watcherIdsFor(card.id)
    expect(watchers).toContain(scenario.actors.requester.id)
    expect(watchers).toContain(scenario.users.technician.id)
  })

  it('auto-watches a newly-assigned user on update', async () => {
    // Arrange — a card with no assignee.
    const scenario = createScenario()
    const card = await scenario.cards.create(scenario.actors.requester, {
      title: 'Unassigned',
      priority: 'P2',
    })
    expect(scenario.db.watcherIdsFor(card.id)).not.toContain(scenario.users.technician.id)

    // Act — assign the technician.
    await scenario.cards.update(scenario.actors.requester, card.id, {
      assigneeId: scenario.users.technician.id,
      expectedVersion: card.version,
    })

    // Assert — the new assignee now watches the card.
    expect(scenario.db.watcherIdsFor(card.id)).toContain(scenario.users.technician.id)
  })
})
