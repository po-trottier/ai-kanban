import {
  DuplicatePositionError,
  NotFoundError,
  type Card,
  type TransactionContext,
} from '@rivian-kanban/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cardTags, tags } from '../schema.ts'
import {
  insertUser,
  makeCard,
  newId,
  openTestDb,
  seedBaseline,
  type Baseline,
  type TestDb,
} from '../test/support.ts'

let db: TestDb
let base: Baseline
let reporterId: string
let assigneeId: string

beforeAll(() => {
  db = openTestDb()
  base = seedBaseline(db.connection)
  reporterId = insertUser(db.connection).id
  assigneeId = insertUser(db.connection).id
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
    reporterId,
    position: newId(), // unique by default; tests override when position matters
    ...overrides,
  })
}

describe('CRUD + uniqueness backstop', () => {
  it('round-trips a full card through insert and findById', async () => {
    const original = card({
      title: 'Round trip',
      description: 'body',
      priority: 'P0',
      estimateMinutes: 90,
      assigneeId,
      blocked: true,
      blockedReason: 'why',
      blockedAt: '2026-07-16T13:00:00.000Z',
      slackChannelId: 'C123',
      slackThreadTs: '1700.1',
      slackPermalink: 'https://example.slack.com/x',
    })

    await run((tx) => tx.cards.insert(original))
    const found = await run((tx) => tx.cards.findById(original.id))

    expect(found).toEqual(original)
  })

  it('findById returns null for an unknown id', async () => {
    await expect(run((tx) => tx.cards.findById(newId()))).resolves.toBeNull()
  })

  it('update rewrites the row and update of a missing card rejects NotFoundError', async () => {
    const existing = card()
    await run((tx) => tx.cards.insert(existing))
    const updated: Card = { ...existing, title: 'Renamed', version: 2, blocked: true }

    await run((tx) => tx.cards.update(updated))
    const found = await run((tx) => tx.cards.findById(existing.id))

    expect(found).toEqual(updated)
    await expect(run((tx) => tx.cards.update(card()))).rejects.toBeInstanceOf(NotFoundError)
  })

  it('insert violating UNIQUE(lane_id, position) rejects DuplicatePositionError', async () => {
    const laneId = base.lanes.ready.id
    await run((tx) => tx.cards.insert(card({ laneId, position: 'p0' })))

    const duplicate = run((tx) => tx.cards.insert(card({ laneId, position: 'p0' })))

    await expect(duplicate).rejects.toBeInstanceOf(DuplicatePositionError)
  })

  it('update moving onto an occupied position rejects DuplicatePositionError', async () => {
    const laneId = base.lanes.review.id
    const first = card({ laneId, position: 'q0' })
    const second = card({ laneId, position: 'q1' })
    await run((tx) => tx.cards.insert(first))
    await run((tx) => tx.cards.insert(second))

    const collision = run((tx) => tx.cards.update({ ...second, position: 'q0' }))

    await expect(collision).rejects.toBeInstanceOf(DuplicatePositionError)
  })

  it('the same position is allowed in different lanes', async () => {
    await run((tx) => tx.cards.insert(card({ laneId: base.lanes.in_progress.id, position: 's0' })))

    const other = run((tx) =>
      tx.cards.insert(card({ laneId: base.lanes.review.id, position: 's0' })),
    )

    await expect(other).resolves.toBeUndefined()
  })
})

describe('listByLane', () => {
  it('orders by position under BINARY collation (uppercase before lowercase), archived included', async () => {
    const laneId = base.lanes.waiting_approval.id
    const lower = card({ laneId, position: 'a0' })
    const upper = card({ laneId, position: 'A1', archivedAt: '2026-07-16T13:00:00.000Z' })
    await run((tx) => tx.cards.insert(lower))
    await run((tx) => tx.cards.insert(upper))

    const listed = await run((tx) => tx.cards.listByLane(laneId))

    // NOCASE would sort 'a0' first; BINARY sorts 'A1' (0x41) before 'a0' (0x61).
    expect(listed.map((c) => c.position)).toEqual(['A1', 'a0'])
  })
})

