import {
  NotFoundError,
  type Attachment,
  type Card,
  type CardEvent,
  type TransactionContext,
} from '@rivian-kanban/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  insertUser,
  makeCard,
  makeComment,
  messageChain,
  newId,
  openTestDb,
  seedBaseline,
  type Baseline,
  type TestDb,
} from '../test/support.ts'

let db: TestDb
let base: Baseline
let authorId: string
let card: Card

beforeAll(async () => {
  db = openTestDb()
  base = seedBaseline(db.connection)
  authorId = insertUser(db.connection).id
  card = makeCard({
    boardId: base.boardId,
    laneId: base.lanes.intake.id,
    reporterId: authorId,
  })
  await db.uow.run((tx) => tx.cards.insert(card))
})

afterAll(() => {
  db.cleanup()
})

function run<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
  return db.uow.run(fn)
}

describe('SqliteCommentRepository', () => {
  it('round-trips a comment and updates it in place', async () => {
    const comment = makeComment({ cardId: card.id, authorId, body: 'first' })

    await run((tx) => tx.comments.insert(comment))
    await run((tx) => tx.comments.update({ ...comment, body: 'edited' }))
    const found = await run((tx) => tx.comments.findById(comment.id))

    expect(found).toEqual({ ...comment, body: 'edited' })
    await expect(run((tx) => tx.comments.findById(newId()))).resolves.toBeNull()
    await expect(
      run((tx) => tx.comments.update(makeComment({ cardId: card.id, authorId }))),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('rejects a comment whose author does not exist (FK enforced)', async () => {
    const orphan = makeComment({ cardId: card.id, authorId: newId() })

    const error: unknown = await run((tx) => tx.comments.insert(orphan)).then(
      () => null,
      (reason: unknown) => reason,
    )

    expect(error).toBeInstanceOf(Error)
    expect(messageChain(error)).toContain('FOREIGN KEY constraint failed')
  })

  it('lists oldest-first on (createdAt, id) with soft-deleted rows included', async () => {
    const threadCard = makeCard({
      boardId: base.boardId,
      laneId: base.lanes.ready.id,
      reporterId: authorId,
      position: 'c-thread',
    })
    const shared = '2026-07-16T15:00:00.000Z'
    const idLow = '30000000-0000-7000-8000-000000000001'
    const idHigh = '30000000-0000-7000-8000-000000000002'
    await run(async (tx) => {
      await tx.cards.insert(threadCard)
      // Inserted newest-first to prove ordering comes from SQL, not insertion.
      await tx.comments.insert(
        makeComment({
          id: idHigh,
          cardId: threadCard.id,
          authorId,
          createdAt: shared,
          deletedAt: '2026-07-16T16:00:00.000Z',
        }),
      )
      await tx.comments.insert(
        makeComment({ id: idLow, cardId: threadCard.id, authorId, createdAt: shared }),
      )
      await tx.comments.insert(
        makeComment({ cardId: threadCard.id, authorId, createdAt: '2026-07-16T14:00:00.000Z' }),
      )
    })

    const listed = await run((tx) => tx.comments.listByCard(threadCard.id))

    expect(listed.map((c) => c.createdAt)).toEqual(['2026-07-16T14:00:00.000Z', shared, shared])
    expect(listed.slice(1).map((c) => c.id)).toEqual([idLow, idHigh])
    expect(listed.at(2)?.deletedAt).not.toBeNull()
  })
})

describe('SqliteAttachmentRepository', () => {
  it('round-trips metadata, updates (soft delete), and lists oldest-first', async () => {
    const attachment: Attachment = {
      id: newId(),
      cardId: card.id,
      filename: 'photo.png',
      mime: 'image/png',
      bytes: 1024,
      sha256: 'ab'.repeat(32),
      storageKey: newId(),
      uploadedBy: authorId,
      createdAt: '2026-07-16T12:00:00.000Z',
      deletedAt: null,
    }
    const later: Attachment = {
      ...attachment,
      id: newId(),
      storageKey: newId(),
      createdAt: '2026-07-16T13:00:00.000Z',
    }

    await run((tx) => tx.attachments.insert(later))
    await run((tx) => tx.attachments.insert(attachment))
    await run((tx) => tx.attachments.update({ ...later, deletedAt: '2026-07-16T14:00:00.000Z' }))
    const found = await run((tx) => tx.attachments.findById(attachment.id))
    const listed = await run((tx) => tx.attachments.listByCard(card.id))

    expect(found).toEqual(attachment)
    expect(listed.map((a) => a.id)).toEqual([attachment.id, later.id])
    expect(listed.at(1)?.deletedAt).toBe('2026-07-16T14:00:00.000Z')
    await expect(run((tx) => tx.attachments.findById(newId()))).resolves.toBeNull()
    await expect(
      run((tx) => tx.attachments.update({ ...attachment, id: newId() })),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('rejects metadata whose uploader does not exist (FK enforced)', async () => {
    const orphan: Attachment = {
      id: newId(),
      cardId: card.id,
      filename: 'orphan.pdf',
      mime: 'application/pdf',
      bytes: 1,
      sha256: 'cd'.repeat(32),
      storageKey: newId(),
      uploadedBy: newId(),
      createdAt: '2026-07-16T12:00:00.000Z',
      deletedAt: null,
    }

    const error: unknown = await run((tx) => tx.attachments.insert(orphan)).then(
      () => null,
      (reason: unknown) => reason,
    )

    expect(messageChain(error)).toContain('FOREIGN KEY constraint failed')
  })
})

describe('SqliteEventRepository', () => {
  let eventCard: Card
  const shared = '2026-07-16T15:00:00.000Z'
  const idLow = '40000000-0000-7000-8000-000000000001'
  const idHigh = '40000000-0000-7000-8000-000000000002'

  function blockedEvent(id: string, createdAt: string): CardEvent {
    return {
      id,
      cardId: eventCard.id,
      actorId: authorId,
      actorKind: 'user',
      eventType: 'card.blocked',
      payload: { reason: 'r' },
      createdAt,
    }
  }

  function archivedEvent(createdAt: string): CardEvent {
    return {
      id: newId(),
      cardId: eventCard.id,
      actorId: null,
      actorKind: 'system',
      eventType: 'card.archived',
      payload: {},
      createdAt,
    }
  }

  beforeAll(async () => {
    eventCard = makeCard({
      boardId: base.boardId,
      laneId: base.lanes.review.id,
      reporterId: authorId,
      position: 'e0',
    })
    await run(async (tx) => {
      await tx.cards.insert(eventCard)
      // Append order deliberately scrambled relative to (createdAt, id).
      await tx.events.append(blockedEvent(idHigh, shared))
      await tx.events.append(blockedEvent(newId(), '2026-07-16T16:00:00.000Z'))
      await tx.events.append(blockedEvent(idLow, shared))
      await tx.events.append(archivedEvent('2026-07-16T14:00:00.000Z'))
    })
  })

  it('lists oldest-first on (createdAt ASC, id ASC) and hydrates typed payloads', async () => {
    const events = await run((tx) => tx.events.listByCard(eventCard.id))

    expect(events.map((e) => e.createdAt)).toEqual([
      '2026-07-16T14:00:00.000Z',
      shared,
      shared,
      '2026-07-16T16:00:00.000Z',
    ])
    expect(events.slice(1, 3).map((e) => e.id)).toEqual([idLow, idHigh])
    expect(events.at(1)?.payload).toEqual({ reason: 'r' })
  })

  it('after-cursor returns rows strictly newer; same-timestamp siblings are not skipped', async () => {
    const afterLow = await run((tx) =>
      tx.events.listByCard(eventCard.id, { after: { createdAt: shared, id: idLow } }),
    )
    const afterHigh = await run((tx) =>
      tx.events.listByCard(eventCard.id, { after: { createdAt: shared, id: idHigh }, limit: 1 }),
    )

    expect(afterLow.map((e) => e.id)).toContain(idHigh)
    expect(afterLow).toHaveLength(2)
    expect(afterHigh).toHaveLength(1)
    expect(afterHigh.at(0)?.createdAt).toBe('2026-07-16T16:00:00.000Z')
  })

  it('listLatestByCard returns the newest N, newest-first on (createdAt DESC, id DESC)', async () => {
    const latest = await run((tx) => tx.events.listLatestByCard(eventCard.id, 3))

    expect(latest.map((e) => e.createdAt)).toEqual(['2026-07-16T16:00:00.000Z', shared, shared])
    expect(latest.slice(1).map((e) => e.id)).toEqual([idHigh, idLow])
  })

  it('filters by event type; an explicit empty type list matches nothing', async () => {
    const archived = await run((tx) =>
      tx.events.listByCard(eventCard.id, { types: ['card.archived'] }),
    )
    const none = await run((tx) => tx.events.listByCard(eventCard.id, { types: [] }))

    expect(archived.map((e) => e.eventType)).toEqual(['card.archived'])
    expect(none).toEqual([])
  })

  it('rejects events for a card that does not exist (FK enforced)', async () => {
    const orphan: CardEvent = {
      id: newId(),
      cardId: newId(),
      actorId: null,
      actorKind: 'system',
      eventType: 'card.archived',
      payload: {},
      createdAt: shared,
    }

    const error: unknown = await run((tx) => tx.events.append(orphan)).then(
      () => null,
      (reason: unknown) => reason,
    )

    expect(messageChain(error)).toContain('FOREIGN KEY constraint failed')
  })
})
