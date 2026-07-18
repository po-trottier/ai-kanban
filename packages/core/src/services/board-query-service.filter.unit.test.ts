import { describe, expect, it } from 'vitest'
import { createScenario, fixtureId } from '../testing/index.ts'

/**
 * `BoardQueryService.filteredBoard` (docs/architecture/board-filters.md): the
 * board grouped by lane, narrowed by a `BoardFilter` at the query layer. The
 * empty filter equals `boardSnapshot`; every facet — including the computed
 * `overdue` business-minutes verdict, archived scope, text, and multi-selects —
 * is exercised. All matching is at the DB layer (the in-memory fake mirrors it).
 */

/** All card ids across every lane of a snapshot. */
function idsOf(snapshot: { lanes: { cards: { id: number }[] }[] }): number[] {
  return snapshot.lanes.flatMap((lane) => lane.cards.map((card) => card.id)).sort((a, b) => a - b)
}

describe('BoardQueryService.filteredBoard', () => {
  it('returns the full board (grouped by lane) for the empty filter', async () => {
    // Arrange
    const scenario = createScenario()
    const a = scenario.seedCard({ laneId: scenario.lanes.intake.id })
    const b = scenario.seedCard({ laneId: scenario.lanes.ready.id })

    // Act
    const filtered = await scenario.queries.filteredBoard({})
    const snapshot = await scenario.queries.boardSnapshot()

    // Assert — same ids and same lane grouping as the unfiltered snapshot.
    expect(idsOf(filtered)).toEqual([a.id, b.id])
    expect(filtered.lanes.map((lane) => lane.lane.key)).toEqual(
      snapshot.lanes.map((lane) => lane.lane.key),
    )
  })

  it('narrows by priority (multi-select any-of)', async () => {
    // Arrange
    const scenario = createScenario()
    const p0 = scenario.seedCard({ priority: 'P0' })
    const p1 = scenario.seedCard({ priority: 'P1' })
    scenario.seedCard({ priority: 'P2' })

    // Act
    const filtered = await scenario.queries.filteredBoard({ priorities: ['P0', 'P1'] })

    // Assert
    expect(idsOf(filtered)).toEqual([p0.id, p1.id].sort((a, b) => a - b))
  })

  it('narrows by assignee ids (multi-select any-of)', async () => {
    // Arrange
    const scenario = createScenario()
    const mine = scenario.seedCard({
      laneId: scenario.lanes.ready.id,
      assigneeId: scenario.users.technician.id,
    })
    scenario.seedCard({
      laneId: scenario.lanes.ready.id,
      assigneeId: scenario.users.requester.id,
    })
    const alsoMine = scenario.seedCard({
      laneId: scenario.lanes.intake.id,
      assigneeId: scenario.users.technician.id,
    })

    // Act
    const filtered = await scenario.queries.filteredBoard({
      assigneeIds: [scenario.users.technician.id],
    })

    // Assert — both cards assigned to the technician, across lanes.
    expect(idsOf(filtered)).toEqual([mine.id, alsoMine.id].sort((a, b) => a - b))
  })

  it('matches the free-text query over title and description', async () => {
    // Arrange
    const scenario = createScenario()
    const hit = scenario.seedCard({ title: 'Fix the BOILER room' })
    scenario.seedCard({ title: 'Paint the lobby', description: 'boiler mentioned here' })
    scenario.seedCard({ title: 'Unrelated' })

    // Act — case-insensitive substring over title + description.
    const filtered = await scenario.queries.filteredBoard({ q: 'boiler' })

    // Assert — the title hit and the description hit, not the unrelated card.
    expect(idsOf(filtered)).toHaveLength(2)
    expect(idsOf(filtered)).toContain(hit.id)
  })

  it('respects the archived scope selector', async () => {
    // Arrange
    const scenario = createScenario()
    const live = scenario.seedCard({ laneId: scenario.lanes.ready.id })
    const archived = scenario.seedCard({
      laneId: scenario.lanes.done.id,
      resolution: 'completed',
      archivedAt: '2026-01-01T00:00:00.000Z',
    })

    // Act
    const active = await scenario.queries.filteredBoard({ scope: 'active' })
    const onlyArchived = await scenario.queries.filteredBoard({ scope: 'archived' })
    const all = await scenario.queries.filteredBoard({ scope: 'all' })

    // Assert
    expect(idsOf(active)).toEqual([live.id])
    expect(idsOf(onlyArchived)).toEqual([archived.id])
    expect(idsOf(all)).toEqual([live.id, archived.id].sort((a, b) => a - b))
  })

  it('computes the overdue facet from business minutes vs estimate', async () => {
    // Arrange — now is Thursday 2026-07-16 12:00 UTC (scenario default).
    const scenario = createScenario()
    // Started Thursday 09:00, 60-min estimate → 180 business min elapsed → overdue.
    const overdue = scenario.seedCard({
      laneId: scenario.lanes.in_progress.id,
      workStartedAt: '2026-07-16T09:00:00.000Z',
      estimateMinutes: 60,
    })
    // Started Thursday 09:00 but a huge estimate → not yet overdue.
    scenario.seedCard({
      laneId: scenario.lanes.in_progress.id,
      workStartedAt: '2026-07-16T09:00:00.000Z',
      estimateMinutes: 10_000,
    })
    // Never started (no workStartedAt) → cannot be overdue.
    scenario.seedCard({ laneId: scenario.lanes.ready.id, estimateMinutes: 5 })

    // Act
    const filtered = await scenario.queries.filteredBoard({ overdue: true })

    // Assert — only the started card that blew its estimate.
    expect(idsOf(filtered)).toEqual([overdue.id])
  })

  it('any-of tag match across a card_tags join', async () => {
    // Arrange
    const scenario = createScenario()
    const tag = { id: fixtureId(800), name: 'HVAC' }
    scenario.db.seedTag(tag)
    const tagged = scenario.seedCard({ laneId: scenario.lanes.ready.id })
    scenario.db.seedCardTag(tagged.id, tag.id)
    scenario.seedCard({ laneId: scenario.lanes.ready.id })

    // Act — case-insensitive tag match.
    const filtered = await scenario.queries.filteredBoard({ tags: ['hvac'] })

    // Assert
    expect(idsOf(filtered)).toEqual([tagged.id])
  })

  it('unions multiple location filters, each subtree-inclusive (one tree read)', async () => {
    // Arrange — depot(building) → depotRoom, and a separate garage(building).
    // Filtering on [depot, garage] must match the depot subtree AND the garage,
    // deduped and expanded against ONE location-tree read (the DoS-amplifier fix).
    const scenario = createScenario()
    const depot = { id: fixtureId(810), parentId: null, kind: 'building' as const, name: 'Depot' }
    const depotRoom = { id: fixtureId(811), parentId: depot.id, kind: 'room' as const, name: 'R1' }
    const garage = { id: fixtureId(812), parentId: null, kind: 'building' as const, name: 'Garage' }
    const shed = { id: fixtureId(813), parentId: null, kind: 'building' as const, name: 'Shed' }
    for (const location of [depot, depotRoom, garage, shed]) scenario.db.seedLocation(location)
    const inDepotRoom = scenario.seedCard({
      laneId: scenario.lanes.ready.id,
      locationId: depotRoom.id,
    })
    const inGarage = scenario.seedCard({ laneId: scenario.lanes.ready.id, locationId: garage.id })
    scenario.seedCard({ laneId: scenario.lanes.ready.id, locationId: shed.id })

    // Act — depot (via its room subtree) OR garage; depot listed twice to prove dedup.
    const filtered = await scenario.queries.filteredBoard({
      locationIds: [depot.id, garage.id, depot.id],
    })

    // Assert — the depot-room card and the garage card, not the shed card.
    expect(idsOf(filtered)).toEqual([inDepotRoom.id, inGarage.id].sort((a, b) => a - b))
  })

  it('reports WIP breach from the full active lane count, not the filtered slice', async () => {
    // Arrange — two active cards in a WIP-1 lane; the filter matches only one.
    const scenario = createScenario({ wipLimits: { in_progress: 1 } })
    scenario.seedCard({ laneId: scenario.lanes.in_progress.id, priority: 'P0' })
    scenario.seedCard({ laneId: scenario.lanes.in_progress.id, priority: 'P2' })

    // Act — narrow to P0 (one card), but the lane still holds two.
    const filtered = await scenario.queries.filteredBoard({ priorities: ['P0'] })

    // Assert — the WIP marker still fires (breach is a lane property).
    const inProgress = filtered.lanes.find((lane) => lane.lane.key === 'in_progress')
    expect(inProgress?.cards).toHaveLength(1)
    expect(inProgress?.wipLimitExceeded).toBe(true)
  })
})
