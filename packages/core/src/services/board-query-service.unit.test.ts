import { describe, expect, it } from 'vitest'
import { NotFoundError } from '../domain/errors.ts'
import { createScenario, fixtureId, type Scenario } from '../testing/index.ts'

/** Seeds three cards with strictly increasing createdAt for pagination tests. */
function seedDatedCards(scenario: Scenario) {
  return ['2026-07-01', '2026-07-02', '2026-07-03'].map((day, index) =>
    scenario.seedCard({
      title: `Dated ${index.toString()}`,
      createdAt: `${day}T00:00:00.000Z`,
      updatedAt: `${day}T00:00:00.000Z`,
    }),
  )
}

describe('BoardQueryService.boardSnapshot', () => {
  it('returns lanes in board order with cards in position order, excluding archived', async () => {
    // Arrange
    const scenario = createScenario()
    const second = scenario.seedCard({ laneId: scenario.lanes.ready.id })
    const third = scenario.seedCard({ laneId: scenario.lanes.ready.id })
    const first = scenario.seedCard({ laneId: scenario.lanes.ready.id, position: 'Zz' })
    scenario.seedCard({
      laneId: scenario.lanes.done.id,
      resolution: 'completed',
      archivedAt: '2026-01-01T00:00:00.000Z',
    })

    // Act
    const snapshot = await scenario.queries.boardSnapshot()

    // Assert
    expect(snapshot.lanes.map((entry) => entry.lane.key)).toEqual([
      'intake',
      'waiting_approval',
      'ready',
      'in_progress',
      'waiting_parts_vendor',
      'review',
      'done',
    ])
    expect(snapshot.lanes.at(2)?.cards.map((card) => card.id)).toEqual([
      first.id,
      second.id,
      third.id,
    ])
    expect(snapshot.lanes.at(6)?.cards).toHaveLength(0)
  })

  it('carries tag names, active-attachment count, and location label on each summary card', async () => {
    // Arrange — a card with two tags, a location, and two attachments (one
    // soft-deleted), plus a bare card in the same lane.
    const scenario = createScenario()
    const location = {
      id: fixtureId(700),
      parentId: null,
      kind: 'building' as const,
      name: 'Depot',
    }
    scenario.db.seedLocation(location)
    const tagA = { id: fixtureId(701), name: 'HVAC' }
    const tagB = { id: fixtureId(702), name: 'urgent' }
    scenario.db.seedTag(tagA)
    scenario.db.seedTag(tagB)
    const rich = scenario.seedCard({ laneId: scenario.lanes.ready.id, locationId: location.id })
    scenario.seedCard({ laneId: scenario.lanes.ready.id })
    scenario.db.seedCardTag(rich.id, tagA.id)
    scenario.db.seedCardTag(rich.id, tagB.id)
    scenario.db.seedAttachment({
      id: fixtureId(703),
      cardId: rich.id,
      filename: 'live.pdf',
      mime: 'application/pdf',
      bytes: 10,
      sha256: 'a'.repeat(64),
      storageKey: fixtureId(704),
      uploadedBy: scenario.users.technician.id,
      createdAt: '2026-07-01T00:00:00.000Z',
      deletedAt: null,
    })
    scenario.db.seedAttachment({
      id: fixtureId(705),
      cardId: rich.id,
      filename: 'gone.pdf',
      mime: 'application/pdf',
      bytes: 10,
      sha256: 'b'.repeat(64),
      storageKey: fixtureId(706),
      uploadedBy: scenario.users.technician.id,
      createdAt: '2026-07-01T00:00:00.000Z',
      deletedAt: '2026-07-02T00:00:00.000Z',
    })

    // Act
    const snapshot = await scenario.queries.boardSnapshot()

    // Assert
    const ready = snapshot.lanes.find((entry) => entry.lane.key === 'ready')
    const richSummary = ready?.cards.find((card) => card.id === rich.id)
    const bareSummary = ready?.cards.find((card) => card.id !== rich.id)
    expect(richSummary?.tags.toSorted()).toEqual(['HVAC', 'urgent'])
    expect(richSummary?.attachmentCount).toBe(1)
    expect(richSummary?.locationLabel).toBe('Depot')
    expect(bareSummary).toMatchObject({ tags: [], attachmentCount: 0, locationLabel: null })
  })

  it('flags lanes over their WIP limit', async () => {
    // Arrange
    const scenario = createScenario({ wipLimits: { in_progress: 1 } })
    scenario.seedCard({ laneId: scenario.lanes.in_progress.id })
    scenario.seedCard({ laneId: scenario.lanes.in_progress.id })

    // Act
    const snapshot = await scenario.queries.boardSnapshot()

    // Assert
    expect(snapshot.lanes.at(3)?.wipLimitExceeded).toBe(true)
    expect(snapshot.lanes.at(0)?.wipLimitExceeded).toBe(false)
  })
})

