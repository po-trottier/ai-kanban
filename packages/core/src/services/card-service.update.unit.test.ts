import { describe, expect, it } from 'vitest'
import { ArchivedError, ConflictError, NotFoundError } from '../domain/errors.ts'
import { createScenario, fixtureId } from '../testing/index.ts'

describe('CardService.update', () => {
  it('emits one card.field_changed event per changed field and bumps the version once', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard({ title: 'Old', priority: 'P2', estimateMinutes: null })

    // Act
    const updated = await scenario.cards.update(scenario.actors.technician, card.id, {
      title: 'New',
      priority: 'P0',
      estimateMinutes: 90,
      expectedVersion: 1,
    })

    // Assert
    const events = scenario.db.eventsFor(card.id)
    expect(updated.version).toBe(2)
    expect(events).toHaveLength(3)
    expect(events.map((event) => event.eventType)).toEqual([
      'card.field_changed',
      'card.field_changed',
      'card.field_changed',
    ])
    expect(events.at(0)?.payload).toEqual({ field: 'title', from: 'Old', to: 'New' })
    expect(events.at(2)?.payload).toEqual({ field: 'estimateMinutes', from: null, to: 90 })
  })

  it('replaces tags wholesale and audits the full from/to arrays', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard()
    scenario.db.seedTag({ id: fixtureId(900), name: 'hvac' })
    scenario.db.seedCardTag(card.id, fixtureId(900))

    // Act
    await scenario.cards.update(scenario.actors.technician, card.id, {
      tags: ['plumbing', 'urgent'],
      expectedVersion: 1,
    })

    // Assert
    expect(scenario.db.tagNamesFor(card.id)).toEqual(['plumbing', 'urgent'])
    expect(scenario.db.eventsFor(card.id).at(0)?.payload).toEqual({
      field: 'tags',
      from: ['hvac'],
      to: ['plumbing', 'urgent'],
    })
  })

  it('treats a case-only tag difference as no change', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard()
    scenario.db.seedTag({ id: fixtureId(900), name: 'HVAC' })
    scenario.db.seedCardTag(card.id, fixtureId(900))

    // Act
    const updated = await scenario.cards.update(scenario.actors.technician, card.id, {
      tags: ['hvac'],
      expectedVersion: 1,
    })

    // Assert
    expect(updated.version).toBe(1)
    expect(scenario.db.eventsFor(card.id)).toHaveLength(0)
    expect(scenario.db.tagNamesFor(card.id)).toEqual(['HVAC'])
  })

  it('is a no-op without a version bump when nothing changed', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard({ title: 'Same title' })

    // Act
    const updated = await scenario.cards.update(scenario.actors.technician, card.id, {
      title: 'Same title',
      expectedVersion: 1,
    })

    // Assert
    expect(updated.version).toBe(1)
    expect(scenario.db.eventsFor(card.id)).toHaveLength(0)
    expect(scenario.eventBus.published).toHaveLength(0)
  })

  it('clears assignee and location with explicit nulls and audits the diff', async () => {
    // Arrange
    const scenario = createScenario()
    const location = { id: fixtureId(700), parentId: null, kind: 'room' as const, name: 'B1-101' }
    scenario.db.seedLocation(location)
    const card = scenario.seedCard({
      assigneeId: scenario.users.technician.id,
      locationId: location.id,
    })

    // Act
    const updated = await scenario.cards.update(scenario.actors.supervisor, card.id, {
      assigneeId: null,
      locationId: null,
      expectedVersion: 1,
    })

    // Assert
    expect(updated.assigneeId).toBeNull()
    expect(updated.locationId).toBeNull()
    expect(scenario.db.eventsFor(card.id).at(0)?.payload).toEqual({
      field: 'assigneeId',
      from: scenario.users.technician.id,
      to: null,
    })
  })

  it('rejects a stale expectedVersion with the current card and commits nothing', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard({ title: 'Original', version: 3 })

    // Act
    const act = scenario.cards.update(scenario.actors.technician, card.id, {
      title: 'Clobbered',
      expectedVersion: 2,
    })

    // Assert
    await expect(act).rejects.toBeInstanceOf(ConflictError)
    await expect(act).rejects.toMatchObject({ current: { id: card.id, version: 3 } })
    expect(scenario.db.getCard(card.id).title).toBe('Original')
    expect(scenario.db.eventsFor(card.id)).toHaveLength(0)
  })

  it('rejects edits to an archived card', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard({
      laneId: scenario.lanes.done.id,
      resolution: 'completed',
      archivedAt: '2026-05-01T00:00:00.000Z',
    })

    // Act
    const act = scenario.cards.update(scenario.actors.admin, card.id, {
      title: 'Too late',
      expectedVersion: 1,
    })

    // Assert
    await expect(act).rejects.toBeInstanceOf(ArchivedError)
  })

  it('rejects an unknown card', async () => {
    // Arrange
    const scenario = createScenario()

    // Act
    const act = scenario.cards.update(scenario.actors.technician, 999, {
      title: 'Ghost',
      expectedVersion: 1,
    })

    // Assert
    await expect(act).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('CardService.update — waiting reason + resume date (in place)', () => {
  it('updates the waiting reason and resume date in place while in the waiting lane', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard({
      laneId: scenario.lanes.waiting_parts_vendor.id,
      waitingReason: 'parts',
      expectedResumeAt: '2026-07-20',
    })

    // Act
    const updated = await scenario.cards.update(scenario.actors.technician, card.id, {
      waitingReason: 'vendor',
      expectedResumeAt: '2026-08-15',
      expectedVersion: 1,
    })

    // Assert
    expect(updated.waitingReason).toBe('vendor')
    expect(updated.expectedResumeAt).toBe('2026-08-15')
    expect(updated.version).toBe(2)
    const events = scenario.db.eventsFor(card.id)
    expect(events.map((event) => event.eventType)).toEqual([
      'card.field_changed',
      'card.field_changed',
    ])
    expect(events.at(0)?.payload).toEqual({
      field: 'waitingReason',
      from: 'parts',
      to: 'vendor',
    })
    expect(events.at(1)?.payload).toEqual({
      field: 'expectedResumeAt',
      from: '2026-07-20',
      to: '2026-08-15',
    })
  })

  it('clears resume_alerted_at when the expected resume date changes so the overdue alert re-arms', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard({
      laneId: scenario.lanes.waiting_parts_vendor.id,
      waitingReason: 'parts',
      expectedResumeAt: '2026-07-01',
      resumeAlertedAt: '2026-07-10T09:00:00.000Z',
    })

    // Act
    const updated = await scenario.cards.update(scenario.actors.supervisor, card.id, {
      expectedResumeAt: '2026-08-01',
      expectedVersion: 1,
    })

    // Assert
    expect(updated.expectedResumeAt).toBe('2026-08-01')
    expect(updated.resumeAlertedAt).toBeNull()
    const events = scenario.db.eventsFor(card.id)
    expect(events).toHaveLength(1)
    expect(events.at(0)?.payload).toEqual({
      field: 'expectedResumeAt',
      from: '2026-07-01',
      to: '2026-08-01',
    })
  })

  it('leaves resume_alerted_at intact when only the reason changes', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard({
      laneId: scenario.lanes.waiting_parts_vendor.id,
      waitingReason: 'parts',
      expectedResumeAt: '2026-07-01',
      resumeAlertedAt: '2026-07-10T09:00:00.000Z',
    })

    // Act
    const updated = await scenario.cards.update(scenario.actors.technician, card.id, {
      waitingReason: 'access',
      expectedVersion: 1,
    })

    // Assert
    expect(updated.waitingReason).toBe('access')
    expect(updated.resumeAlertedAt).toBe('2026-07-10T09:00:00.000Z')
  })

  it('rejects editing the waiting fields when the card is not in the waiting lane', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard({ laneId: scenario.lanes.in_progress.id })

    // Act
    const act = scenario.cards.update(scenario.actors.technician, card.id, {
      waitingReason: 'parts',
      expectedResumeAt: '2026-08-01',
      expectedVersion: 1,
    })

    // Assert
    await expect(act).rejects.toBeInstanceOf(ConflictError)
    await expect(act).rejects.toMatchObject({
      message: 'waiting reason and resume date can only be edited in the waiting lane',
    })
    expect(scenario.db.getCard(card.id).waitingReason).toBeNull()
    expect(scenario.db.eventsFor(card.id)).toHaveLength(0)
  })

  it('treats an unchanged waiting reason and date as a no-op', async () => {
    // Arrange
    const scenario = createScenario()
    const card = scenario.seedCard({
      laneId: scenario.lanes.waiting_parts_vendor.id,
      waitingReason: 'parts',
      expectedResumeAt: '2026-07-20',
      resumeAlertedAt: '2026-07-10T09:00:00.000Z',
    })

    // Act
    const updated = await scenario.cards.update(scenario.actors.technician, card.id, {
      waitingReason: 'parts',
      expectedResumeAt: '2026-07-20',
      expectedVersion: 1,
    })

    // Assert
    expect(updated.version).toBe(1)
    expect(updated.resumeAlertedAt).toBe('2026-07-10T09:00:00.000Z')
    expect(scenario.db.eventsFor(card.id)).toHaveLength(0)
  })
})
