import { type Card, type Notification, type TransactionContext } from '@rivian-kanban/core'
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

/**
 * The notifications DB surface (docs/architecture/notifications.md): newest-first
 * per-user list, the unread filter + count, and owner-scoped mark-read /
 * mark-all-read. Real SQLite, real migrations.
 */

let db: TestDb
let base: Baseline
let alice: string

beforeAll(() => {
  db = openTestDb()
  base = seedBaseline(db.connection)
  // Card FK owner only — each test mints its own recipient users so unread
  // counts (which aggregate over a user) never bleed across the shared DB.
  alice = insertUser(db.connection).id
})

afterAll(() => {
  db.cleanup()
})

function run<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
  return db.uow.run(fn)
}

function card(): Card {
  return makeCard({
    boardId: base.boardId,
    laneId: base.lanes.intake.id,
    reporterId: alice,
    position: newId(),
  })
}

function notification(
  overrides: Partial<Notification> & Pick<Notification, 'userId' | 'cardId'>,
): Notification {
  return {
    id: newId(),
    actorId: alice,
    eventType: 'card.status_changed',
    createdAt: T0,
    readAt: null,
    ...overrides,
  }
}

describe('SqliteNotificationRepository', () => {
  it("lists a user's notifications newest-first, filters unread, and counts", async () => {
    // Arrange — a fresh recipient (unread counts aggregate over a user).
    const me = insertUser(db.connection).id
    const other = insertUser(db.connection).id
    const c = card()
    await run((tx) => tx.cards.insert(c))
    const older = notification({ userId: me, cardId: c.id, createdAt: '2026-07-01T00:00:00.000Z' })
    const newer = notification({ userId: me, cardId: c.id, createdAt: '2026-07-10T00:00:00.000Z' })
    const read = notification({
      userId: me,
      cardId: c.id,
      createdAt: '2026-07-05T00:00:00.000Z',
      readAt: T0,
    })
    const theirs = notification({ userId: other, cardId: c.id })
    await run(async (tx) => {
      for (const n of [older, newer, read, theirs]) await tx.notifications.insert(n)
    })

    // Act
    const all = await run((tx) => tx.notifications.listForUser(me, { limit: 50 }))
    const unread = await run((tx) =>
      tx.notifications.listForUser(me, { limit: 50, unreadOnly: true }),
    )
    const count = await run((tx) => tx.notifications.unreadCount(me))

    // Assert — newest-first, unread filter drops the read one, the other's is invisible.
    expect(all.map((n) => n.id)).toEqual([newer.id, read.id, older.id])
    expect(unread.map((n) => n.id)).toEqual([newer.id, older.id])
    expect(count).toBe(2)
  })

  it('marks one read (owner-scoped) and marks all read', async () => {
    // Arrange — a fresh recipient.
    const me = insertUser(db.connection).id
    const other = insertUser(db.connection).id
    const c = card()
    await run((tx) => tx.cards.insert(c))
    const n1 = notification({ userId: me, cardId: c.id, createdAt: '2026-07-01T00:00:00.000Z' })
    const n2 = notification({ userId: me, cardId: c.id, createdAt: '2026-07-02T00:00:00.000Z' })
    await run(async (tx) => {
      for (const n of [n1, n2]) await tx.notifications.insert(n)
    })

    // Act + Assert — another user cannot mark my notification read.
    await run((tx) => tx.notifications.markRead(n1.id, other, T0))
    expect(await run((tx) => tx.notifications.unreadCount(me))).toBe(2)

    // I mark one, then all.
    await run((tx) => tx.notifications.markRead(n1.id, me, T0))
    expect(await run((tx) => tx.notifications.unreadCount(me))).toBe(1)
    const affected = await run((tx) => tx.notifications.markAllRead(me, T0))
    expect(affected).toBe(1)
    expect(await run((tx) => tx.notifications.unreadCount(me))).toBe(0)
  })

  it('clears one (owner-scoped) and clears all (read + unread)', async () => {
    // Arrange — a fresh recipient with one read + one unread notification.
    const me = insertUser(db.connection).id
    const other = insertUser(db.connection).id
    const c = card()
    await run((tx) => tx.cards.insert(c))
    const unread = notification({ userId: me, cardId: c.id })
    const read = notification({ userId: me, cardId: c.id, readAt: T0 })
    await run(async (tx) => {
      for (const n of [unread, read]) await tx.notifications.insert(n)
    })

    // Act + Assert — another user cannot clear mine.
    await run((tx) => tx.notifications.clear(unread.id, other))
    expect(await run((tx) => tx.notifications.listForUser(me, { limit: 50 }))).toHaveLength(2)

    // I clear the unread one; the read one remains.
    await run((tx) => tx.notifications.clear(unread.id, me))
    const remaining = await run((tx) => tx.notifications.listForUser(me, { limit: 50 }))
    expect(remaining.map((n) => n.id)).toEqual([read.id])

    // Clear-all removes the rest (read too) and reports the count.
    const cleared = await run((tx) => tx.notifications.clearAll(me))
    expect(cleared).toBe(1)
    expect(await run((tx) => tx.notifications.listForUser(me, { limit: 50 }))).toHaveLength(0)
  })
})
