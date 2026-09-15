import {
  ConflictError,
  Uuidv7IdGenerator,
  type Board,
  type Group,
  type Lane,
  type Notification,
} from '@rivian-kanban/core'
import { cardWith } from '@rivian-kanban/core/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { lanes } from '../schema.pg.ts'
import { openPgliteConnection, type PgConnection } from './connection.ts'
import { structuralSeedPg } from './seed.ts'
import { PostgresUnitOfWork } from './unit-of-work.ts'

/**
 * Postgres parity for multiple boards (mirrors
 * `repositories/boards.integration.test.ts`): BoardRepository CRUD, the
 * `card_ids` native-sequence global allocation across boards, and
 * notification `boardIds` scoping — the same contracts as SQLite, against
 * real Postgres SQL via PGlite (ADR-020).
 */

let conn: PgConnection
let uow: PostgresUnitOfWork
let boardId: string
let baseLaneId: string
let reporterId: string
const now = '2026-01-01T00:00:00.000Z'
const ids = new Uuidv7IdGenerator()
/** Real UUIDv7s — card-event snapshots validate every id field as a UUID. */
function id(_prefix: string): string {
  return ids.newId()
}

beforeAll(async () => {
  conn = await openPgliteConnection()
  const structural = await structuralSeedPg(conn.db)
  boardId = structural.boardId
  uow = new PostgresUnitOfWork(conn.db)
  const laneRows = await uow.run((tx) => tx.lanes.listByBoard(boardId))
  const lane = laneRows[0]
  if (lane === undefined) throw new Error('expected at least one seeded lane')
  baseLaneId = lane.id

  reporterId = id('user')
  await uow.run((tx) =>
    tx.userAccounts.insert(
      {
        id: reporterId,
        email: `${reporterId}@pg.test`,
        displayName: 'Reporter',
        role: 'user',
        mustChangePassword: false,
        slackUserId: null,
        isActive: true,
        timezone: 'PST',
        theme: 'system',
        createdAt: now,
      },
      'hash',
    ),
  )
})

afterAll(async () => {
  await conn.close()
})

it('stores scoped defaults uniquely and isolates personal preferences', async () => {
  // Arrange
  const { board } = await makeSecondBoard()
  await uow.run(async (tx) => {
    await tx.boards.setDefault('role', 'user', boardId)
    await tx.boards.setDefault('role', 'user', board.id)
    await tx.boards.setDefault('user', reporterId, board.id)
    await tx.boards.setDefault('user', 'another-user', boardId)
  })
  // Act / Assert
  expect(await uow.run((tx) => tx.boards.listDefaults(reporterId))).toEqual(
    expect.arrayContaining([
      { scope: 'role', subject: 'user', boardId: board.id },
      { scope: 'user', subject: reporterId, boardId: board.id },
    ]),
  )
  expect(await uow.run((tx) => tx.boards.listDefaults(null))).toEqual([
    { scope: 'role', subject: 'user', boardId: board.id },
  ])
  await uow.run((tx) => tx.boards.setDefault('user', reporterId, null))
  expect(
    (await uow.run((tx) => tx.boards.listDefaults(reporterId))).filter(
      (row) => row.scope === 'user',
    ),
  ).toEqual([])
})

async function makeSecondBoard(): Promise<{ board: Board; lane: Lane }> {
  const board: Board = {
    id: id('board'),
    name: 'Warehouse',
    createdAt: now,
    isDefault: false,
    archivedAt: null,
    accessMode: 'all',
    allowedRoleKeys: [],
    allowedUserIds: [],
    allowedGroupIds: [],
  }
  const lane: Lane = {
    id: id('lane'),
    boardId: board.id,
    key: 'intake',
    label: 'Intake',
    position: 0,
    wipLimit: null,
  }
  await uow.run(async (tx) => {
    await tx.boards.insert(board)
    await tx.lanes.insert(lane)
  })
  return { board, lane }
}

async function insertCard(boardIdArg: string, laneId: string): Promise<number> {
  const cardId = await uow.run((tx) => tx.cards.nextCardId())
  const card = cardWith({
    id: cardId,
    boardId: boardIdArg,
    laneId,
    reporterId,
    position: id('pos'),
    createdAt: now,
  })
  await uow.run((tx) => tx.cards.insert(card))
  return cardId
}