describe('query — filters', () => {
  const filterLane = () => base.lanes.waiting_parts_vendor.id

  beforeAll(async () => {
    const laneId = filterLane()
    const tagId = newId()
    db.connection.db.insert(tags).values({ id: tagId, name: 'Electrical' }).run()
    const tagged = card({
      laneId,
      position: 'f0',
      title: 'Tagged waiting card',
      priority: 'P1',
      assigneeId,
      waitingReason: 'parts',
      expectedResumeAt: '2026-07-01',
      blocked: true,
      blockedReason: 'stuck',
      blockedAt: '2026-07-10T00:00:00.000Z',
    })
    await run((tx) => tx.cards.insert(tagged))
    db.connection.db.insert(cardTags).values({ cardId: tagged.id, tagId }).run()
    await run((tx) =>
      tx.cards.insert(
        card({
          laneId,
          position: 'f1',
          title: 'Future resume',
          description: 'Needle in the HAYSTACK here',
          waitingReason: 'vendor',
          expectedResumeAt: '2026-12-01',
        }),
      ),
    )
    await run((tx) =>
      tx.cards.insert(
        card({
          laneId,
          position: 'f2',
          title: 'Archived one',
          archivedAt: '2026-07-16T00:00:00.000Z',
        }),
      ),
    )
    await run((tx) =>
      tx.cards.insert(card({ laneId, position: 'f3', title: 'Éclairage du couloir est' })),
    )
  })

  it('excludes archived cards unless includeArchived is set', async () => {
    const laneId = filterLane()

    const active = await run((tx) => tx.cards.query({ laneId }))
    const all = await run((tx) => tx.cards.query({ laneId, includeArchived: true }))

    expect(active.map((c) => c.title)).not.toContain('Archived one')
    expect(all.map((c) => c.title)).toContain('Archived one')
  })

  it('filters by assignee, priority, blocked, and waitingReason', async () => {
    const laneId = filterLane()

    const byAssignee = await run((tx) => tx.cards.query({ laneId, assigneeId }))
    const byPriority = await run((tx) => tx.cards.query({ laneId, priority: 'P1' }))
    const byBlocked = await run((tx) => tx.cards.query({ laneId, blocked: true }))
    const byReason = await run((tx) => tx.cards.query({ laneId, waitingReason: 'vendor' }))

    expect(byAssignee.map((c) => c.title)).toEqual(['Tagged waiting card'])
    expect(byPriority.map((c) => c.title)).toEqual(['Tagged waiting card'])
    expect(byBlocked.map((c) => c.title)).toEqual(['Tagged waiting card'])
    expect(byReason.map((c) => c.title)).toEqual(['Future resume'])
  })

  it('overdueBefore matches strictly-earlier resume dates and never NULLs', async () => {
    const laneId = filterLane()

    const overdue = await run((tx) => tx.cards.query({ laneId, overdueBefore: '2026-07-16' }))
    const boundary = await run((tx) => tx.cards.query({ laneId, overdueBefore: '2026-07-01' }))

    expect(overdue.map((c) => c.title)).toEqual(['Tagged waiting card'])
    expect(boundary).toEqual([])
  })

  it('matches tags case-insensitively', async () => {
    const laneId = filterLane()

    const hits = await run((tx) => tx.cards.query({ laneId, tag: 'eLeCtRiCaL' }))
    const misses = await run((tx) => tx.cards.query({ laneId, tag: 'plumbing' }))

    expect(hits.map((c) => c.title)).toEqual(['Tagged waiting card'])
    expect(misses).toEqual([])
  })

  it('q searches title + description case-insensitively with LIKE wildcards escaped', async () => {
    const laneId = filterLane()

    const byTitle = await run((tx) => tx.cards.query({ laneId, q: 'tagged WAITING' }))
    const byDescription = await run((tx) => tx.cards.query({ laneId, q: 'haystack' }))
    const literalPercent = await run((tx) => tx.cards.query({ laneId, q: '100%' }))

    expect(byTitle.map((c) => c.title)).toEqual(['Tagged waiting card'])
    expect(byDescription.map((c) => c.title)).toEqual(['Future resume'])
    expect(literalPercent).toEqual([])
  })

  it('q matches an exact non-ASCII substring (both sides folded in SQL, not JS)', async () => {
    const laneId = filterLane()

    // SQLite's lower() is ASCII-only: folding the needle in JS ('É' → 'é')
    // while the stored 'É' stays unchanged would make this exact match miss.
    const exact = await run((tx) => tx.cards.query({ laneId, q: 'Éclairage' }))

    expect(exact.map((c) => c.title)).toEqual(['Éclairage du couloir est'])
  })
})