describe('BoardQueryService.listCards', () => {
  it('lists newest-first and round-trips the opaque cursor across pages', async () => {
    // Arrange
    const scenario = createScenario()
    const [oldest, middle, newest] = seedDatedCards(scenario)

    // Act
    const pageOne = await scenario.queries.listCards({}, { limit: 2 })
    const pageTwo = await scenario.queries.listCards(
      {},
      { limit: 2, cursor: pageOne.nextCursor ?? '' },
    )

    // Assert
    expect(pageOne.items.map((card) => card.id)).toEqual([newest?.id, middle?.id])
    expect(pageOne.nextCursor).not.toBeNull()
    expect(pageTwo.items.map((card) => card.id)).toEqual([oldest?.id])
    expect(pageTwo.nextCursor).toBeNull()
  })

  it('breaks createdAt ties by id descending with a strict cursor (no skips or dupes)', async () => {
    // Arrange — two cards sharing one createdAt millisecond (bulk import shape)
    const scenario = createScenario()
    const lowerId = scenario.seedCard({ title: 'Twin A' })
    const higherId = scenario.seedCard({ title: 'Twin B' })

    // Act
    const pageOne = await scenario.queries.listCards({}, { limit: 1 })
    const pageTwo = await scenario.queries.listCards(
      {},
      { limit: 1, cursor: pageOne.nextCursor ?? '' },
    )

    // Assert
    expect(pageOne.items.map((card) => card.id)).toEqual([higherId.id])
    expect(pageTwo.items.map((card) => card.id)).toEqual([lowerId.id])
    expect(pageTwo.nextCursor).toBeNull()
  })

  it('filters by lane key, priority, and blocked flag', async () => {
    // Arrange
    const scenario = createScenario()
    const match = scenario.seedCard({
      laneId: scenario.lanes.in_progress.id,
      priority: 'P0',
      blocked: true,
      blockedReason: 'stuck',
      blockedAt: '2026-07-10T00:00:00.000Z',
    })
    scenario.seedCard({ laneId: scenario.lanes.in_progress.id, priority: 'P0' })
    scenario.seedCard({ laneId: scenario.lanes.ready.id, priority: 'P0', blocked: true })

    // Act
    const page = await scenario.queries.listCards({
      lane: 'in_progress',
      priority: 'P0',
      blocked: true,
    })

    // Assert
    expect(page.items.map((card) => card.id)).toEqual([match.id])
  })

  it('matches q against title and description, case-insensitively', async () => {
    // Arrange
    const scenario = createScenario()
    const byTitle = scenario.seedCard({ title: 'Broken COMPRESSOR unit' })
    const byDescription = scenario.seedCard({
      title: 'Other',
      description: 'The compressor is leaking oil',
    })
    scenario.seedCard({ title: 'Unrelated' })

    // Act
    const page = await scenario.queries.listCards({ q: 'compressor' })

    // Assert
    expect(page.items.map((card) => card.id).sort()).toEqual([byTitle.id, byDescription.id].sort())
  })

  it('filters by tag case-insensitively', async () => {
    // Arrange
    const scenario = createScenario()
    const tagged = scenario.seedCard()
    scenario.seedCard()
    scenario.db.seedTag({ id: fixtureId(900), name: 'HVAC' })
    scenario.db.seedCardTag(tagged.id, fixtureId(900))

    // Act
    const page = await scenario.queries.listCards({ tag: 'hvac' })

    // Assert
    expect(page.items.map((card) => card.id)).toEqual([tagged.id])
  })

  it('excludes archived cards unless includeArchived is set', async () => {
    // Arrange
    const scenario = createScenario()
    const active = scenario.seedCard()
    const archived = scenario.seedCard({
      laneId: scenario.lanes.done.id,
      resolution: 'completed',
      archivedAt: '2026-01-01T00:00:00.000Z',
    })

    // Act
    const withoutArchived = await scenario.queries.listCards({})
    const withArchived = await scenario.queries.listCards({ includeArchived: true })

    // Assert
    expect(withoutArchived.items.map((card) => card.id)).toEqual([active.id])
    expect(withArchived.items.map((card) => card.id).sort()).toEqual(
      [active.id, archived.id].sort(),
    )
  })

  it('returns only cards overdue as of the following UTC day for overdueResume', async () => {
    // Arrange: fixed clock is 2026-07-16
    const scenario = createScenario()
    const overdue = scenario.seedCard({
      laneId: scenario.lanes.waiting_parts_vendor.id,
      waitingReason: 'parts',
      expectedResumeAt: '2026-07-15',
    })
    scenario.seedCard({
      laneId: scenario.lanes.waiting_parts_vendor.id,
      waitingReason: 'vendor',
      expectedResumeAt: '2026-07-16',
    })

    // Act
    const page = await scenario.queries.listCards({ overdueResume: true })

    // Assert
    expect(page.items.map((card) => card.id)).toEqual([overdue.id])
  })
})

