import { describe, expect, it } from 'vitest'
import { ArchivedError, NotFoundError, PolicyDeniedError } from '../domain/errors.ts'
import { createScenario, type Scenario } from '../testing/index.ts'

async function seedComment(scenario: Scenario, cardId: number, authorId: string) {
  return scenario.comments.add({ kind: 'user', id: authorId, role: 'user' }, cardId, {
    body: 'first comment',
  })
}

describe('CommentService.add', () => {
  it('persists a top-level comment and audits comment.added', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard()

    // Act
    const comment = await scenario.comments.add(scenario.actors.requester, card.id, {
      body: 'Please check the door hinge',
    })

    // Assert
    expect(scenario.db.getComment(comment.id)).toMatchObject({
      cardId: card.id,
      parentCommentId: null,
      authorId: scenario.actors.requester.id,
      body: 'Please check the door hinge',
      deletedAt: null,
    })
    expect(scenario.db.eventsFor(card.id).at(0)).toMatchObject({
      eventType: 'comment.added',
      payload: { commentId: comment.id },
    })
    expect(scenario.eventBus.published.at(0)?.type).toBe('comment.added')
  })

  it('attaches a reply to a reply to the same top-level parent (one nesting level)', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard()
    const top = await seedComment(scenario, card.id, scenario.users.technician.id)
    const reply = await scenario.comments.add(scenario.actors.requester, card.id, {
      body: 'a reply',
      parentCommentId: top.id,
    })

    // Act
    const replyToReply = await scenario.comments.add(scenario.actors.supervisor, card.id, {
      body: 'a reply to the reply',
      parentCommentId: reply.id,
    })

    // Assert
    expect(reply.parentCommentId).toBe(top.id)
    expect(replyToReply.parentCommentId).toBe(top.id)
  })

  it('rejects a parent comment that belongs to another card', async () => {
    // Arrange
    const scenario = createScenario()
    const cardA = scenario.seedCard()
    const cardB = scenario.seedCard()
    const foreign = await seedComment(scenario, cardA.id, scenario.users.technician.id)

    // Act
    const act = scenario.comments.add(scenario.actors.requester, cardB.id, {
      body: 'misfiled reply',
      parentCommentId: foreign.id,
    })

    // Assert
    await expect(act).rejects.toBeInstanceOf(NotFoundError)
  })

  it('treats archived cards as read-only', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard({
      laneId: scenario.lanes.done.id,
      resolution: 'completed',
      archivedAt: '2026-04-01T00:00:00.000Z',
    })

    // Act
    const act = scenario.comments.add(scenario.actors.requester, card.id, { body: 'too late' })

    // Assert
    await expect(act).rejects.toBeInstanceOf(ArchivedError)
  })

  it('rejects an MCP comment whose token id resolves to no author user', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard()

    // Act — comments.author_id is an FK to users; a token id is not a user
    const act = scenario.comments.add(scenario.actors.mcpReadWrite, card.id, {
      body: 'agent note',
    })

    // Assert
    await expect(act).rejects.toBeInstanceOf(NotFoundError)
    await expect(act).rejects.toMatchObject({ resource: 'author' })
  })

  it('records the adapter-resolved author for MCP comments, auditing the token actor', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard()

    // Act
    const comment = await scenario.comments.add(
      scenario.actors.mcpReadWrite,
      card.id,
      { body: 'agent note' },
      { authorId: scenario.systemUser.id },
    )

    // Assert
    expect(comment.authorId).toBe(scenario.systemUser.id)
    expect(scenario.db.eventsFor(card.id).at(0)).toMatchObject({
      eventType: 'comment.added',
      actorKind: 'mcp',
      actorId: scenario.actors.mcpReadWrite.id,
    })
  })
})