describe('PgBoardRepository', () => {
  it('findById/getDefault/list round-trip; the default stays authoritative after archival', async () => {
    const { board } = await makeSecondBoard()
    await uow.run((tx) => tx.boards.update({ ...board, archivedAt: now }))

    const found = await uow.run((tx) => tx.boards.findById(board.id))
    const defaultBoard = await uow.run((tx) => tx.boards.getDefault())
    const active = await uow.run((tx) => tx.boards.list())

    expect(found?.archivedAt).toBe(now)
    expect(defaultBoard?.id).toBe(boardId)
    expect(defaultBoard?.isDefault).toBe(true)
    expect(active.map((b) => b.id)).not.toContain(board.id)
  })
})

describe('global card id allocation across boards (native sequence)', () => {
  it('nextCardId is one shared sequence, not per-board', async () => {
    const { board, lane } = await makeSecondBoard()

    const firstId = await insertCard(boardId, baseLaneId)
    const secondId = await insertCard(board.id, lane.id)
    const thirdId = await uow.run((tx) => tx.cards.nextCardId())

    expect(secondId).toBe(firstId + 1)
    expect(thirdId).toBe(secondId + 1)
  })
})

describe('NotificationRepository boardIds scoping (pg)', () => {
  it('filters via the owning card and leaks nothing for an empty boardIds array', async () => {
    const { board, lane } = await makeSecondBoard()
    const cardOnBaseId = await insertCard(boardId, baseLaneId)
    const cardOnSecondId = await insertCard(board.id, lane.id)

    const notifOnBase: Notification = {
      id: id('notif'),
      userId: reporterId,
      cardId: cardOnBaseId,
      actorId: reporterId,
      eventType: 'card.status_changed',
      createdAt: now,
      readAt: null,
    }
    const notifOnSecond: Notification = {
      id: id('notif'),
      userId: reporterId,
      cardId: cardOnSecondId,
      actorId: reporterId,
      eventType: 'card.status_changed',
      createdAt: now,
      readAt: null,
    }
    await uow.run(async (tx) => {
      await tx.notifications.insert(notifOnBase)
      await tx.notifications.insert(notifOnSecond)
    })

    const scopedToBase = await uow.run((tx) =>
      tx.notifications.listForUser(reporterId, { limit: 10, boardIds: [boardId] }),
    )
    const scopedToNothing = await uow.run((tx) =>
      tx.notifications.listForUser(reporterId, { limit: 10, boardIds: [] }),
    )
    const unreadBase = await uow.run((tx) => tx.notifications.unreadCount(reporterId, [boardId]))

    expect(scopedToBase.map((n) => n.id)).toContain(notifOnBase.id)
    expect(scopedToBase.map((n) => n.id)).not.toContain(notifOnSecond.id)
    expect(scopedToNothing).toEqual([])
    expect(unreadBase).toBeGreaterThanOrEqual(1)
  })

  it('markAllRead/clearAll scope through boardIds — another board’s unread rows stay untouched', async () => {
    const { board, lane } = await makeSecondBoard()
    const cardOnBaseId = await insertCard(boardId, baseLaneId)
    const cardOnSecondId = await insertCard(board.id, lane.id)
    const userId = id('mark-user')
    await uow.run((tx) =>
      tx.userAccounts.insert(
        {
          id: userId,
          email: `${userId}@pg.test`,
          displayName: 'Marker',
          role: 'user',
          mustChangePassword: false,
          slackUserId: null,
          isActive: true,
          timezone: 'PST',
          theme: 'system',
          createdAt: now,
        },
        'hash',
      ),
    )
    const onBase: Notification = {
      id: id('notif'),
      userId,
      cardId: cardOnBaseId,
      actorId: userId,
      eventType: 'card.status_changed',
      createdAt: now,
      readAt: null,
    }
    const onSecond: Notification = {
      id: id('notif'),
      userId,
      cardId: cardOnSecondId,
      actorId: userId,
      eventType: 'card.status_changed',
      createdAt: now,
      readAt: null,
    }
    await uow.run(async (tx) => {
      await tx.notifications.insert(onBase)
      await tx.notifications.insert(onSecond)
    })

    const emptyMarked = await uow.run((tx) => tx.notifications.markAllRead(userId, now, []))
    expect(emptyMarked).toBe(0)

    const markedBase = await uow.run((tx) => tx.notifications.markAllRead(userId, now, [boardId]))
    expect(markedBase).toBe(1)
    const afterMark = await uow.run((tx) =>
      tx.notifications.listForUser(userId, { limit: 10, boardIds: [board.id] }),
    )
    // The second board's notification is still unread — untouched.
    expect(afterMark.find((n) => n.id === onSecond.id)?.readAt).toBeNull()

    const emptyCleared = await uow.run((tx) => tx.notifications.clearAll(userId, []))
    expect(emptyCleared).toBe(0)

    const clearedBase = await uow.run((tx) => tx.notifications.clearAll(userId, [boardId]))
    expect(clearedBase).toBe(1)
    const remaining = await uow.run((tx) => tx.notifications.listForUser(userId, { limit: 10 }))
    // Only the second board's notification survives the base-scoped clear.
    expect(remaining.map((n) => n.id)).toEqual([onSecond.id])
  })
})