describe('BoardQueryService.cardDetail', () => {
  it('returns the card with tags, location, and active attachments only', async () => {
    // Arrange
    const scenario = createScenario()
    const location = { id: fixtureId(700), parentId: null, kind: 'room' as const, name: 'B1-101' }
    scenario.db.seedLocation(location)
    const card = scenario.seedCard({ locationId: location.id })
    scenario.db.seedTag({ id: fixtureId(900), name: 'electrical' })
    scenario.db.seedCardTag(card.id, fixtureId(900))
    const kept = await scenario.attachments.add(scenario.actors.technician, card.id, {
      filename: 'kept.png',
      mime: 'image/png',
      content: new Uint8Array(1),
      sha256: 'b'.repeat(64),
    })
    const removed = await scenario.attachments.add(scenario.actors.technician, card.id, {
      filename: 'removed.png',
      mime: 'image/png',
      content: new Uint8Array(1),
      sha256: 'c'.repeat(64),
    })
    await scenario.attachments.remove(scenario.actors.technician, removed.id)

    // Act
    const detail = await scenario.queries.cardDetail(card.id)

    // Assert
    expect(detail.card.id).toBe(card.id)
    expect(detail.tags.map((tag) => tag.name)).toEqual(['electrical'])
    expect(detail.location?.name).toBe('B1-101')
    expect(detail.attachments.map((attachment) => attachment.id)).toEqual([kept.id])
  })

  it('rejects an unknown card', async () => {
    // Arrange
    const scenario = createScenario()

    // Act
    const act = scenario.queries.cardDetail(fixtureId(999))

    // Assert
    await expect(act).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('BoardQueryService.cardHistory', () => {
  it('returns events oldest-first with cursor pagination', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard({ laneId: scenario.lanes.ready.id })
    await scenario.cards.update(scenario.actors.technician, card.id, {
      title: 'Renamed once',
      expectedVersion: 1,
    })
    scenario.clock.advanceDays(1)
    await scenario.cards.move(scenario.actors.technician, card.id, {
      toLane: 'in_progress',
      expectedVersion: 2,
    })
    scenario.clock.advanceDays(1)
    await scenario.cards.block(scenario.actors.technician, card.id, {
      reason: 'parts missing',
      expectedVersion: 3,
    })

    // Act
    const pageOne = await scenario.queries.cardHistory(card.id, { limit: 2 })
    const pageTwo = await scenario.queries.cardHistory(card.id, {
      limit: 2,
      cursor: pageOne.nextCursor ?? '',
    })

    // Assert
    expect(pageOne.items.map((event) => event.eventType)).toEqual([
      'card.field_changed',
      'card.status_changed',
    ])
    expect(pageTwo.items.map((event) => event.eventType)).toEqual(['card.blocked'])
    expect(pageTwo.nextCursor).toBeNull()
  })

  it('filters by event type', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard({ laneId: scenario.lanes.ready.id })
    await scenario.cards.update(scenario.actors.technician, card.id, {
      title: 'Renamed',
      expectedVersion: 1,
    })
    await scenario.cards.move(scenario.actors.technician, card.id, {
      toLane: 'in_progress',
      expectedVersion: 2,
    })

    // Act
    const page = await scenario.queries.cardHistory(card.id, { type: 'card.status_changed' })

    // Assert
    expect(page.items).toHaveLength(1)
    expect(page.items.at(0)?.eventType).toBe('card.status_changed')
  })
})

describe('BoardQueryService.cardDetailWithThread', () => {
  it('returns only the trailing take events, in chronological order', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard({ laneId: scenario.lanes.ready.id })
    await scenario.cards.update(scenario.actors.technician, card.id, {
      title: 'Renamed once',
      expectedVersion: 1,
    })
    scenario.clock.advanceDays(1)
    await scenario.cards.move(scenario.actors.technician, card.id, {
      toLane: 'in_progress',
      expectedVersion: 2,
    })
    scenario.clock.advanceDays(1)
    await scenario.cards.block(scenario.actors.technician, card.id, {
      reason: 'parts missing',
      expectedVersion: 3,
    })

    // Act
    const detail = await scenario.queries.cardDetailWithThread(card.id, 2)

    // Assert
    expect(detail.card.id).toBe(card.id)
    expect(detail.latestEvents.map((event) => event.eventType)).toEqual([
      'card.status_changed',
      'card.blocked',
    ])
  })

  it('includes the comment thread with soft-deleted bodies blanked', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard()
    const kept = await scenario.comments.add(scenario.actors.technician, card.id, {
      body: 'Parts ordered.',
    })
    const deleted = await scenario.comments.add(scenario.actors.technician, card.id, {
      body: 'sensitive text the author deleted',
    })
    await scenario.comments.softDelete(scenario.actors.technician, deleted.id)

    // Act
    const detail = await scenario.queries.cardDetailWithThread(card.id, 5)

    // Assert
    expect(detail.comments.map((comment) => comment.id)).toEqual([kept.id, deleted.id])
    expect(detail.comments.at(0)?.body).toBe('Parts ordered.')
    expect(detail.comments.at(1)?.body).toBe('')
  })

  it('rejects an unknown card id', async () => {
    // Arrange
    const scenario = createScenario()

    // Act
    const act = scenario.queries.cardDetailWithThread(fixtureId(999), 5)

    // Assert
    await expect(act).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('BoardQueryService.staleCards', () => {
  it('reports waiting cards as overdue starting the UTC day after their resume date', async () => {
    // Arrange: fixed clock is 2026-07-16
    const scenario = createScenario()
    const overdue = scenario.seedCard({
      laneId: scenario.lanes.waiting_parts_vendor.id,
      waitingReason: 'parts',
      expectedResumeAt: '2026-07-15',
    })
    scenario.seedCard({
      laneId: scenario.lanes.waiting_parts_vendor.id,
      waitingReason: 'vendor',
      expectedResumeAt: '2026-07-16',
    })

    // Act
    const stale = await scenario.queries.staleCards()

    // Assert
    expect(stale).toHaveLength(1)
    expect(stale.at(0)?.card.id).toBe(overdue.id)
    expect(stale.at(0)?.reasons).toEqual(['overdue_resume'])
  })

  it('reports review cards older than reviewDays using their lane-entry event', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard({ laneId: scenario.lanes.in_progress.id })
    await scenario.cards.move(scenario.actors.technician, card.id, {
      toLane: 'review',
      expectedVersion: 1,
    })
    scenario.clock.advanceDays(8)

    // Act
    const stale = await scenario.queries.staleCards()

    // Assert
    expect(stale.map((entry) => entry.card.id)).toEqual([card.id])
    expect(stale.at(0)?.reasons).toEqual(['stale_review'])
  })

  it('does not report a review card at exactly the threshold', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard({ laneId: scenario.lanes.in_progress.id })
    await scenario.cards.move(scenario.actors.technician, card.id, {
      toLane: 'review',
      expectedVersion: 1,
    })
    scenario.clock.advanceDays(7)

    // Act
    const stale = await scenario.queries.staleCards()

    // Assert
    expect(stale).toHaveLength(0)
  })

  it('falls back to createdAt for review cards with no move history', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard({
      laneId: scenario.lanes.review.id,
      createdAt: '2026-07-01T00:00:00.000Z',
    })

    // Act
    const stale = await scenario.queries.staleCards()

    // Assert
    expect(stale.map((entry) => entry.card.id)).toEqual([card.id])
  })

  it('reports blocked cards past blockedDays and merges reasons per card', async () => {
    // Arrange: blocked 4 days ago, in review 10 days
    const scenario = createScenario()
    const card = scenario.seedCard({
      laneId: scenario.lanes.review.id,
      createdAt: '2026-07-06T00:00:00.000Z',
      blocked: true,
      blockedReason: 'no parts',
      blockedAt: '2026-07-12T00:00:00.000Z',
    })
    scenario.seedCard({
      blocked: true,
      blockedReason: 'fresh',
      blockedAt: '2026-07-15T00:00:00.000Z',
    })

    // Act
    const stale = await scenario.queries.staleCards()

    // Assert
    expect(stale).toHaveLength(1)
    expect(stale.at(0)?.card.id).toBe(card.id)
    expect(stale.at(0)?.reasons.sort()).toEqual(['stale_blocked', 'stale_review'])
  })

  it('honors custom reviewDays and blockedDays thresholds', async () => {
    // Arrange: blocked 2.5 days as of the fixed clock
    const scenario = createScenario()
    scenario.seedCard({
      blocked: true,
      blockedReason: 'stuck',
      blockedAt: '2026-07-14T00:00:00.000Z',
    })

    // Act
    const defaults = await scenario.queries.staleCards()
    const tightened = await scenario.queries.staleCards({ blockedDays: 2 })

    // Assert
    expect(defaults).toHaveLength(0)
    expect(tightened.at(0)?.reasons).toEqual(['stale_blocked'])
  })
})
