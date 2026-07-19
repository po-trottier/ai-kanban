import { describe, expect, it } from 'vitest'
import { ConflictError, NotFoundError } from '../domain/errors.ts'
import { createScenario } from '../testing/index.ts'

describe('CardRelationService.create', () => {
  it('links two cards and returns the outgoing view of the target', async () => {
    // Arrange
    const scenario = createScenario()
    const from = scenario.seedCard({ title: 'Repair panel' })
    const to = scenario.seedCard({ title: 'Order parts' })

    // Act — the route card `from` blocks `to`.
    const view = await scenario.relations.create(from.id, { toCardId: to.id, type: 'blocks' })

    // Assert — the creating card sees it outgoing, pointing at the target.
    expect(view).toMatchObject({
      type: 'blocks',
      direction: 'outgoing',
      card: { id: to.id, title: 'Order parts' },
    })
  })

  it('rejects relating a card to itself (409)', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard()

    // Act
    const act = scenario.relations.create(card.id, { toCardId: card.id, type: 'relates_to' })

    // Assert
    await expect(act).rejects.toBeInstanceOf(ConflictError)
  })

  it('rejects a duplicate relation, including the reverse of a symmetric one (409)', async () => {
    // Arrange — a symmetric `relates_to` from A to B.
    const scenario = createScenario()
    const a = scenario.seedCard()
    const b = scenario.seedCard()
    await scenario.relations.create(a.id, { toCardId: b.id, type: 'relates_to' })

    // Act — the exact same, and the REVERSE (B relates A) — both are "already there".
    const same = scenario.relations.create(a.id, { toCardId: b.id, type: 'relates_to' })
    const reverse = scenario.relations.create(b.id, { toCardId: a.id, type: 'relates_to' })

    // Assert
    await expect(same).rejects.toBeInstanceOf(ConflictError)
    await expect(reverse).rejects.toBeInstanceOf(ConflictError)
  })

  it('allows the reverse of a DIRECTIONAL relation (blocks ≠ blocked-by is one row each way)', async () => {
    // Arrange — A blocks B.
    const scenario = createScenario()
    const a = scenario.seedCard()
    const b = scenario.seedCard()
    await scenario.relations.create(a.id, { toCardId: b.id, type: 'blocks' })

    // Act — B blocks A is a DIFFERENT relation (not a duplicate).
    const view = await scenario.relations.create(b.id, { toCardId: a.id, type: 'blocks' })

    // Assert
    expect(view).toMatchObject({ type: 'blocks', direction: 'outgoing', card: { id: a.id } })
  })

  it('404s when the target card does not exist', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard()

    // Act
    const act = scenario.relations.create(card.id, { toCardId: 999_999, type: 'blocks' })

    // Assert
    await expect(act).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('CardRelationService.list', () => {
  it('resolves each relation to the other card with the viewing direction', async () => {
    // Arrange — the subject BLOCKS one card and IS DUPLICATED BY another.
    const scenario = createScenario()
    const subject = scenario.seedCard({ title: 'Subject' })
    const blocked = scenario.seedCard({ title: 'Downstream' })
    const dupe = scenario.seedCard({ title: 'Older dupe' })
    await scenario.relations.create(subject.id, { toCardId: blocked.id, type: 'blocks' })
    // `dupe` duplicates `subject`, so from the subject's side it is INCOMING.
    await scenario.relations.create(dupe.id, { toCardId: subject.id, type: 'duplicates' })

    // Act
    const views = await scenario.relations.list(subject.id)

    // Assert — outgoing blocks + incoming duplicates, each naming the other card.
    expect(views).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'blocks',
          direction: 'outgoing',
          card: { id: blocked.id, title: 'Downstream' },
        }),
        expect.objectContaining({
          type: 'duplicates',
          direction: 'incoming',
          card: { id: dupe.id, title: 'Older dupe' },
        }),
      ]),
    )
  })
})

describe('CardRelationService.delete', () => {
  it('removes a relation touching the card', async () => {
    // Arrange
    const scenario = createScenario()
    const a = scenario.seedCard()
    const b = scenario.seedCard()
    const view = await scenario.relations.create(a.id, { toCardId: b.id, type: 'blocks' })

    // Act — delete from EITHER card's side (here the `to` card, `b`).
    await scenario.relations.delete(b.id, view.id)

    // Assert — gone from both cards.
    expect(await scenario.relations.list(a.id)).toEqual([])
    expect(await scenario.relations.list(b.id)).toEqual([])
  })

  it('404s deleting a relation that does not touch the card', async () => {
    // Arrange — a relation between A and B, plus an unrelated card C.
    const scenario = createScenario()
    const a = scenario.seedCard()
    const b = scenario.seedCard()
    const c = scenario.seedCard()
    const view = await scenario.relations.create(a.id, { toCardId: b.id, type: 'blocks' })

    // Act — C tries to delete A↔B's relation.
    const act = scenario.relations.delete(c.id, view.id)

    // Assert
    await expect(act).rejects.toBeInstanceOf(NotFoundError)
  })
})