describe('default board stability (pg parity)', () => {
  it('the archived original default board is still returned by getDefault', async () => {
    const other = await openPgliteConnection()
    const otherStructural = await structuralSeedPg(other.db)
    const otherUow = new PostgresUnitOfWork(other.db)

    const original = await otherUow.run((tx) => tx.boards.findById(otherStructural.boardId))
    if (original === null) throw new Error('expected the structurally seeded board')
    await otherUow.run((tx) => tx.boards.update({ ...original, archivedAt: now }))

    const defaultBoard = await otherUow.run((tx) => tx.boards.getDefault())
    const active = await otherUow.run((tx) => tx.boards.list())

    expect(defaultBoard?.id).toBe(otherStructural.boardId)
    expect(active.map((b) => b.id)).not.toContain(otherStructural.boardId)
    await other.close()
  })

  it('only one board can carry isDefault — the partial unique index rejects a second', async () => {
    const dupe: Board = {
      id: id('dupe-default'),
      name: 'Also Default',
      createdAt: now,
      isDefault: true,
      archivedAt: null,
      accessMode: 'all',
      allowedRoleKeys: [],
      allowedUserIds: [],
      allowedGroupIds: [],
    }
    await expect(uow.run((tx) => tx.boards.insert(dupe))).rejects.toThrow()
  })
})

describe('no lane resurrection across reboots (pg)', () => {
  it('a deleted seeded lane does not come back on a second structuralSeedPg run', async () => {
    const fresh = await openPgliteConnection()
    const freshStructural = await structuralSeedPg(fresh.db)
    const freshUow = new PostgresUnitOfWork(fresh.db)
    const seededLanes = await freshUow.run((tx) => tx.lanes.listByBoard(freshStructural.boardId))
    const done = seededLanes.find((lane) => lane.key === 'done')
    if (done === undefined) throw new Error('expected a seeded done lane')

    await fresh.db.delete(lanes).where(eq(lanes.id, done.id))

    // Re-run the structural seed against the SAME connection (a reboot).
    await structuralSeedPg(fresh.db)

    const remaining = await freshUow.run((tx) => tx.lanes.listByBoard(freshStructural.boardId))
    expect(remaining.some((lane) => lane.key === 'done')).toBe(false)
    expect(remaining).toHaveLength(6)
    await fresh.close()
  })
})

