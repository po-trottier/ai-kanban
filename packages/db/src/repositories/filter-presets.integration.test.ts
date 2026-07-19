import {
  EMPTY_BOARD_FILTER,
  NotFoundError,
  type Card,
  type FilterPreset,
  type TransactionContext,
} from '@rivian-kanban/core'
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
 * The board-filter DB surface (docs/architecture/board-filters.md): the
 * multi-select + overdue-candidate legs of `CardRepository.query`, the filtered
 * `queryBoardSummaries` read, and the per-user `FilterPresetRepository` CRUD
 * with strict owner isolation. Real SQLite, real migrations.
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

function card(overrides: Partial<Card> = {}): Card {
  return makeCard({
    boardId: base.boardId,
    laneId: base.lanes.intake.id,
    reporterId: alice,
    position: newId(),
    ...overrides,
  })
}

function preset(overrides: Partial<FilterPreset> & Pick<FilterPreset, 'ownerId'>): FilterPreset {
  return {
    id: newId(),
    name: 'Preset',
    filter: EMPTY_BOARD_FILTER,
    shared: false,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  }
}

describe('query — board-filter multi-selects and overdue candidate', () => {
  it('matches any-of priorities, lanes, assignees, and reporters', async () => {
    // Arrange
    const p0 = card({ priority: 'P0', laneId: base.lanes.ready.id, assigneeId: alice })
    const p1 = card({ priority: 'P1', laneId: base.lanes.intake.id, reporterId: bob })
    const p2 = card({ priority: 'P2', laneId: base.lanes.ready.id })
    await run(async (tx) => {
      for (const c of [p0, p1, p2]) await tx.cards.insert(c)
    })

    // Act
    const byPriority = await run((tx) =>
      tx.cards.query({ boardId: base.boardId, priorities: ['P0', 'P1'] }),
    )
    const byLane = await run((tx) =>
      tx.cards.query({ boardId: base.boardId, laneIds: [base.lanes.ready.id] }),
    )
    const byAssignee = await run((tx) =>
      tx.cards.query({ boardId: base.boardId, assigneeIds: [alice] }),
    )
    const byReporter = await run((tx) =>
      tx.cards.query({ boardId: base.boardId, reporterIds: [bob] }),
    )

    // Assert
    expect(byPriority.map((c) => c.id).sort((a, b) => a - b)).toEqual(
      [p0.id, p1.id].sort((a, b) => a - b),
    )
    expect(byLane.map((c) => c.id).sort((a, b) => a - b)).toEqual(
      [p0.id, p2.id].sort((a, b) => a - b),
    )
    expect(byAssignee.map((c) => c.id)).toEqual([p0.id])
    expect(byReporter.map((c) => c.id)).toEqual([p1.id])
  })

  it('overdueCandidate restricts to started + estimated cards', async () => {
    // Arrange — only one card has BOTH a work start and an estimate.
    const candidate = card({
      laneId: base.lanes.in_progress.id,
      workStartedAt: T0,
      estimateMinutes: 60,
    })
    const noEstimate = card({ laneId: base.lanes.in_progress.id, workStartedAt: T0 })
    const noStart = card({ laneId: base.lanes.ready.id, estimateMinutes: 60 })
    await run(async (tx) => {
      for (const c of [candidate, noEstimate, noStart]) await tx.cards.insert(c)
    })

    // Act
    const rows = await run((tx) =>
      tx.cards.query({ boardId: base.boardId, overdueCandidate: true }),
    )

    // Assert — the two non-candidates are excluded at the DB layer.
    expect(rows.map((c) => c.id)).toContain(candidate.id)
    expect(rows.map((c) => c.id)).not.toContain(noEstimate.id)
    expect(rows.map((c) => c.id)).not.toContain(noStart.id)
  })
})