describe('query — cursor contract (createdAt DESC, id DESC, strictly older)', () => {
  const laneId = () => base.lanes.done.id
  const shared = '2026-07-16T15:00:00.000Z'
  const older = '2026-07-16T14:00:00.000Z'
  const idLow = '20000000-0000-7000-8000-000000000001'
  const idHigh = '20000000-0000-7000-8000-000000000002'
  const idOld = '20000000-0000-7000-8000-000000000003'

  beforeAll(async () => {
    await run(async (tx) => {
      await tx.cards.insert(
        card({ id: idLow, laneId: laneId(), position: 'k0', createdAt: shared }),
      )
      await tx.cards.insert(
        card({ id: idHigh, laneId: laneId(), position: 'k1', createdAt: shared }),
      )
      await tx.cards.insert(card({ id: idOld, laneId: laneId(), position: 'k2', createdAt: older }))
    })
  })

  it('orders newest-first with the id tie-break descending too', async () => {
    const rows = await run((tx) => tx.cards.query({ laneId: laneId() }))

    expect(rows.map((c) => c.id)).toEqual([idHigh, idLow, idOld])
  })

  it('returns only rows strictly older than the cursor tuple', async () => {
    const afterHigh = await run((tx) =>
      tx.cards.query({ laneId: laneId() }, { after: { createdAt: shared, id: idHigh } }),
    )
    const afterLow = await run((tx) =>
      tx.cards.query({ laneId: laneId() }, { after: { createdAt: shared, id: idLow } }),
    )

    // The row equal to the cursor is excluded; its same-timestamp sibling with
    // a smaller id is not skipped.
    expect(afterHigh.map((c) => c.id)).toEqual([idLow, idOld])
    expect(afterLow.map((c) => c.id)).toEqual([idOld])
  })

  it('applies the limit after cursor filtering', async () => {
    const rows = await run((tx) =>
      tx.cards.query({ laneId: laneId() }, { after: { createdAt: shared, id: idHigh }, limit: 1 }),
    )

    expect(rows.map((c) => c.id)).toEqual([idLow])
  })
})

describe('query plans — the partial indexes serve the hot reads', () => {
  // The done lane archives in place, so these queries must stay proportional
  // to LIVE rows. EXPLAIN QUERY PLAN proves the planner picks the partial
  // indexes for the exact predicate shapes the repository issues (bound
  // parameters included — SQLite re-prepares on bind to prove implication).
  function planOf(sql: string, ...params: unknown[]): string {
    return (
      db.connection.raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as {
        detail: string
      }[]
    )
      .map((row) => row.detail)
      .join(' | ')
  }

  it('uses cards_lane_active_position_idx for activeOnly listByLane', () => {
    const plan = planOf(
      'SELECT * FROM cards WHERE lane_id = ? AND archived_at IS NULL ORDER BY position',
      base.lanes.done.id,
    )

    expect(plan).toContain('cards_lane_active_position_idx')
  })

  it('uses cards_blocked_active_idx for the stale-cards blocked leg', () => {
    const plan = planOf(
      'SELECT * FROM cards WHERE archived_at IS NULL AND blocked = ? ' +
        'ORDER BY created_at DESC, id DESC',
      1,
    )

    expect(plan).toContain('cards_blocked_active_idx')
  })
})
