import {
  type Board,
  type Card,
  type Lane,
  type Notification,
  type TransactionContext,
} from '@rivian-kanban/core'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  insertUser,
  makeCard,
  newId,
  openTestDb,
  seedBaseline,
  T0,
  type Baseline,
  type TestDb,
} from '../test/support.ts'
import { lanes } from '../schema.ts'
import { structuralSeed } from '../seed.ts'

/**
 * Multiple boards (docs/superpowers/plans/2026-09-15-multiple-boards.md): the
 * new BoardRepository, default-board stability, the global card-id sequence
 * across boards, board-scoped tags/events/notifications, and no lane
 * resurrection across reboots. Real SQLite, real migrations.
 */

let db: TestDb
let base: Baseline
let alice: string

beforeAll(() => {
  db = openTestDb()
  base = seedBaseline(db.connection)
  alice = insertUser(db.connection).id
})

afterAll(() => {
  db.cleanup()
})

function run<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
  return db.uow.run(fn)
}

it('stores scoped defaults uniquely and isolates personal preferences', async () => {
  // Arrange
  const { board } = await makeSecondBoard()
  await run(async (tx) => {
    await tx.boards.setDefault('role', 'user', base.boardId)
    await tx.boards.setDefault('role', 'user', board.id)
    await tx.boards.setDefault('user', alice, board.id)
    await tx.boards.setDefault('user', 'another-user', base.boardId)
  })
  // Act / Assert
  expect(await run((tx) => tx.boards.listDefaults(alice))).toEqual(
    expect.arrayContaining([
      { scope: 'role', subject: 'user', boardId: board.id },
      { scope: 'user', subject: alice, boardId: board.id },
    ]),
  )
  expect(await run((tx) => tx.boards.listDefaults(null))).toEqual([
    { scope: 'role', subject: 'user', boardId: board.id },
  ])
  await run((tx) => tx.boards.setDefault('user', alice, null))
  expect(
    (await run((tx) => tx.boards.listDefaults(alice))).filter((row) => row.scope === 'user'),
  ).toEqual([])
})

function card(overrides: Partial<Card> & Pick<Card, 'boardId' | 'laneId'>): Card {
  return makeCard({ reporterId: alice, position: newId(), createdAt: T0, ...overrides })
}

/** Inserts a fresh non-default board with one lane; returns both. */
async function makeSecondBoard(): Promise<{ board: Board; lane: Lane }> {
  const board: Board = {
    id: newId(),
    name: 'Warehouse',
    createdAt: T0,
    isDefault: false,
    archivedAt: null,
    accessMode: 'all',
    allowedRoleKeys: [],
    allowedUserIds: [],
    allowedGroupIds: [],
  }
  const lane: Lane = {
    id: newId(),
    boardId: board.id,
    key: 'intake',
    label: 'Intake',
    position: 0,
    wipLimit: null,
  }
  await run(async (tx) => {
    await tx.boards.insert(board)
    await tx.lanes.insert(lane)
  })
  return { board, lane }
}

describe('SqliteBoardRepository', () => {
  it('findById/getDefault/list round-trip every field', async () => {
    const { board } = await makeSecondBoard()

    const found = await run((tx) => tx.boards.findById(board.id))
    const defaultBoard = await run((tx) => tx.boards.getDefault())
    const active = await run((tx) => tx.boards.list())

    expect(found).toEqual(board)
    expect(defaultBoard?.id).toBe(base.boardId)
    expect(defaultBoard?.isDefault).toBe(true)
    expect(active.map((b) => b.id)).toContain(board.id)
    expect(active.map((b) => b.id)).toContain(base.boardId)
  })

  it('update persists every field, including archival', async () => {
    const { board } = await makeSecondBoard()

    await run((tx) =>
      tx.boards.update({
        ...board,
        name: 'Warehouse (renamed)',
        accessMode: 'restricted',
        allowedRoleKeys: ['admin'],
        allowedUserIds: [alice],
        archivedAt: T0,
      }),
    )
    const updated = await run((tx) => tx.boards.findById(board.id))
    const active = await run((tx) => tx.boards.list())

    expect(updated).toMatchObject({
      name: 'Warehouse (renamed)',
      accessMode: 'restricted',
      allowedRoleKeys: ['admin'],
      allowedUserIds: [alice],
      archivedAt: T0,
    })
    // list() is active-only: the archived board must drop out.
    expect(active.map((b) => b.id)).not.toContain(board.id)
  })

  it('default board stays authoritative after a second board is created and archived', async () => {
    const { board: second } = await makeSecondBoard()
    await run((tx) => tx.boards.update({ ...second, archivedAt: T0 }))

    const defaultBoard = await run((tx) => tx.boards.getDefault())

    expect(defaultBoard?.id).toBe(base.boardId)
    expect(defaultBoard?.isDefault).toBe(true)
  })

  it('the archived original default board is still returned by getDefault', async () => {
    // Arrange — a throwaway db so archiving the original board here doesn't
    // affect the other tests in this file sharing `base`.
    const other = openTestDb()
    const otherBase = seedBaseline(other.connection)
    await other.uow.run((tx) =>
      tx.boards.update({
        id: otherBase.boardId,
        name: 'Facilities',
        createdAt: T0,
        isDefault: true,
        archivedAt: T0,
        accessMode: 'all',
        allowedRoleKeys: [],
        allowedUserIds: [],
        allowedGroupIds: [],
      }),
    )

    const defaultBoard = await other.uow.run((tx) => tx.boards.getDefault())
    const active = await other.uow.run((tx) => tx.boards.list())

    expect(defaultBoard?.id).toBe(otherBase.boardId)
    expect(active.map((b) => b.id)).not.toContain(otherBase.boardId)
    other.cleanup()
  })

  it('only one board can carry isDefault — the partial unique index rejects a second', async () => {
    const dupe: Board = {
      id: newId(),
      name: 'Also Default',
      createdAt: T0,
      isDefault: true,
      archivedAt: null,
      accessMode: 'all',
      allowedRoleKeys: [],
      allowedUserIds: [],
      allowedGroupIds: [],
    }
    await expect(run((tx) => tx.boards.insert(dupe))).rejects.toThrow()
  })
})