describe('board-scoped reads (pg parity): tags, events, presets', () => {
  it("PgTagRepository.listAll(boardId) returns only that board's tags", async () => {
    const { board, lane } = await makeSecondBoard()
    const cardOnBaseId = await insertCard(boardId, baseLaneId)
    const cardOnSecondId = await insertCard(board.id, lane.id)
    const baseTag = { id: id('tag'), name: `base-only-${id('t')}` }
    const secondTag = { id: id('tag'), name: `second-only-${id('t')}` }
    await uow.run(async (tx) => {
      await tx.tags.insert(baseTag)
      await tx.tags.insert(secondTag)
      await tx.tags.setCardTags(cardOnBaseId, [baseTag.id])
      await tx.tags.setCardTags(cardOnSecondId, [secondTag.id])
    })

    const baseTags = await uow.run((tx) => tx.tags.listAll(boardId))
    const secondTags = await uow.run((tx) => tx.tags.listAll(board.id))

    expect(baseTags.map((t) => t.id)).toContain(baseTag.id)
    expect(baseTags.map((t) => t.id)).not.toContain(secondTag.id)
    expect(secondTags.map((t) => t.id)).toContain(secondTag.id)
    expect(secondTags.map((t) => t.id)).not.toContain(baseTag.id)
  })

  it('PgEventRepository.listBoardSince(boardId) filters through the owning card', async () => {
    const { board, lane } = await makeSecondBoard()
    const cardOnBaseId = await insertCard(boardId, baseLaneId)
    const cardOnSecondId = await insertCard(board.id, lane.id)
    const [cardOnBase, cardOnSecond] = await uow.run((tx) =>
      Promise.all([tx.cards.findById(cardOnBaseId), tx.cards.findById(cardOnSecondId)]),
    )
    if (cardOnBase === null || cardOnSecond === null) throw new Error('expected inserted cards')
    await uow.run(async (tx) => {
      await tx.events.append({
        id: id('event'),
        cardId: cardOnBaseId,
        actorId: reporterId,
        actorKind: 'user',
        eventType: 'card.created',
        payload: { snapshot: { ...cardOnBase, tags: [] } },
        createdAt: now,
      })
      await tx.events.append({
        id: id('event'),
        cardId: cardOnSecondId,
        actorId: reporterId,
        actorKind: 'user',
        eventType: 'card.created',
        payload: { snapshot: { ...cardOnSecond, tags: [] } },
        createdAt: now,
      })
    })

    const baseEvents = await uow.run((tx) =>
      tx.events.listBoardSince('2000-01-01T00:00:00.000Z', { boardId }),
    )
    const secondEvents = await uow.run((tx) =>
      tx.events.listBoardSince('2000-01-01T00:00:00.000Z', { boardId: board.id }),
    )

    expect(baseEvents.map((e) => e.cardId)).toContain(cardOnBaseId)
    expect(baseEvents.map((e) => e.cardId)).not.toContain(cardOnSecondId)
    expect(secondEvents.map((e) => e.cardId)).toContain(cardOnSecondId)
    expect(secondEvents.map((e) => e.cardId)).not.toContain(cardOnBaseId)
  })

  it('PgFilterPresetRepository scopes listVisibleTo/findByIdForOwner/delete by boardId', async () => {
    const { board } = await makeSecondBoard()
    const ownerId = id('preset-owner')
    await uow.run((tx) =>
      tx.userAccounts.insert(
        {
          id: ownerId,
          email: `${ownerId}@pg.test`,
          displayName: 'Owner',
          role: 'user',
          mustChangePassword: false,
          slackUserId: null,
          isActive: true,
          timezone: 'PST',
          theme: 'system',
          createdAt: now,
        },
        'hash',
      ),
    )
    const presetOnBase = {
      id: id('preset'),
      ownerId,
      boardId,
      name: 'On base',
      filter: {
        priorities: [],
        assigneeIds: [],
        reporterIds: [],
        tags: [],
        locationIds: [],
        scope: 'active' as const,
        q: '',
        overdue: false,
      },
      shared: false,
      createdAt: now,
      updatedAt: now,
    }
    const presetOnSecond = {
      ...presetOnBase,
      id: id('preset'),
      boardId: board.id,
      name: 'On second',
    }
    await uow.run(async (tx) => {
      await tx.filterPresets.insert(presetOnBase)
      await tx.filterPresets.insert(presetOnSecond)
    })

    const visibleOnBase = await uow.run((tx) => tx.filterPresets.listVisibleTo(ownerId, boardId))
    const foundWrongBoard = await uow.run((tx) =>
      tx.filterPresets.findByIdForOwner(presetOnSecond.id, ownerId, boardId),
    )
    const foundRightBoard = await uow.run((tx) =>
      tx.filterPresets.findByIdForOwner(presetOnSecond.id, ownerId, board.id),
    )

    expect(visibleOnBase.map((p) => p.id)).toContain(presetOnBase.id)
    expect(visibleOnBase.map((p) => p.id)).not.toContain(presetOnSecond.id)
    expect(foundWrongBoard).toBeNull()
    expect(foundRightBoard?.id).toBe(presetOnSecond.id)

    await expect(
      uow.run((tx) => tx.filterPresets.delete(presetOnSecond.id, ownerId, boardId)),
    ).rejects.toThrow()
    await uow.run((tx) => tx.filterPresets.delete(presetOnSecond.id, ownerId, board.id))
  })
})

describe('PgGroupRepository', () => {
  function group(overrides: Partial<Group> = {}): Group {
    return { id: id('group'), name: `Group-${id('g')}`, userIds: [], createdAt: now, ...overrides }
  }

  it('CRUD: insert, findById, list, update (membership persists), remove', async () => {
    const g = group({ name: `On-call ${id('name')}`, userIds: [reporterId] })
    await uow.run((tx) => tx.groups.insert(g))

    const found = await uow.run((tx) => tx.groups.findById(g.id))
    expect(found).toEqual(g)

    await uow.run((tx) => tx.groups.update({ ...g, userIds: [] }))
    const updated = await uow.run((tx) => tx.groups.findById(g.id))
    expect(updated?.userIds).toEqual([])

    await uow.run((tx) => tx.groups.remove(g.id))
    expect(await uow.run((tx) => tx.groups.findById(g.id))).toBeNull()
  })

  it('rejects a case-insensitive duplicate name with ConflictError (race backstop)', async () => {
    const name = `Dup-${id('dup')}`
    await uow.run((tx) => tx.groups.insert(group({ name })))

    await expect(
      uow.run((tx) => tx.groups.insert(group({ name: name.toUpperCase() }))),
    ).rejects.toBeInstanceOf(ConflictError)
  })
})