describe('CommentService.edit', () => {
  it('lets the author edit and audits comment.edited', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard()
    const comment = await seedComment(scenario, card.id, scenario.users.technician.id)

    // Act
    const edited = await scenario.comments.edit(scenario.actors.technician, comment.id, {
      body: 'corrected text',
    })

    // Assert
    expect(edited.body).toBe('corrected text')
    expect(scenario.db.getComment(comment.id).body).toBe('corrected text')
    expect(scenario.db.eventsFor(card.id).at(-1)?.eventType).toBe('comment.edited')
  })

  it('denies everyone but the author, even admins', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard()
    const comment = await seedComment(scenario, card.id, scenario.users.technician.id)

    // Act
    const act = scenario.comments.edit(scenario.actors.admin, comment.id, { body: 'hijack' })

    // Assert
    await expect(act).rejects.toBeInstanceOf(PolicyDeniedError)
    await expect(act).rejects.toMatchObject({ rule: 'comment-author-only' })
    expect(scenario.db.getComment(comment.id).body).toBe('first comment')
  })

  it('rejects editing a soft-deleted comment', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard()
    const comment = await seedComment(scenario, card.id, scenario.users.technician.id)
    await scenario.comments.softDelete(scenario.actors.technician, comment.id)

    // Act
    const act = scenario.comments.edit(scenario.actors.technician, comment.id, { body: 'undead' })

    // Assert
    await expect(act).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('CommentService.softDelete', () => {
  it('soft-deletes with a timestamp, keeping the row for thread shape', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard()
    const top = await seedComment(scenario, card.id, scenario.users.technician.id)
    const reply = await scenario.comments.add(scenario.actors.requester, card.id, {
      body: 'reply',
      parentCommentId: top.id,
    })

    // Act
    await scenario.comments.softDelete(scenario.actors.requester, reply.id)

    // Assert
    expect(scenario.db.getComment(reply.id).deletedAt).toBe('2026-07-16T12:00:00.000Z')
    expect(scenario.db.eventsFor(card.id).at(-1)).toMatchObject({
      eventType: 'comment.deleted',
      payload: { commentId: reply.id, parentCommentId: top.id },
    })
  })

  it('lets a non-author with the comment.deleteOthers grant delete', async () => {
    // Arrange — admin grants comment.deleteOthers by default.
    const scenario = createScenario()
    const card = scenario.seedCard()
    const comment = await seedComment(scenario, card.id, scenario.users.technician.id)

    // Act
    const deleted = await scenario.comments.softDelete(scenario.actors.admin, comment.id)

    // Assert
    expect(deleted.deletedAt).not.toBeNull()
  })

  it('denies deleting others’ comments by default (user lacks comment.deleteOthers)', async () => {
    // Arrange — the default `user` role does not grant comment.deleteOthers.
    const scenario = createScenario()
    const card = scenario.seedCard()
    const comment = await seedComment(scenario, card.id, scenario.users.technician.id)

    // Act
    const denied = scenario.comments.softDelete(scenario.actors.requester, comment.id)

    // Assert
    await expect(denied).rejects.toBeInstanceOf(PolicyDeniedError)
    await expect(denied).rejects.toMatchObject({ rule: 'permission:comment.deleteOthers' })
    expect(scenario.db.getComment(comment.id).deletedAt).toBeNull()
  })

  it('lets an admin delete others’ comments (admin grants comment.deleteOthers)', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard()
    const comment = await seedComment(scenario, card.id, scenario.users.technician.id)

    // Act
    const deleted = await scenario.comments.softDelete(scenario.actors.supervisor, comment.id)

    // Assert
    expect(deleted.deletedAt).not.toBeNull()
  })
})

describe('CommentService.listForCard', () => {
  it('returns the thread oldest-first with soft-deleted bodies blanked', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard()
    const first = await seedComment(scenario, card.id, scenario.users.technician.id)
    scenario.clock.advanceDays(1)
    const second = await scenario.comments.add(scenario.actors.requester, card.id, {
      body: 'later comment',
    })
    await scenario.comments.softDelete(scenario.actors.technician, first.id)

    // Act
    const thread = await scenario.comments.listForCard(card.id)

    // Assert — thread shape kept, but deleted content never leaves the
    // server on ANY surface (redaction lives here, not in a transport).
    expect(thread.map((comment) => comment.id)).toEqual([first.id, second.id])
    expect(thread.at(0)?.deletedAt).not.toBeNull()
    expect(thread.at(0)?.body).toBe('')
    expect(thread.at(1)?.body).toBe('later comment')
  })
})
