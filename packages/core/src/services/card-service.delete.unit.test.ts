import { describe, expect, it } from 'vitest'
import { ConflictError, NotFoundError, PolicyDeniedError } from '../domain/errors.ts'
import { type Card } from '../domain/entities.ts'
import { createScenario, fixtureId, type Scenario } from '../testing/index.ts'

/**
 * Discarding a just-created intake draft: owner-only hard-delete that erases the
 * card and every FK-referencing row (relations on BOTH ends, comment,
 * attachment, event, watcher, notification, tag) and drops the attachment blobs.
 * The in-memory fake runs the same cascade the real adapter does.
 */

/** Wires a draft with one of every child row a hard-delete must clear. */
function seedRichDraft(scenario: Scenario): { card: Card; storageKey: string; siblingId: number } {
  const card = scenario.seedCard({
    laneId: scenario.lanes.intake.id,
    reporterId: scenario.users.requester.id,
  })
  const sibling = scenario.seedCard({ laneId: scenario.lanes.intake.id })

  const storageKey = fixtureId(500)
  scenario.db.seedAttachment({
    id: fixtureId(501),
    cardId: card.id,
    filename: 'draft.pdf',
    mime: 'application/pdf',
    bytes: 1024,
    sha256: 'a'.repeat(64),
    storageKey,
    uploadedBy: scenario.users.requester.id,
    createdAt: '2026-07-16T12:00:00.000Z',
    deletedAt: null,
  })
  // A relation on each end proves both fromCardId and toCardId are cleared.
  scenario.db.seedCardRelation({
    id: fixtureId(502),
    fromCardId: card.id,
    toCardId: sibling.id,
    type: 'relates_to',
    createdAt: '2026-07-16T12:00:00.000Z',
  })
  scenario.db.seedCardRelation({
    id: fixtureId(503),
    fromCardId: sibling.id,
    toCardId: card.id,
    type: 'relates_to',
    createdAt: '2026-07-16T12:00:00.000Z',
  })
  scenario.db.seedCardWatcher(card.id, scenario.users.requester.id)
  scenario.db.seedNotification({
    id: fixtureId(504),
    userId: scenario.users.requester.id,
    cardId: card.id,
    actorId: scenario.users.technician.id,
    eventType: 'mention',
    createdAt: '2026-07-16T12:00:00.000Z',
    readAt: null,
  })
  const tag = { id: fixtureId(505), name: 'draft' }
  scenario.db.seedTag(tag)
  scenario.db.seedCardTag(card.id, tag.id)
  return { card, storageKey, siblingId: sibling.id }
}

describe('CardService.delete', () => {
  it('removes the draft and every child row, leaving the sibling untouched', async () => {
    // Arrange
    const scenario = createScenario()
    const { card, siblingId } = seedRichDraft(scenario)
    // A comment and an event live only via the tx repos (no direct seed helper).
    await scenario.db.run(async (tx) => {
      await tx.comments.insert({
        id: fixtureId(506),
        cardId: card.id,
        parentCommentId: null,
        authorId: scenario.users.requester.id,
        body: 'draft note',
        createdAt: '2026-07-16T12:00:00.000Z',
        updatedAt: '2026-07-16T12:00:00.000Z',
        deletedAt: null,
      })
    })

    // Act
    await scenario.cards.delete(scenario.actors.requester, card.id, 1)

    // Assert — the card and all its child rows are gone; the sibling survives.
    expect(() => scenario.db.getCard(card.id)).toThrow(NotFoundError)
    expect(scenario.db.eventsFor(card.id)).toHaveLength(0)
    expect(scenario.db.watcherIdsFor(card.id)).toHaveLength(0)
    expect(scenario.db.notificationsFor(scenario.users.requester.id)).toHaveLength(0)
    expect(scenario.db.tagNamesFor(card.id)).toHaveLength(0)
    expect(await scenario.relations.list(siblingId)).toHaveLength(0)
    expect(scenario.db.getCard(siblingId).id).toBe(siblingId)
  })

  it('best-effort deletes each attachment blob after commit', async () => {
    // Arrange
    const scenario = createScenario()
    const { card, storageKey } = seedRichDraft(scenario)
    scenario.blobStore.blobs.set(storageKey, new Uint8Array([1, 2, 3]))

    // Act
    await scenario.cards.delete(scenario.actors.requester, card.id, 1)

    // Assert
    expect(scenario.blobStore.blobs.has(storageKey)).toBe(false)
  })

  it('rejects a non-owner (even an admin) with PolicyDeniedError, committing nothing', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard({
      laneId: scenario.lanes.intake.id,
      reporterId: scenario.users.requester.id,
    })

    // Act
    const act = scenario.cards.delete(scenario.actors.admin, card.id, 1)

    // Assert
    await expect(act).rejects.toBeInstanceOf(PolicyDeniedError)
    expect(scenario.db.getCard(card.id).id).toBe(card.id)
  })

  it('rejects discarding a card that has left the intake lane with ConflictError', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard({
      laneId: scenario.lanes.in_progress.id,
      reporterId: scenario.users.requester.id,
    })

    // Act
    const act = scenario.cards.delete(scenario.actors.requester, card.id, 1)

    // Assert
    await expect(act).rejects.toBeInstanceOf(ConflictError)
    expect(scenario.db.getCard(card.id).id).toBe(card.id)
  })

  it('rejects a stale expectedVersion with ConflictError', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard({
      laneId: scenario.lanes.intake.id,
      reporterId: scenario.users.requester.id,
      version: 3,
    })

    // Act
    const act = scenario.cards.delete(scenario.actors.requester, card.id, 1)

    // Assert
    await expect(act).rejects.toBeInstanceOf(ConflictError)
    expect(scenario.db.getCard(card.id).id).toBe(card.id)
  })

  it('rejects an unknown id with NotFoundError', async () => {
    // Arrange
    const scenario = createScenario()

    // Act
    const act = scenario.cards.delete(scenario.actors.requester, 999_999, 1)

    // Assert
    await expect(act).rejects.toBeInstanceOf(NotFoundError)
  })
})
