import { type Card, type TransactionContext } from '@rivian-kanban/core'
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
 * The card-watchers DB surface (docs/architecture/notifications.md): idempotent
 * `add` (composite PK), the `listWatcherIds` fan-out read, and `remove`. Real
 * SQLite, real migrations.
 */

let db: TestDb
let base: Baseline
let alice: string
let bob: string

beforeAll(() => {
  db = openTestDb()
  base = seedBaseline(db.connection)
  alice = insertUser(db.connection).id
  bob = insertUser(db.connection).id
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

describe('CardWatcherRepository', () => {
  it('adds watchers idempotently and lists them', async () => {
    // Arrange
    const c = card()
    await run((tx) => tx.cards.insert(c))

    // Act — the same watcher twice (idempotent), plus a second watcher.
    await run((tx) => tx.cardWatchers.add(c.id, alice, T0))
    await run((tx) => tx.cardWatchers.add(c.id, alice, T0))
    await run((tx) => tx.cardWatchers.add(c.id, bob, T0))
    const ids = await run((tx) => tx.cardWatchers.listWatcherIds(c.id))

    // Assert — two distinct watchers (the duplicate add was a no-op).
    expect([...ids].sort()).toEqual([alice, bob].sort())
  })

  it('reports and removes a single watcher', async () => {
    // Arrange
    const c = card()
    await run((tx) => tx.cards.insert(c))
    await run((tx) => tx.cardWatchers.add(c.id, alice, T0))

    // Act + Assert — isWatching is per-user; remove drops only that row.
    expect(await run((tx) => tx.cardWatchers.isWatching(c.id, alice))).toBe(true)
    expect(await run((tx) => tx.cardWatchers.isWatching(c.id, bob))).toBe(false)

    await run((tx) => tx.cardWatchers.remove(c.id, alice))
    expect(await run((tx) => tx.cardWatchers.isWatching(c.id, alice))).toBe(false)
  })
})