describe('global card id allocation across boards', () => {
  it('nextCardId is one shared sequence, not per-board', async () => {
    const { board, lane } = await makeSecondBoard()

    const firstId = await run((tx) => tx.cards.nextCardId())
    await run((tx) =>
      tx.cards.insert(card({ boardId: base.boardId, laneId: base.lanes.intake.id, id: firstId })),
    )

    const secondId = await run((tx) => tx.cards.nextCardId())
    await run((tx) => tx.cards.insert(card({ boardId: board.id, laneId: lane.id, id: secondId })))

    const thirdId = await run((tx) => tx.cards.nextCardId())

    // Global MAX(id)+1 regardless of which board the prior card belonged to.
    expect(secondId).toBe(firstId + 1)
    expect(thirdId).toBe(secondId + 1)
  })
})

describe('no lane resurrection across reboots', () => {
  it('a deleted seeded lane does not come back on a second structuralSeed run', () => {
    const fresh = openTestDb()
    const freshBase = seedBaseline(fresh.connection)

    fresh.connection.db.delete(lanes).where(eq(lanes.id, freshBase.lanes.done.id)).run()

    // Re-run the structural seed against the SAME connection (a reboot).
    structuralSeed(fresh.connection.db)

    const remaining = fresh.connection.db
      .select()
      .from(lanes)
      .where(eq(lanes.boardId, freshBase.boardId))
      .all()
    expect(remaining.some((lane) => lane.key === 'done')).toBe(false)
    expect(remaining).toHaveLength(6)
    fresh.cleanup()
  })
})

