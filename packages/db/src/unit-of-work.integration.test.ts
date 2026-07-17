import { DuplicatePositionError, type CardEvent } from '@rivian-kanban/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  insertUser,
  makeCard,
  makeComment,
  newId,
  openTestDb,
  seedBaseline,
  T0,
  type Baseline,
  type TestDb,
} from './test/support.ts'

let db: TestDb
let base: Baseline
let reporterId: string

beforeAll(() => {
  db = openTestDb()
  base = seedBaseline(db.connection)
  reporterId = insertUser(db.connection).id
})

afterAll(() => {
  db.cleanup()
})

function countRows(table: 'cards' | 'comments' | 'card_events'): number {
  const row = db.connection.raw
    .prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)
    .get()
  return row?.n ?? 0
}

function blockedEvent(cardId: string): CardEvent {
  return {
    id: newId(),
    cardId,
    actorId: reporterId,
    actorKind: 'user',
    eventType: 'card.blocked',
    payload: { reason: 'test' },
    createdAt: T0,
  }
}

describe('SqliteUnitOfWork', () => {
  it('commits multi-table work atomically and returns the callback result', async () => {
    const card = makeCard({
      boardId: base.boardId,
      laneId: base.lanes.intake.id,
      reporterId,
      position: 'c0',
    })

    const result = await db.uow.run(async (tx) => {
      await tx.cards.insert(card)
      await tx.comments.insert(makeComment({ cardId: card.id, authorId: reporterId }))
      await tx.events.append(blockedEvent(card.id))
      return 'committed'
    })

    expect(result).toBe('committed')
    expect(countRows('cards')).toBe(1)
    expect(countRows('comments')).toBe(1)
    expect(countRows('card_events')).toBe(1)
  })

  it('a unit of work that throws mid-way leaves no partial rows in any table', async () => {
    const before = {
      cards: countRows('cards'),
      comments: countRows('comments'),
      events: countRows('card_events'),
    }
    const card = makeCard({
      boardId: base.boardId,
      laneId: base.lanes.ready.id,
      reporterId,
      position: 'r0',
    })

    const failing = db.uow.run(async (tx) => {
      await tx.cards.insert(card)
      await tx.comments.insert(makeComment({ cardId: card.id, authorId: reporterId }))
      await tx.events.append(blockedEvent(card.id))
      throw new Error('mid-transaction failure')
    })

    await expect(failing).rejects.toThrow('mid-transaction failure')
    expect(countRows('cards')).toBe(before.cards)
    expect(countRows('comments')).toBe(before.comments)
    expect(countRows('card_events')).toBe(before.events)
  })

  it('rolls back everything when a later statement violates the position backstop', async () => {
    const before = countRows('cards')
    const position = 'dupe0'
    const first = makeCard({
      boardId: base.boardId,
      laneId: base.lanes.review.id,
      reporterId,
      position,
    })
    const second = makeCard({
      boardId: base.boardId,
      laneId: base.lanes.review.id,
      reporterId,
      position,
    })

    const failing = db.uow.run(async (tx) => {
      await tx.cards.insert(first)
      await tx.cards.insert(second)
    })

    await expect(failing).rejects.toBeInstanceOf(DuplicatePositionError)
    expect(countRows('cards')).toBe(before)
  })

  it('serializes concurrent run() calls — both commit, statements never interleave', async () => {
    const before = countRows('cards')
    const cardA = makeCard({
      boardId: base.boardId,
      laneId: base.lanes.done.id,
      reporterId,
      position: 'z0',
    })
    const cardB = makeCard({
      boardId: base.boardId,
      laneId: base.lanes.done.id,
      reporterId,
      position: 'z1',
    })

    await Promise.all([
      db.uow.run(async (tx) => {
        await tx.cards.insert(cardA)
        // The other unit of work must not have slipped its row in between our
        // statements: inside this transaction only cardA exists in `done`.
        const laneCards = await tx.cards.listByLane(base.lanes.done.id)
        expect(laneCards.map((card) => card.id)).toEqual([cardA.id])
      }),
      db.uow.run(async (tx) => {
        await tx.cards.insert(cardB)
      }),
    ])

    expect(countRows('cards')).toBe(before + 2)
  })

  it('tolerates a transaction that was already torn down when the failure surfaces', async () => {
    // Simulates SQLite's auto-rollback-on-error behavior: if the transaction
    // is already gone by the time the callback rejects, run() must not crash
    // on a second ROLLBACK and must leave the connection usable.
    const failing = db.uow.run(() => {
      db.connection.raw.exec('ROLLBACK')
      return Promise.reject(new Error('aborted underneath'))
    })

    await expect(failing).rejects.toThrow('aborted underneath')
    await expect(db.uow.run((tx) => tx.cards.findById('no-such-id'))).resolves.toBeNull()
  })

  it('nested run() rejects fast, the outer work rolls back, and the connection stays usable', async () => {
    const before = countRows('cards')
    const card = makeCard({
      boardId: base.boardId,
      laneId: base.lanes.in_progress.id,
      reporterId,
      position: 'n0',
    })

    const nested = db.uow.run(async (tx) => {
      await tx.cards.insert(card)
      // A nested unit of work would deadlock the serialization queue; the
      // reentrancy guard must reject instead of hanging.
      await db.uow.run((inner) => inner.cards.findById(card.id))
    })

    await expect(nested).rejects.toThrow('nested UnitOfWork.run()')
    expect(countRows('cards')).toBe(before)
    await expect(db.uow.run((tx) => tx.cards.findById(card.id))).resolves.toBeNull()
  })

  it('a failed unit of work leaves the connection usable for the next one', async () => {
    const failing = db.uow.run(() => Promise.reject(new Error('boom')))
    await expect(failing).rejects.toThrow('boom')

    const card = makeCard({
      boardId: base.boardId,
      laneId: base.lanes.waiting_approval.id,
      reporterId,
      position: 'w0',
    })
    await db.uow.run((tx) => tx.cards.insert(card))

    await expect(db.uow.run((tx) => tx.cards.findById(card.id))).resolves.toMatchObject({
      id: card.id,
    })
  })
})