describe('queryBoardSummaries — filtered board with extras', () => {
  // The review lane is untouched by other tests, so the match set is exact.
  it('returns matching summaries in position order with the join-sourced extras', async () => {
    // Arrange — two review P0 cards (position b < c) and a P2 that must not match.
    const first = card({ laneId: base.lanes.review.id, priority: 'P0', position: 'b' })
    const second = card({ laneId: base.lanes.review.id, priority: 'P0', position: 'c' })
    const other = card({ laneId: base.lanes.review.id, priority: 'P2', position: 'd' })
    await run(async (tx) => {
      for (const c of [second, first, other]) await tx.cards.insert(c)
    })

    // Act
    const rows = await run((tx) =>
      tx.cards.queryBoardSummaries({
        boardId: base.boardId,
        laneIds: [base.lanes.review.id],
        priorities: ['P0'],
      }),
    )

    // Assert — position order, extras present, non-matching card excluded.
    expect(rows.map((row) => row.card.id)).toEqual([first.id, second.id])
    expect(rows[0]?.extras).toEqual({ tags: [], attachmentCount: 0, locationLabel: null })
  })
})

describe('FilterPresetRepository — per-user CRUD isolation', () => {
  it('lists only the owner presets, newest-first', async () => {
    // Arrange
    const older = preset({ ownerId: alice, name: 'Older', createdAt: '2026-07-01T00:00:00.000Z' })
    const newer = preset({ ownerId: alice, name: 'Newer', createdAt: '2026-07-10T00:00:00.000Z' })
    const bobs = preset({ ownerId: bob, name: "Bob's" })
    await run(async (tx) => {
      for (const p of [older, newer, bobs]) await tx.filterPresets.insert(p)
    })

    // Act
    const aliceList = await run((tx) => tx.filterPresets.listVisibleTo(alice))

    // Assert — newest-first, and Bob's PRIVATE preset is absent from Alice's list.
    expect(aliceList.map((p) => p.name)).toEqual(['Newer', 'Older'])
    expect(aliceList.some((p) => p.ownerId === bob)).toBe(false)
  })

  it("includes another user's SHARED preset but not their private one", async () => {
    // Arrange — Bob has one shared and one private preset.
    const shared = preset({ ownerId: bob, name: "Bob's shared", shared: true })
    const priv = preset({ ownerId: bob, name: "Bob's private", shared: false })
    await run(async (tx) => {
      for (const p of [shared, priv]) await tx.filterPresets.insert(p)
    })

    // Act — Alice's visible list.
    const aliceList = await run((tx) => tx.filterPresets.listVisibleTo(alice))

    // Assert — the shared one is visible to Alice; the private one is not.
    expect(aliceList.some((p) => p.id === shared.id)).toBe(true)
    expect(aliceList.some((p) => p.id === priv.id)).toBe(false)
  })

  it('scopes findById by owner — another user cannot read the row', async () => {
    // Arrange
    const p = preset({ ownerId: alice, name: 'Private' })
    await run((tx) => tx.filterPresets.insert(p))

    // Act
    const asOwner = await run((tx) => tx.filterPresets.findByIdForOwner(p.id, alice))
    const asOther = await run((tx) => tx.filterPresets.findByIdForOwner(p.id, bob))

    // Assert — round-trips the JSON filter for the owner; absent for the other.
    expect(asOwner?.filter).toEqual(EMPTY_BOARD_FILTER)
    expect(asOther).toBeNull()
  })

  it('updates and deletes only when owned; otherwise NotFoundError', async () => {
    // Arrange
    const p = preset({ ownerId: alice, name: 'Editable' })
    await run((tx) => tx.filterPresets.insert(p))

    // Act — another user's update/delete cannot touch it.
    await expect(
      run((tx) => tx.filterPresets.update({ ...p, ownerId: bob, name: 'Hijacked' })),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(run((tx) => tx.filterPresets.delete(p.id, bob))).rejects.toBeInstanceOf(
      NotFoundError,
    )

    // The owner can rename it, then delete it.
    await run((tx) =>
      tx.filterPresets.update({
        ...p,
        name: 'Renamed',
        filter: { ...EMPTY_BOARD_FILTER, q: 'hi' },
      }),
    )
    const afterRename = await run((tx) => tx.filterPresets.findByIdForOwner(p.id, alice))
    expect(afterRename?.name).toBe('Renamed')
    expect(afterRename?.filter.q).toBe('hi')

    await run((tx) => tx.filterPresets.delete(p.id, alice))
    expect(await run((tx) => tx.filterPresets.findByIdForOwner(p.id, alice))).toBeNull()
  })
})