describe('board-scoped reads: tags, events, notifications', () => {
  it("TagRepository.listAll(boardId) returns only that board's tags", async () => {
    const { board, lane } = await makeSecondBoard()
    const cardOnBase = card({ boardId: base.boardId, laneId: base.lanes.intake.id })
    const cardOnSecond = card({ boardId: board.id, laneId: lane.id })
    const baseTag = { id: newId(), name: `base-only-${newId()}` }
    const secondTag = { id: newId(), name: `second-only-${newId()}` }
    await run(async (tx) => {
      await tx.cards.insert(cardOnBase)
      await tx.cards.insert(cardOnSecond)
      await tx.tags.insert(baseTag)
      await tx.tags.insert(secondTag)
      await tx.tags.setCardTags(cardOnBase.id, [baseTag.id])
      await tx.tags.setCardTags(cardOnSecond.id, [secondTag.id])
    })

    const baseTags = await run((tx) => tx.tags.listAll(base.boardId))
    const secondTags = await run((tx) => tx.tags.listAll(board.id))
    const allTags = await run((tx) => tx.tags.listAll())

    expect(baseTags.map((t) => t.id)).toContain(baseTag.id)
    expect(baseTags.map((t) => t.id)).not.toContain(secondTag.id)
    expect(secondTags.map((t) => t.id)).toContain(secondTag.id)
    expect(secondTags.map((t) => t.id)).not.toContain(baseTag.id)
    expect(allTags.map((t) => t.id)).toEqual(expect.arrayContaining([baseTag.id, secondTag.id]))
  })

  it('EventRepository.listBoardSince(boardId) filters through the owning card', async () => {
    const { board, lane } = await makeSecondBoard()
    const cardOnBase = card({ boardId: base.boardId, laneId: base.lanes.intake.id })
    const cardOnSecond = card({ boardId: board.id, laneId: lane.id })
    await run(async (tx) => {
      await tx.cards.insert(cardOnBase)
      await tx.cards.insert(cardOnSecond)
      await tx.events.append({
        id: newId(),
        cardId: cardOnBase.id,
        actorId: alice,
        actorKind: 'user',
        eventType: 'card.created',
        payload: { snapshot: { ...cardOnBase, tags: [] } },
        createdAt: T0,
      })
      await tx.events.append({
        id: newId(),
        cardId: cardOnSecond.id,
        actorId: alice,
        actorKind: 'user',
        eventType: 'card.created',
        payload: { snapshot: { ...cardOnSecond, tags: [] } },
        createdAt: T0,
      })
    })

    const baseEvents = await run((tx) =>
      tx.events.listBoardSince('2000-01-01T00:00:00.000Z', { boardId: base.boardId }),
    )
    const secondEvents = await run((tx) =>
      tx.events.listBoardSince('2000-01-01T00:00:00.000Z', { boardId: board.id }),
    )

    expect(baseEvents.map((e) => e.cardId)).toContain(cardOnBase.id)
    expect(baseEvents.map((e) => e.cardId)).not.toContain(cardOnSecond.id)
    expect(secondEvents.map((e) => e.cardId)).toContain(cardOnSecond.id)
    expect(secondEvents.map((e) => e.cardId)).not.toContain(cardOnBase.id)
  })

  it('NotificationRepository boardIds scoping: filters, and an empty array leaks nothing', async () => {
    const { board, lane } = await makeSecondBoard()
    const recipient = insertUser(db.connection).id
    const cardOnBase = card({ boardId: base.boardId, laneId: base.lanes.intake.id })
    const cardOnSecond = card({ boardId: board.id, laneId: lane.id })
    const notifOnBase: Notification = {
      id: newId(),
      userId: recipient,
      cardId: cardOnBase.id,
      actorId: alice,
      eventType: 'card.status_changed',
      createdAt: T0,
      readAt: null,
    }
    const notifOnSecond: Notification = {
      id: newId(),
      userId: recipient,
      cardId: cardOnSecond.id,
      actorId: alice,
      eventType: 'card.status_changed',
      createdAt: T0,
      readAt: null,
    }
    await run(async (tx) => {
      await tx.cards.insert(cardOnBase)
      await tx.cards.insert(cardOnSecond)
      await tx.notifications.insert(notifOnBase)
      await tx.notifications.insert(notifOnSecond)
    })

    const unscoped = await run((tx) => tx.notifications.listForUser(recipient, { limit: 10 }))
    const scopedToBase = await run((tx) =>
      tx.notifications.listForUser(recipient, { limit: 10, boardIds: [base.boardId] }),
    )
    const scopedToNothing = await run((tx) =>
      tx.notifications.listForUser(recipient, { limit: 10, boardIds: [] }),
    )
    const unreadAll = await run((tx) => tx.notifications.unreadCount(recipient))
    const unreadBase = await run((tx) => tx.notifications.unreadCount(recipient, [base.boardId]))
    const unreadEmpty = await run((tx) => tx.notifications.unreadCount(recipient, []))

    expect(unscoped.map((n) => n.id).sort()).toEqual([notifOnBase.id, notifOnSecond.id].sort())
    expect(scopedToBase.map((n) => n.id)).toEqual([notifOnBase.id])
    expect(scopedToNothing).toEqual([])
    expect(unreadAll).toBe(2)
    expect(unreadBase).toBe(1)
    expect(unreadEmpty).toBe(0)
  })

  it("markAllRead/clearAll scope through boardIds — another board's unread rows stay untouched", async () => {
    const { board, lane } = await makeSecondBoard()
    const recipient = insertUser(db.connection).id
    const cardOnBase = card({ boardId: base.boardId, laneId: base.lanes.intake.id })
    const cardOnSecond = card({ boardId: board.id, laneId: lane.id })
    const onBase: Notification = {
      id: newId(),
      userId: recipient,
      cardId: cardOnBase.id,
      actorId: alice,
      eventType: 'card.status_changed',
      createdAt: T0,
      readAt: null,
    }
    const onSecond: Notification = {
      id: newId(),
      userId: recipient,
      cardId: cardOnSecond.id,
      actorId: alice,
      eventType: 'card.status_changed',
      createdAt: T0,
      readAt: null,
    }
    await run(async (tx) => {
      await tx.cards.insert(cardOnBase)
      await tx.cards.insert(cardOnSecond)
      await tx.notifications.insert(onBase)
      await tx.notifications.insert(onSecond)
    })

    const emptyMarked = await run((tx) => tx.notifications.markAllRead(recipient, T0, []))
    expect(emptyMarked).toBe(0)

    const markedBase = await run((tx) =>
      tx.notifications.markAllRead(recipient, T0, [base.boardId]),
    )
    expect(markedBase).toBe(1)
    const afterMark = await run((tx) =>
      tx.notifications.listForUser(recipient, { limit: 10, boardIds: [board.id] }),
    )
    // The second board's notification is still unread — untouched by the base-scoped mark.
    expect(afterMark.find((n) => n.id === onSecond.id)?.readAt).toBeNull()

    const emptyCleared = await run((tx) => tx.notifications.clearAll(recipient, []))
    expect(emptyCleared).toBe(0)

    const clearedBase = await run((tx) => tx.notifications.clearAll(recipient, [base.boardId]))
    expect(clearedBase).toBe(1)
    const remaining = await run((tx) => tx.notifications.listForUser(recipient, { limit: 10 }))
    // Only the second board's notification survives the base-scoped clear.
    expect(remaining.map((n) => n.id)).toEqual([onSecond.id])
  })
})
